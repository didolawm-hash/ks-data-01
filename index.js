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
// 1. PAGE ROUTES
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/success.html', (req, res) => res.sendFile(path.join(__dirname, 'success.html')));
app.get('/rawakurdestore1664.html', (req, res) => res.sendFile(path.join(__dirname, 'rawakurdestore1664.html')));
app.get('/store-designer.html', (req, res) => res.sendFile(path.join(__dirname, 'store-designer.html')));
app.get('/store.html', (req, res) => res.sendFile(path.join(__dirname, 'store.html')));
app.get('/soze7919018030dido.html', (req, res) => res.sendFile(path.join(__dirname, 'soze7919018030dido.html')));

// ==========================================
// 2. STORE API (WITH AUTOMATIC VIP LINKS)
// ==========================================
app.get('/get-apps', async (req, res) => {
    try {
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();
        
        // 🛠️ GENERATE VIP LINKS FOR ICONS
        const appsWithVipLinks = apps.map(app => {
            if (app.iconKey) {
                app.icon = s3.getSignedUrl('getObject', {
                    Bucket: SPACES_BUCKET,
                    Key: app.iconKey,
                    Expires: 3600 // Link works for 1 hour
                });
            }
            // Map 'info' for Flutter compatibility
            app.info = app.info || app.subtitle || "";
            return app;
        });

        res.json(appsWithVipLinks);
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
// 3. PLIST GENERATOR (WITH AUTOMATIC VIP IPA LINK)
// ==========================================
app.get('/plist', async (req, res) => {
    const { bundleId, name } = req.query;
    try {
        await client.connect();
        const appData = await client.db("KurdeStore").collection("Apps").findOne({ appId: bundleId });
        
        if (!appData || !appData.ipaKey) return res.status(404).send("App or IPA not found");

        // 🛠️ GENERATE VIP LINK FOR IPA
        const vipIpaUrl = s3.getSignedUrl('getObject', {
            Bucket: SPACES_BUCKET,
            Key: appData.ipaKey,
            Expires: 3600
        });

        const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string><![CDATA[${vipIpaUrl}]]></string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${bundleId}</string><key>bundle-version</key><string>1.0</string><key>kind</key><string>software</string><key>title</key><string>${name}</string></dict></dict></array></dict></plist>`;
        
        res.set('Content-Type', 'text/xml');
        res.send(plistXml);
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
