const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');

const app = express();

// 🚨 Middleware setup
app.use(express.json()); 
app.use(express.text({ type: '*/*' })); 
app.use(cors());
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL;
const client = new MongoClient(uri);

// ==========================================
// 🚀 DIGITALOCEAN SPACES & CDN CONFIG
// ==========================================
const s3 = new AWS.S3({
    endpoint: 'lon1.digitaloceanspaces.com',
    accessKeyId: 'DO00D6GRP9K2RAE873PZ',
    secretAccessKey: 'e4+QnmDLY1WkeWEsSjs260HVUXK1ShUqrrrYYmZ2PRU',
    region: 'lon1',
    signatureVersion: 'v4'
});

const SPACES_BUCKET = 'my-app-store';
// ✅ Updated to use the CDN endpoint for public access
const CDN_URL = "https://my-app-store.lon1.cdn.digitaloceanspaces.com";

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
// 2. APPLE UDID ENROLLMENT
// ==========================================
app.post('/', async (req, res) => {
    try {
        const body = req.body;
        const udidMatch = body.match(/<key>UDID<\/key>\s*<string>([^<]+)<\/string>/);
        const udid = udidMatch ? udidMatch[1] : null;

        if (!udid) return res.status(400).send("UDID not found");

        await client.connect();
        const db = client.db("KurdeStore");
        const users = db.collection("kurdestore_users");

        await users.updateOne(
            { udid: udid },
            { $setOnInsert: { udid: udid, isPaid: false, reg_date: Date.now() } },
            { upsert: true }
        );

        return res.redirect(301, `https://api.kurde.store/success.html?udid=${udid}`);
    } catch (e) {
        res.status(500).send("Internal Server Error: " + e.message);
    }
});

// ==========================================
// 3. STORE & ADMIN API
// ==========================================
app.get('/status', async (req, res) => {
    const { udid } = req.query;
    try {
        await client.connect();
        const user = await client.db("KurdeStore").collection("kurdestore_users").findOne({ udid: udid });
        res.json(user || { isPaid: false, not_found: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/get-apps', async (req, res) => {
    try {
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();
        res.json(apps);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users', async (req, res) => {
    try {
        await client.connect();
        const users = await client.db("KurdeStore").collection("kurdestore_users").find({}).sort({reg_date: -1}).toArray();
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/update-status', async (req, res) => {
    const { udid, isPaid } = req.body;
    try {
        await client.connect();
        await client.db("KurdeStore").collection("kurdestore_users").updateOne({ udid: udid }, { $set: { isPaid: isPaid } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bypass-time', async (req, res) => {
    const { udid } = req.body;
    try {
        await client.connect();
        const pastDate = Date.now() - (73 * 60 * 60 * 1000); 
        await client.db("KurdeStore").collection("kurdestore_users").updateOne({ udid: udid }, { $set: { reg_date: pastDate } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🚀 4. APP MANAGER API (Store API)
// ==========================================
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

            // 🛠️ DATA NORMALIZER: Fixed for your icons/apps/games folders
            const finalData = {
                ...body,
                appId: appId,
                bundleId: appId,
                info: body.info || body.subtitle || "", 
                icon: body.icon || (body.iconKey ? `${CDN_URL}/${body.iconKey}` : ""),
                ipa: body.ipa || (body.ipaKey ? `${CDN_URL}/${body.ipaKey}` : ""),
                updatedAt: new Date().toISOString()
            };

            await appsCollection.updateOne({ appId: appId }, { $set: finalData }, { upsert: true });
            return res.json({ success: true });
        }

        if (action === "get_url") {
            const { fileName, fileType, contentType } = body;
            const key = `${fileType}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
            
            const params = {
                Bucket: SPACES_BUCKET,
                Key: key,
                Expires: 600,
                ContentType: contentType,
                ACL: 'public-read'
            };

            const uploadUrl = s3.getSignedUrl('putObject', params);
            return res.json({ uploadUrl, key });
        }

        if (action === "delete_app") {
            await appsCollection.deleteOne({ appId: body.bundleId });
            return res.json({ success: true });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 5. OTA PLIST GENERATOR
// ==========================================
app.get('/plist', (req, res) => {
    const { ipaUrl, bundleId, name } = req.query;
    if (!ipaUrl || !bundleId) return res.status(400).send("Missing parameters");

    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${ipaUrl}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${bundleId}</string><key>bundle-version</key><string>1.0</string><key>kind</key><string>software</string><key>title</key><string>${name}</string></dict></dict></array></dict></plist>`;
    res.set('Content-Type', 'text/xml');
    res.send(plistXml);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
