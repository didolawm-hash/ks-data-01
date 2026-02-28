const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken'); 
const fs = require('fs');
const { exec, spawn } = require('child_process');

const appleConfig = {
    issuerId: 'cbb536cc-f3f9-4ce6-a9d6-f5cb45012a25',
    keyId: 'AB8763YW8M',
    privateKey: fs.readFileSync(path.join(__dirname, 'AuthKey_AB8763YW8M.p8'), 'utf8')
};

function getAppleToken() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: appleConfig.issuerId,
        iat: now,
        exp: now + 1199,
        aud: "appstoreconnect-v1"
    };
    const signOptions = {
        algorithm: 'ES256',
        header: { alg: 'ES256', kid: appleConfig.keyId, typ: 'JWT' }
    };
    return jwt.sign(payload, appleConfig.privateKey, signOptions);
}

const app = express();
app.use(express.json()); 
app.use(express.text({ type: '*/*' })); 
app.use(cors());
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL;
const client = new MongoClient(uri);

const s3 = new AWS.S3({
    endpoint: 'https://lon1.digitaloceanspaces.com',
    accessKeyId: 'DO00D6GRP9K2RAE873PZ',
    secretAccessKey: 'e4+QnmDLY1WkeWEsSjs260HVUXK1ShUqrrrYYmZ2PRU',
    region: 'lon1',
    signatureVersion: 'v4'
});
const SPACES_BUCKET = 'my-app-store';

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/success.html', (req, res) => res.sendFile(path.join(__dirname, 'success.html')));
app.get('/rawakurdestore1664.html', (req, res) => res.sendFile(path.join(__dirname, 'rawakurdestore1664.html')));
app.get('/store-designer.html', (req, res) => res.sendFile(path.join(__dirname, 'store-designer.html')));
app.get('/store.html', (req, res) => res.sendFile(path.join(__dirname, 'store.html')));
app.get('/soze7919018030dido.html', (req, res) => res.sendFile(path.join(__dirname, 'soze7919018030dido.html')));

// Enrollment
app.post('/', async (req, res) => {
    try {
        const body = req.body;
        const udidMatch = body.match(/<key>UDID<\/key>\s*<string>([^<]+)<\/string>/);
        const udid = udidMatch ? udidMatch[1] : null;
        if (!udid) return res.status(400).send("UDID not found");
        await client.connect();
        await client.db("KurdeStore").collection("kurdestore_users").updateOne(
            { udid: udid },
            { $setOnInsert: { udid: udid, isPaid: false, reg_date: Date.now() } },
            { upsert: true }
        );
        return res.redirect(301, `https://api.kurde.store/success.html?udid=${udid}`);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/apple-usage', async (req, res) => {
    try {
        const response = await fetch('https://api.appstoreconnect.apple.com/v1/devices?limit=200', {
            headers: { 'Authorization': `Bearer ${getAppleToken()}` }
        });
        const data = await response.json();
        const deviceList = data.data || [];
        res.json({ used: deviceList.length, remaining: 100 - deviceList.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// User Management
app.get('/status', async (req, res) => {
    const { udid } = req.query;
    try {
        await client.connect();
        const user = await client.db("KurdeStore").collection("kurdestore_users").findOne({ udid: udid });
        res.json(user || { isPaid: false, not_found: true });
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
        const db = client.db("KurdeStore");
        if (isPaid === true) {
            const reqBody = { data: { type: "devices", attributes: { name: `User_${udid.slice(0, 5)}`, platform: "IOS", udid: udid } } };
            const response = await fetch('https://api.appstoreconnect.apple.com/v1/devices', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getAppleToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            const data = await response.json();
            if (data.errors) throw new Error(data.errors[0].detail);
        }
        await db.collection("kurdestore_users").updateOne({ udid: udid }, { $set: { isPaid: isPaid } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// App Manager
app.get('/get-apps', async (req, res) => {
    try {
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();
        const fixedApps = apps.map(app => {
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

        if (action === "list_apps") return res.json(await appsCollection.find({}).toArray());

        if (action === "save_item") {
            const appId = body.appId || body.bundleId;
            delete body.action;
            const finalData = {
                ...body,
                appId: appId,
                bundleId: appId,
                info: body.info || body.subtitle || "", 
                updatedAt: new Date().toISOString()
            };
            await appsCollection.updateOne({ appId: appId }, { $set: finalData }, { upsert: true });
            return res.json({ success: true });
        }

        if (action === "get_url") {
            const { fileName, fileType, contentType } = body;
            const key = `${fileType.replace(/\/$/, '')}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
            // 🛡️ Added ACL: 'public-read' to ensure icons and apps are always accessible immediately
            const uploadUrl = s3.getSignedUrl('putObject', { 
                Bucket: SPACES_BUCKET, 
                Key: key, 
                Expires: 3600, 
                ContentType: contentType,
                ACL: 'public-read' 
            });
            return res.json({ uploadUrl, key });
        }

        if (action === "delete_app") {
            const appData = await appsCollection.findOne({ 
                $or: [ { appId: body.bundleId }, { bundleId: body.bundleId } ] 
            });
            if (appData) {
                console.log(`🗑️ Storage Cleanup for: ${appData.name}`);
                const cleanIcon = appData.iconKey ? appData.iconKey.replace(/^\/+/, '') : null;
                const cleanIpa = appData.ipaKey ? appData.ipaKey.replace(/^\/+/, '') : null;
                if (cleanIcon) await s3.deleteObject({ Bucket: SPACES_BUCKET, Key: cleanIcon }).promise().catch(() => {});
                if (cleanIpa) await s3.deleteObject({ Bucket: SPACES_BUCKET, Key: cleanIpa }).promise().catch(() => {});
            }
            await appsCollection.deleteOne({ $or: [ { appId: body.bundleId }, { bundleId: body.bundleId } ] });
            return res.json({ success: true });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Plist Generator
app.get('/plist', (req, res) => {
    let { ipaUrl, bundleId, name } = req.query;
    
    // 🚨 REMOVED the broken CDN override. It now uses the direct URL exactly as saved.
    
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string><![CDATA[${ipaUrl}]]></string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${bundleId}</string><key>bundle-version</key><string>1.0</string><key>kind</key><string>software</string><key>title</key><string>${name}</string></dict></dict></array></dict></plist>`;
    res.set('Content-Type', 'text/xml');
    res.send(plistXml);
});

// ==========================================
// 🛠️ RE-SIGNER
// ==========================================
const P12_PATH = path.join(__dirname, 'final.p12');
const P12_PASS = '1212';
const PROVISION_PATH = path.join(__dirname, 'latest.mobileprovision');

async function updateProvisioningProfile() {
    try {
        const response = await fetch('https://api.appstoreconnect.apple.com/v1/profiles?limit=200&filter[profileState]=ACTIVE', {
            headers: { 'Authorization': `Bearer ${getAppleToken()}` }
        });
        const data = await response.json();
        const profileList = data.data || [];
        const targetProfile = profileList.find(p => p.attributes.name === 'kurde') || profileList[0];
        if (!targetProfile) throw new Error("No active profiles found.");
        fs.writeFileSync(PROVISION_PATH, Buffer.from(targetProfile.attributes.profileContent, 'base64'));
    } catch (e) { console.error("Profile Error:", e.message); throw e; }
}

async function reSignAllApps() {
    console.log("🔄 Starting Bulk Re-Sign...");
    try {
        await updateProvisioningProfile();
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();

        for (let app of apps) {
            if (!app.ipaKey || app.appId === "store_config_v1") continue;

            const safeIpaKey = app.ipaKey.replace(/^\/+/, '');
            const tempIn = path.join(__dirname, `in_${app.bundleId}.ipa`);
            const tempOut = path.join(__dirname, `out_${app.bundleId}.ipa`);

            try {
                // 1. Download (FIXED: Using Streams to stop the RAM crash)
                await new Promise((resolve, reject) => {
                    const fileStream = fs.createWriteStream(tempIn);
                    const s3Stream = s3.getObject({ Bucket: SPACES_BUCKET, Key: safeIpaKey }).createReadStream();
                    
                    s3Stream.on('error', reject);
                    fileStream.on('error', reject);
                    fileStream.on('close', resolve);
                    
                    s3Stream.pipe(fileStream);
                });

                // 2. Sign (Your exact working code)
                await new Promise((resolve, reject) => {
                    const z = spawn('./zsign', ['-f', '-q', '-k', path.resolve(P12_PATH), '-p', P12_PASS, '-m', path.resolve(PROVISION_PATH), '-o', tempOut, tempIn]);
                    z.on('close', (c) => c === 0 ? resolve() : reject(new Error("zsign fail")));
                });

                // 3. Upload (Your exact working code)
                await s3.putObject({ Bucket: SPACES_BUCKET, Key: safeIpaKey, Body: fs.createReadStream(tempOut), ACL: 'public-read', ContentType: 'application/octet-stream' }).promise();
                console.log(`✅ Signed: ${app.name}`);
            } catch (err) {
                console.error(`❌ Error on ${app.name}:`, err.message);
            } finally {
                if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                await new Promise(r => setTimeout(r, 5000)); // 5s Delay to save RAM
            }
        }
    } catch (e) { console.error("Sign Loop Error:", e.message); }
}

setInterval(reSignAllApps, 2 * 60 * 60 * 1000);

app.post('/api/trigger-sign', (req, res) => {
    reSignAllApps().catch(() => {});
    res.json({ success: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on ${PORT}`));
