const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');

const app = express();

// 🚨 JSON MUST BE FIRST for Admin Panel compatibility
app.use(express.json()); 
// Text parser catches Apple's XML profile data
app.use(express.text({ type: '*/*' })); 
app.use(cors());

// Serve static assets (images, css, etc.)
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL;
const client = new MongoClient(uri);

// ==========================================
// 🚀 DIGITALOCEAN SPACES CONFIG
// ==========================================
const s3 = new AWS.S3({
    endpoint: 'lon1.digitaloceanspaces.com', // London region
    accessKeyId: 'DO00D6GRP9K2RAE873PZ',
    secretAccessKey: 'e4+QnmDLY1WkeWEsSjs260HVUXK1ShUqrrrYYmZ2PRU',
    region: 'lon1',
    signatureVersion: 'v4'
});
const SPACES_BUCKET = 'my-app-store';

// ==========================================
// 1. HTML PAGE ROUTES
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
// 3. CORE API ROUTES (Status & App List)
// ==========================================
app.get('/status', async (req, res) => {
    const { udid } = req.query;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const user = await db.collection("kurdestore_users").findOne({ udid: udid });
        res.json(user || { isPaid: false, not_found: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/get-apps', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const apps = await db.collection("Apps").find({}).toArray();
        res.json(apps);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 4. ADMIN PANEL ROUTES (UDID Management)
// ==========================================
app.get('/api/users', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const users = await db.collection("kurdestore_users").find({}).sort({reg_date: -1}).toArray();
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/update-status', async (req, res) => {
    const { udid, isPaid } = req.body;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        await db.collection("kurdestore_users").updateOne(
            { udid: udid },
            { $set: { isPaid: isPaid } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bypass-time', async (req, res) => {
    const { udid } = req.body;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const pastDate = Date.now() - (73 * 60 * 60 * 1000); 
        await db.collection("kurdestore_users").updateOne(
            { udid: udid },
            { $set: { reg_date: pastDate } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 5. OTA PLIST GENERATOR
// ==========================================
app.get('/plist', (req, res) => {
    const { ipaUrl, bundleId, name } = req.query;
    if (!ipaUrl || !bundleId || !name) return res.status(400).send("Missing parameters");

    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict><key>kind</key><string>software-package</string><key>url</key><string>${ipaUrl}</string></dict>
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
});

// ==========================================
// 🚀 6. APP MANAGER & STORE DESIGNER API
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
            if (!appId) return res.status(400).json({ error: "Missing App ID" });
            
            delete body.action;
            
            await appsCollection.updateOne(
                { appId: appId },
                { $set: body },
                { upsert: true }
            );
            return res.json({ success: true });
        }

        if (action === "delete_app") {
            const bundleId = body.bundleId;
            await appsCollection.deleteOne({ appId: bundleId });
            return res.json({ success: true });
        }

        // 🚀 DIGITALOCEAN SIGNED URL GENERATOR
        if (action === "get_url") {
            const { fileName, fileType, contentType } = body;
            const cleanName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '');
            const key = `${fileType}/${Date.now()}-${cleanName}`;
            
            const params = {
                Bucket: SPACES_BUCKET,
                Key: key,
                Expires: 600,
                ContentType: contentType,
                // Removed ACL: 'public-read' to prevent UI permission errors
            };

            const uploadUrl = s3.getSignedUrl('putObject', params);
            return res.json({ uploadUrl, key });
        }

        res.status(400).json({ error: "Unknown action" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 7. START SERVER
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
