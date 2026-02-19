const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// 1. Health Check Route (Guarantees a Green Deployment)
app.get('/', (req, res) => {
    res.status(200).send('🚀 Server is alive and Health Check passed!');
});

// 2. Main API Route (Connects to DB ONLY when requested)
app.post('/', async (req, res) => {
    const { action } = req.body;
    const uri = process.env.DATABASE_URL;

    if (!uri) {
        return res.status(500).json({ error: "CRITICAL: DATABASE_URL environment variable is missing in DigitalOcean settings!" });
    }

    try {
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db("KurdeStore");
        const collection = db.collection("Apps");

        if (action === "list_apps") {
            const apps = await collection.find({}).toArray();
            await client.close(); // Close connection when done
            return res.json(apps);
        }
        
        await client.close();
        res.status(400).json({ error: "Invalid Action" });
    } catch (e) { 
        console.error("Database connection failed:", e);
        res.status(500).json({ error: e.message }); 
    }
});

// 3. Start the Server (Crucial for DigitalOcean)
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Safe Mode Server running on port ${PORT}`);
});
