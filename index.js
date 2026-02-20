const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path'); // Added this to find your HTML file

const app = express();
app.use(express.json());
app.use(cors());

// This tells the server: "If someone asks for a file (like CSS or Images), look in this folder."
app.use(express.static(__dirname));

const uri = process.env.DATABASE_URL; 

// 1. Serve your HTML Website (When you visit the link in a browser)
app.get('/', (req, res) => {
    // This sends your index.html file to the user's screen
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. Main API Route (For your Flutter App & Designer Panel to save/load apps)
app.post('/', async (req, res) => {
    const { action } = req.body;
    
    if (!uri) {
        return res.status(500).json({ error: "DATABASE_URL missing!" });
    }

    try {
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db("KurdeStore");
        const collection = db.collection("Apps");

        if (action === "list_apps") {
            const apps = await collection.find({}).toArray();
            await client.close();
            return res.json(apps);
        }
        
        await client.close();
        res.status(400).json({ error: "Invalid Action" });
    } catch (e) { 
        console.error("DB Error:", e);
        res.status(500).json({ error: e.message }); 
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
});
