const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const uri = process.env.DATABASE_URL; // DigitalOcean fills this automatically
const client = new MongoClient(uri);

app.post('/', async (req, res) => {
    const { action } = req.body;
    try {
        await client.connect();
        const db = client.db("KurdeStore");
        const collection = db.collection("Apps");

        if (action === "list_apps") {
            const apps = await collection.find({}).toArray();
            return res.json(apps);
        }
        res.status(400).send("Invalid Action");
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server live on ${PORT}`));
