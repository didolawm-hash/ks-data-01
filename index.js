const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();

// 🚨 CRITICAL FIX: JSON MUST BE FIRST!
app.use(express.json()); 
// Then use text parser for Apple's XML
app.use(express.text({ type: '*/*' })); 
app.use(cors());

// Serve static assets (images, css, etc.)
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL;
const client = new MongoClient(uri);

// ==========================================
// 1. EXPLICIT HTML PAGE ROUTES
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/success.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'success.html'));
});

app.get('/rawakurdestore1664.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'rawakurdestore1664.html'));
});

app.get('/store-designer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'store-designer.html'));
});

app.get('/store.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'store.html'));
});

// 👑 Your Secret Admin Page
app.get('/soze7919018030dido.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'soze7919018030dido.html'));
});

// ==========================================
// 2. APPLE UDID ENROLLMENT
// ==========================================
app.post('/', async (req, res) => {
    console.log("Enrollment request received from iPhone");
    try {
        const body = req.body;
        const udidMatch = body.match(/<key>UDID<\/key>\s*<string>([^<]+)<\/string>/);
        const udid = udidMatch ? udidMatch[1] : null;

        if (!udid) {
            return res.status(400).send("UDID not found");
        }

        await client.connect();
        const db = client.db("KurdeStore");
        const users = db.collection("kurdestore_users");

        await users.updateOne(
            { udid: udid },
            { $setOnInsert: { udid: udid, isPaid: false, reg_date: Date.now() } },
            { upsert: true }
        );

        console.log(`Success! UDID ${udid} saved.`);
        return res.redirect(301, `https://api.kurde.store/success.html?udid=${udid}`);

    } catch (e) {
        res.status(500).send("Internal Server Error: " + e.message);
    }
});

// ==========================================
// 3. API ROUTES (Status & App List)
// ==========================================
app.get('/status', async (req, res) => {
    const { udid } = req.query;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const user = await db.collection("kurdestore_users").findOne({ udid: udid });
        res.json(user || { isPaid: false, not_found: true });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.get('/get-apps', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const apps = await db.collection("Apps").find({}).toArray();
        res.json(apps);
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// ==========================================
// 4. ADMIN PANEL ROUTES
// ==========================================
app.get('/api/users', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const users = await db.collection("kurdestore_users").find({}).sort({reg_date: -1}).toArray();
        res.json(users);
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
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
        res.json({ success: true, message: `Updated to Paid: ${isPaid}` });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// 🚀 NEW: Timer Bypass Route
app.post('/api/bypass-time', async (req, res) => {
    const { udid } = req.body;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        
        // Subtract 73 hours from the current time
        const pastDate = Date.now() - (73 * 60 * 60 * 1000); 

        await db.collection("kurdestore_users").updateOne(
            { udid: udid },
            { $set: { reg_date: pastDate } }
        );
        res.json({ success: true, message: `Timer bypassed` });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// ==========================================
// 5. START SERVER
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
