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
const CDN_URL = "https://my-app-store.lon1.cdn.digitaloceanspaces.com";

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
            if (app.icon && app.icon.includes('.comicons/')) app.icon = app.icon.replace('.comicons/', '.com/icons/');
            if (app.ipa && app.ipa.includes('.comapps/')) app.ipa = app.ipa.replace('.comapps/', '.com/apps/');
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
            const safeIconKey = body.iconKey ? (body.iconKey.startsWith('/') ? body.iconKey.substring(1) : body.iconKey) : null;
            const safeIpaKey = body.ipaKey ? (body.ipaKey.startsWith('/') ? body.ipaKey.substring(1) : body.ipaKey) : null;
            
            const finalData = {
                ...body,
                appId: appId,
                bundleId: appId,
                info: body.info || body.subtitle || "", 
                icon: safeIconKey ? `${CDN_URL}/${safeIconKey}` : body.icon,
                ipa: safeIpaKey ? `${CDN_URL}/${safeIpaKey}` : body.ipa,
                updatedAt: new Date().toISOString()
            };
            await appsCollection.updateOne({ appId: appId }, { $set: finalData }, { upsert: true });
            return res.json({ success: true });
        }

        if (action === "get_url") {
            const { fileName, fileType, contentType } = body;
            const key = `${fileType.replace(/\/$/, '')}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
            const uploadUrl = s3.getSignedUrl('putObject', { Bucket: SPACES_BUCKET, Key: key, Expires: 3600, ContentType: contentType });
            return res.json({ uploadUrl, key });
        }

        if (action === "delete_app") {
            const appData = await appsCollection.findOne({ appId: body.bundleId });
            if (appData) {
                if (appData.iconKey) await s3.deleteObject({ Bucket: SPACES_BUCKET, Key: appData.iconKey }).promise();
                if (appData.ipaKey) await s3.deleteObject({ Bucket: SPACES_BUCKET, Key: appData.ipaKey }).promise();
            }
            await appsCollection.deleteOne({ appId: body.bundleId });
            return res.json({ success: true });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Plist Generator
app.get('/plist', (req, res) => {
    let { ipaUrl, bundleId, name } = req.query;
    if (ipaUrl && ipaUrl.includes('digitaloceanspaces.com') && !ipaUrl.includes('.cdn.')) {
        ipaUrl = ipaUrl.replace('digitaloceanspaces.com', 'cdn.digitaloceanspaces.com');
    }
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string><![CDATA[${ipaUrl}]]></string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${bundleId}</string><key>bundle-version</key><string>1.0</string><key>kind</key><string>software</string><key>title</key><string>${name}</string></dict></dict></array></dict></plist>`;
    res.set('Content-Type', 'text/xml');
    res.send(plistXml);
});

// ==========================================
// 🛠️ 6. BULK RE-SIGNER CONFIG (UPDATED FOR RAM/DISK & MASTER APP)
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
        if (data.errors) throw new Error(data.errors[0].detail);
        const profileList = data.data || [];
        const targetProfile = profileList.find(p => p.attributes.name === 'kurde') || profileList[0];
        if (!targetProfile) throw new Error("No active profiles found.");
        fs.writeFileSync(PROVISION_PATH, Buffer.from(targetProfile.attributes.profileContent, 'base64'));
        console.log(`✅ Downloaded .mobileprovision ('${targetProfile.attributes.name}')`);
    } catch (e) { console.error("❌ Profile Error:", e.message); throw e; }
}

async function reSignAllApps() {
    console.log("🔄 Starting Bulk Re-Sign (Ultra-Stability Mode)...");
    
    // 🧹 Pre-Clean Disk
    const files = fs.readdirSync(__dirname);
    files.forEach(file => {
        if (file.includes('temp_in_') || file.includes('temp_out_')) {
            try { fs.unlinkSync(path.join(__dirname, file)); } catch(e) {}
        }
    });

    try {
        await updateProvisioningProfile();
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();

        // 🆔 ADD YOUR STORE'S BUNDLE ID HERE! (Ensure this matches MongoDB exactly)
        const MASTER_BUNDLE_ID = "com.kurde.store"; 

        for (let app of apps) {
            if (!app.ipaKey || app.appId === "store_config_v1") continue;

            const safeIpaKey = app.ipaKey.startsWith('/') ? app.ipaKey.substring(1) : app.ipaKey;
            const tempInput = path.join(__dirname, `temp_in_${app.bundleId}.ipa`);
            const tempOutput = path.join(__dirname, `temp_out_${app.bundleId}.ipa`);

            console.log(`📦 Processing: ${app.name} (${app.bundleId})`);

            try {
                // A. Download
                const downloadStream = s3.getObject({ Bucket: SPACES_BUCKET, Key: safeIpaKey }).createReadStream();
                const fileWriter = fs.createWriteStream(tempInput);
                await new Promise((resolve, reject) => {
                    downloadStream.pipe(fileWriter);
                    fileWriter.on('finish', resolve);
                    fileWriter.on('error', reject);
                });

                const stats = fs.statSync(tempInput);
                const fileSizeInGB = stats.size / (1024 * 1024 * 1024);
                const isMasterApp = app.bundleId === MASTER_BUNDLE_ID;

                // B. Safe Deep Clean (Skips Huge Apps AND Master App)
                if (fileSizeInGB < 1.0 && !isMasterApp) {
                    console.log(`🧹 Deep Cleaning ${app.name}...`);
                    await new Promise((resolve) => {
                        exec(`zip -d "${tempInput}" "Payload/*.app/PlugIns/*" "Payload/*.app/Watch/*" "Payload/*.app/SC_Info/*" "Payload/*.app/_CodeSignature" "Payload/*.app/Metadata" || true`, () => resolve());
                    });
                } else {
                    const reason = isMasterApp ? "Master Store App" : `Size: ${fileSizeInGB.toFixed(2)}GB`;
                    console.log(`⏩ Skipping Deep Clean for ${app.name} (${reason}).`);
                }

                // C. Sign
                console.log(`✍️ Signing ${app.name}...`);
                const args = ['-f', '-q', '-z', '1', '-b', app.bundleId, '-k', path.resolve(P12_PATH), '-p', P12_PASS, '-m', path.resolve(PROVISION_PATH), '-o', tempOutput, tempInput];

                await new Promise((resolve, reject) => {
                    const signer = spawn('./zsign', args);
                    let errOut = '';
                    signer.stderr.on('data', d => errOut += d.toString()); // Capture actual error message
                    signer.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Exit code ${code}: ${errOut}`)));
                });

                // D. Upload
                if (fs.existsSync(tempOutput)) {
                    console.log(`☁️ Uploading ${app.name}...`);
                    await s3.putObject({
                        Bucket: SPACES_BUCKET, Key: safeIpaKey, Body: fs.createReadStream(tempOutput),
                        ACL: 'public-read', ContentType: 'application/octet-stream'
                    }).promise();
                    console.log(`✅ Upload Complete: ${app.name}`);
                }
            } catch (err) {
                console.error(`❌ Critical Error on ${app.name}:`, err.message);
            } finally {
                if (fs.existsSync(tempInput)) try { fs.unlinkSync(tempInput); } catch(e) {}
                if (fs.existsSync(tempOutput)) try { fs.unlinkSync(tempOutput); } catch(e) {}
                // Give the server 5 seconds to "breathe" between apps
                await new Promise(r => setTimeout(r, 5000)); 
            }
        }
    } catch (e) { console.error("❌ Bulk Sign Error:", e.message); }
}

setInterval(reSignAllApps, 2 * 60 * 60 * 1000);

app.post('/api/trigger-sign', (req, res) => {
    reSignAllApps().catch(err => console.error("Trigger Error:", err));
    res.json({ success: true, message: "🚀 Background signing started!" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
