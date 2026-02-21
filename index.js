const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken'); // ✨ FIXED: Industry standard JWT library
const fs = require('fs');
const { exec } = require('child_process');

const appleConfig = {
    issuerId: 'cbb536cc-f3f9-4ce6-a9d6-f5cb45012a25',
    keyId: '9AB47782V5',
    privateKey: fs.readFileSync(path.join(__dirname, 'AuthKey_AB8763YW8M.p8'), 'utf8')
};

// ✨ NEW: Direct, crash-proof connection to Apple
function getAppleToken() {
    return jwt.sign(
        { iss: appleConfig.issuerId, aud: "appstoreconnect-v1" },
        appleConfig.privateKey,
        { algorithm: 'ES256', keyid: appleConfig.keyId, expiresIn: '15m' }
    );
}

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
    endpoint: 'https://lon1.digitaloceanspaces.com',
    accessKeyId: 'DO00D6GRP9K2RAE873PZ',
    secretAccessKey: 'e4+QnmDLY1WkeWEsSjs260HVUXK1ShUqrrrYYmZ2PRU',
    region: 'lon1',
    signatureVersion: 'v4'
});
const SPACES_BUCKET = 'my-app-store';
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
// 2. UDID ENROLLMENT
// ==========================================
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
        
        res.json({
            used: deviceList.length,
            remaining: 100 - deviceList.length
        });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// ==========================================
// 👥 3. USER MANAGEMENT API
// ==========================================
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
            console.log(`🚀 Registering UDID ${udid} with Apple...`);
            try {
                const reqBody = {
                    data: {
                        type: "devices",
                        attributes: { name: `User_${udid.slice(0, 5)}`, platform: "IOS", udid: udid }
                    }
                };
                const response = await fetch('https://api.appstoreconnect.apple.com/v1/devices', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${getAppleToken()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(reqBody)
                });
                const data = await response.json();
                if (data.errors) throw new Error(data.errors[0].detail);
                console.log("✅ Registered with Apple Developer Portal");
            } catch (appleErr) {
                console.error("❌ Apple Portal Error:", appleErr.message);
            }
        }
        await db.collection("kurdestore_users").updateOne({ udid: udid }, { $set: { isPaid: isPaid } });
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
// 🚀 4. THE APP MANAGER API
// ==========================================
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

        if (action === "list_apps") {
            const items = await appsCollection.find({}).toArray();
            return res.json(items);
        }
        if (action === "save_item") {
            const appId = body.appId || body.bundleId;
            delete body.action;
            const safeIconKey = body.iconKey ? (body.iconKey.startsWith('/') ? body.iconKey.substring(1) : body.iconKey) : null;
            const safeIpaKey = body.ipaKey ? (body.ipaKey.startsWith('/') ? body.ipaKey.substring(1) : body.ipaKey) : null;
            try {
                if (safeIconKey) await s3.putObjectAcl({ Bucket: SPACES_BUCKET, Key: safeIconKey, ACL: 'public-read' }).promise();
                if (safeIpaKey) await s3.putObjectAcl({ Bucket: SPACES_BUCKET, Key: safeIpaKey, ACL: 'public-read' }).promise();
            } catch (aclError) { console.log("ACL Error:", aclError.message); }

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
            const cleanFileType = fileType.endsWith('/') ? fileType.slice(0, -1) : fileType;
            const key = `${cleanFileType}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
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
// 5. PLIST GENERATOR
// ==========================================
app.get('/plist', (req, res) => {
    let { ipaUrl, bundleId, name } = req.query;
    if (ipaUrl && ipaUrl.includes('.comapps/')) ipaUrl = ipaUrl.replace('.comapps/', '.com/apps/');
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
// 🛠️ 6. BULK RE-SIGNER CONFIG
// ==========================================
const P12_PATH = path.join(__dirname, 'final.p12');
const P12_PASS = '1212';
const PROVISION_PATH = path.join(__dirname, 'latest.mobileprovision');

async function updateProvisioningProfile() {
    try {
        // ✨ FIXED: Fetch 200 profiles and ask Apple to only send ACTIVE ones
        const response = await fetch('https://api.appstoreconnect.apple.com/v1/profiles?limit=200&filter[profileState]=ACTIVE', {
            headers: { 'Authorization': `Bearer ${getAppleToken()}` }
        });
        
        const data = await response.json();
        
        if (data.errors) {
            throw new Error(data.errors[0].detail);
        }

        const profileList = data.data || [];
        
        if (profileList.length === 0) {
            console.log("Raw Apple Response:", JSON.stringify(data)); // For debugging
            throw new Error("No ACTIVE profiles found. Check API Key permissions.");
        }
        
        // ✨ NEW: Specifically look for your "kurde" profile
        let targetProfile = profileList.find(p => p.attributes.name === 'kurde');
        
        // If it can't find "kurde" exactly, just grab the first active one it finds
        if (!targetProfile) {
            targetProfile = profileList[0];
        }

        const profileContent = targetProfile.attributes.profileContent; 
        if (!profileContent) {
            throw new Error("Profile found, but Apple didn't send the file content.");
        }

        fs.writeFileSync(PROVISION_PATH, Buffer.from(profileContent, 'base64'));
        console.log(`✅ Downloaded .mobileprovision ('${targetProfile.attributes.name}') directly from Apple`);
    } catch (e) {
        console.error("❌ Profile Error:", e.message);
        throw e;
    }
}

async function reSignAllApps() {
    console.log("🔄 Starting Bulk Re-Sign process...");
    try {
        await updateProvisioningProfile();
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();
        for (let app of apps) {
            if (!app.ipaKey || app.appId === "store_config_v1" || app.isGame === "config") continue;
            const safeIpaKey = app.ipaKey.startsWith('/') ? app.ipaKey.substring(1) : app.ipaKey;
            const tempInput = path.join(__dirname, `temp_in_${app.bundleId}.ipa`);
            const tempOutput = path.join(__dirname, `temp_out_${app.bundleId}.ipa`);
            try {
                const data = await s3.getObject({ Bucket: SPACES_BUCKET, Key: safeIpaKey }).promise();
                fs.writeFileSync(tempInput, data.Body);
                const signCmd = `./zsign -k ${P12_PATH} -p ${P12_PASS} -m ${PROVISION_PATH} -o ${tempOutput} ${tempInput}`;
                await new Promise((resolve) => {
                    exec(signCmd, (err) => {
                        if (err) console.error(`❌ Sign Fail ${app.name}:`, err.message);
                        else console.log(`✅ Signed ${app.name}`);
                        resolve();
                    });
                });
                if (fs.existsSync(tempOutput)) {
                    await s3.putObject({
                        Bucket: SPACES_BUCKET, Key: safeIpaKey, Body: fs.readFileSync(tempOutput),
                        ACL: 'public-read', ContentType: 'application/octet-stream'
                    }).promise();
                }
            } catch (err) { console.error(`❌ Error ${app.name}:`, err.message); }
            finally {
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
            }
        }
        console.log("✨ All apps updated and uploaded to Spaces!");
    } catch (e) { console.error("❌ Bulk Sign Error:", e.message); }
}

setInterval(reSignAllApps, 10 * 60 * 1000);

// ==========================================
// 🚀 7. MANUAL SIGNER TRIGGER
// ==========================================
app.post('/api/trigger-sign', (req, res) => {
    reSignAllApps().catch(err => console.error("Trigger Error:", err));
    res.json({ success: true, message: "🚀 Background signing started!" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
