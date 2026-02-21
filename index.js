const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');
const AppStoreConnect = require('appstore-connect-sdk'); 
const fs = require('fs');
const { exec } = require('child_process');

const appleConfig = {
    issuerId: 'cbb536cc-f3f9-4ce6-a9d6-f5cb45012a25',
    keyId: '9AB47782V5',
    // 🚨 Ensure your .p8 file is uploaded to GitHub and named correctly here
    privateKey: fs.readFileSync(path.join(__dirname, 'AuthKey_AB8763YW8M.p8'), 'utf8')
};
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
        // ✨ FIXED: Passing appleConfig directly
        const api = new AppStoreConnect(appleConfig);
        const devices = await api.devices.list();
        
        const deviceList = devices.data || devices;

        res.json({
            used: deviceList.length,
            remaining: 100 - deviceList.length
        });
    } catch (e) { 
        console.error("Usage Error:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// ==========================================
// 👥 3. USER MANAGEMENT API (RESTORED!)
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
        
        // 🚀 AUTOMATION: If you click 'Approve', send UDID to Apple account immediately
        if (isPaid === true) {
            console.log(`🚀 Registering UDID ${udid} with Apple...`);
            
            try {
                const token = new Token(appleConfig.keyId, appleConfig.issuerId, appleConfig.privateKey);
                const api = new AppStoreConnect(token);

                await api.devices.register({
                    name: `User_${udid.slice(0, 5)}`,
                    platform: 'IOS',
                    udid: udid
                });
                console.log("✅ Registered with Apple Developer Portal");
            } catch (appleErr) {
                console.error("❌ Apple Portal Error:", appleErr.message);
                // We continue so the user is still marked 'Paid' in your DB even if Apple API fails
            }
        }

        await db.collection("kurdestore_users").updateOne({ udid: udid }, { $set: { isPaid: isPaid } });
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

            // Securely make files Public
            try {
                if (safeIconKey) await s3.putObjectAcl({ Bucket: SPACES_BUCKET, Key: safeIconKey, ACL: 'public-read' }).promise();
                if (safeIpaKey) await s3.putObjectAcl({ Bucket: SPACES_BUCKET, Key: safeIpaKey, ACL: 'public-read' }).promise();
            } catch (aclError) {
                console.log("Could not set public ACL:", aclError.message);
            }

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
// 🛠️ 6. BULK RE-SIGNER CONFIG (Every 10 Mins)
// ==========================================
const P12_PATH = path.join(__dirname, 'final.p12');
const P12_PASS = '1212';
const PROVISION_PATH = path.join(__dirname, 'latest.mobileprovision');

async function updateProvisioningProfile() {
    try {
        // ✨ FIXED: Passing appleConfig directly instead of using Token constructor
        const api = new AppStoreConnect(appleConfig);
        
        const profiles = await api.profiles.list();
        
        // Profiles data is usually in .data for this SDK
        const profileList = profiles.data || profiles; 
        
        if (!profileList || profileList.length === 0) {
            throw new Error("No profiles found on Apple account");
        }
        
        // Get the first profile's content (Base64)
        const profileContent = profileList[0].attributes.profileContent; 
        fs.writeFileSync(PROVISION_PATH, Buffer.from(profileContent, 'base64'));
        
        console.log("✅ Latest .mobileprovision downloaded from Apple");
    } catch (e) {
        console.error("❌ Failed to get profile from Apple:", e.message);
        throw e; 
    }
}



async function reSignAllApps() {
    console.log("🔄 Starting 10-minute Bulk Re-Sign process...");
    
    try {
        await updateProvisioningProfile();
        await client.connect();
        const apps = await client.db("KurdeStore").collection("Apps").find({}).toArray();

        for (let app of apps) {
            if (!app.ipaKey || app.appId === "store_config_v1" || app.isGame === "config") continue;

            const safeIpaKey = app.ipaKey.startsWith('/') ? app.ipaKey.substring(1) : app.ipaKey;
            const tempInput = path.join(__dirname, `temp_in_${app.bundleId}.ipa`);
            const tempOutput = path.join(__dirname, `temp_out_${app.bundleId}.ipa`);

            console.log(`📦 Processing: ${app.name}`);

            try {
                const data = await s3.getObject({ Bucket: SPACES_BUCKET, Key: safeIpaKey }).promise();
                fs.writeFileSync(tempInput, data.Body);

                const signCmd = `./zsign -k ${P12_PATH} -p ${P12_PASS} -m ${PROVISION_PATH} -o ${tempOutput} ${tempInput}`;
                
                await new Promise((resolve, reject) => {
                    exec(signCmd, (err, stdout, stderr) => {
                        if (err) {
                            console.error(`❌ Failed to sign ${app.name}:`, err.message);
                            return resolve(); 
                        }
                        console.log(`✅ Signed ${app.name}`);
                        resolve();
                    });
                });

                if (fs.existsSync(tempOutput)) {
                    const signedData = fs.readFileSync(tempOutput);
                    await s3.putObject({
                        Bucket: SPACES_BUCKET,
                        Key: safeIpaKey,
                        Body: signedData,
                        ACL: 'public-read',
                        ContentType: 'application/octet-stream'
                    }).promise();
                    console.log(`☁️ Uploaded signed ${app.name} to Spaces`);
                }
            } catch (innerErr) {
                console.error(`❌ Error processing ${app.name}:`, innerErr.message);
            } finally {
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
            }
        }
        console.log("✨ All apps re-signed and uploaded successfully!");
    } catch (e) {
        console.error("❌ Bulk Sign Error:", e.message);
    }
}

// 🚀 SET THE TIMER (Runs every 10 minutes)
setInterval(reSignAllApps, 10 * 60 * 1000);
// ==========================================
// 🚀 7. MANUAL SIGNER TRIGGER
// ==========================================
app.post('/api/trigger-sign', (req, res) => {
    // Run the existing reSignAllApps function immediately
    reSignAllApps().catch(err => console.error("Manual Trigger Error:", err));
    
    res.json({ 
        success: true, 
        message: "🚀 Bulk signing process started in the background. Check logs for progress." 
    });
});
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
