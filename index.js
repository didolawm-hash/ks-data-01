const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();

// Use a more flexible body parser for Apple's XML
app.use(express.text({ type: '*/*' })); 
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL;
const client = new MongoClient(uri);

// 1. HOME PAGE
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. APPLE UDID ENROLLMENT (Fixes the 500 Error)
app.post('/enroll', async (req, res) => {
    console.log("Enrollment request received from iPhone");
    try {
        const body = req.body;
        // Extract UDID from the XML
        const udidMatch = body.match(/<key>UDID<\/key>\s*<string>([^<]+)<\/string>/);
        const udid = udidMatch ? udidMatch[1] : null;

        if (!udid) {
            console.error("UDID not found in body");
            return res.status(400).send("UDID not found");
        }

        // Connect only if not already connected
        await client.connect();
        const db = client.db("KurdeStore");
        const users = db.collection("kurdestore_users");

        // Save the user
        await users.updateOne(
            { udid: udid },
            { $setOnInsert: { udid: udid, isPaid: false, reg_date: Date.now() } },
            { upsert: true }
        );

        console.log(`Success! UDID ${udid} saved to MongoDB.`);
        
        // 301 Redirect to success page
        return res.redirect(301, `https://api.kurde.store/success.html?udid=${udid}`);

    } catch (e) {
        console.error("Enrollment Error:", e.message);
        res.status(500).send("Internal Server Error: " + e.message);
    }
});

// 3. STATUS CHECK (For success.html)
app.get('/status', async (req, res) => {
    const { udid } = req.query;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const user = await db.collection("kurdestore_users").findOne({ udid: udid });
        res.json(user || { isPaid: false, not_found: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on ${PORT}`));
