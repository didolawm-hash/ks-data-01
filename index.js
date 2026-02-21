const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');

const app = express();
app.use(express.json()); 
app.use(express.text({ type: '*/*' })); 
app.use(cors());
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL;
const client = new MongoClient(uri);

// ==========================================
// 🚀 DIGITALOCEAN SPACES CONFIG
// ==========================================
const s3 = new AWS.S3({
    endpoint: 'lon1.digitaloceanspaces.com',
    accessKeyId: 'DO00D6GRP9K2RAE873PZ',
    secretAccessKey: 'e4+QnmDLY1WkeWEsSjs260HVUXK1ShUqrrrYYmZ2PRU',
    region: 'lon1',
    signatureVersion: 'v4'
});
const SPACES_BUCKET = 'my-app-store';

// ==========================================
// 1. STORE API (FIXING ICONS & INSTALLS)
// ==========================================
app.get('/get-apps', async (req, res) => {
    try {
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();
        
        // 🛠️ GENERATE SIGNED URLS FOR EVERY APP
        const fixedApps = apps.map(app => {
            // Fix Icon Link
            if (app.iconKey) {
                app.icon = s3.getSignedUrl('getObject', {
                    Bucket: SPACES_BUCKET,
                    Key: app.iconKey,
                    Expires: 3600 // Valid for 1 hour
                });
            }
            // Ensure Flutter sees 'info'
            app.info = app.info || app.subtitle || "";
            return app;
        });

        res.json(fixedApps);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/store-api', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const appsCollection = db.collection("Apps");
        
        let body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
        const action = body.action;

        if (action === "list_apps") {
            const items = await appsCollection.find({}).toArray();
            return res.json(items);
        }
        
        if (action === "save_item") {
            const appId = body.appId || body.bundleId;
            delete body.action;
            // Clean data before saving
            body.appId = appId;
            body.bundleId = appId;
            await appsCollection.updateOne({ appId: appId }, { $set: body }, { upsert: true });
            return res.json({ success: true });
        }

        if (action === "get_url") {
            const { fileName, fileType, contentType } = body;
            const key = `${fileType}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
            const params = { Bucket: SPACES_BUCKET, Key: key, Expires: 600, ContentType: contentType };
            const uploadUrl = s3.getSignedUrl('putObject', params);
            return res.json({ uploadUrl, key });
        }

        if (action === "delete_app") {
            const bundleId = body.bundleId;
            const appData = await appsCollection.findOne({ appId: bundleId });
            if (appData) {
                if (appData.iconKey) await s3.deleteObject({ Bucket: SPACES_BUCKET, Key: appData.iconKey }).promise();
                if (appData.ipaKey) await s3.deleteObject({ Bucket: SPACES_BUCKET, Key: appData.ipaKey }).promise();
            }
            await appsCollection.deleteOne({ appId: bundleId });
            return res.json({ success: true });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 2. PLIST GENERATOR (FIXING "UNABLE TO INSTALL")
// ==========================================
app.get('/plist', async (req, res) => {
    const { bundleId, name } = req.query;
    try {
        await client.connect();
        const appData = await client.db("KurdeStore").collection("Apps").findOne({ appId: bundleId });
        
        if (!appData || !appData.ipaKey) return res.status(404).send("App file not found");

        // 🛠️ GENERATE VIP SIGNED LINK FOR THE IPA
        const signedIpaUrl = s3.getSignedUrl('getObject', {
            Bucket: SPACES_BUCKET,
            Key: appData.ipaKey,
            Expires: 1800 // 30 minutes
        });

        const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string><![CDATA[${signedIpaUrl}]]></string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key><string>${bundleId}</string>
                <key>bundle-version</key><string>1.0</string>
                <key>kind</key><string>software</string>
                <key>title</key><string>${name}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;
    res.set('Content-Type', 'text/xml');
    res.send(plistXml);
    } catch (e) { res.status(500).send(e.message); }
});

// --- UDID ROUTES (REMAIN UNCHANGED) ---
app.get('/success.html', (req, res) => res.sendFile(path.join(__dirname, 'success.html')));
app.get('/rawakurdestore1664.html', (req, res) => res.sendFile(path.join(__dirname, 'rawakurdestore1664.html')));
app.post('/', async (req, res) => {
    try {
        const body = req.body;
        const udidMatch = body.match(/<key>UDID<\/key>\s*<string>([^<]+)<\/string>/);
        const udid = udidMatch ? udidMatch[1] : null;
        if (udid) {
            await client.connect();
            await client.db("KurdeStore").collection("kurdestore_users").updateOne(
                { udid }, { $setOnInsert: { udid, isPaid: false, reg_date: Date.now() } }, { upsert: true }
            );
            res.redirect(301, `https://api.kurde.store/success.html?udid=${udid}`);
        }
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
