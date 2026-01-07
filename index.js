const express = require('express');
const cors = require('cors');
const { Firestore } = require('@google-cloud/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firestore
const db = new Firestore({
    projectId: 'beds24-483408',
    databaseId: '(default)'
});

const HK_COLLECTION = 'housekeeping_data';

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'hk-api', timestamp: new Date().toISOString() });
});

// Save data
app.post('/save', async (req, res) => {
    try {
        const { type, data, timestamp } = req.body;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        
        await db.collection(HK_COLLECTION).doc(type).set({
            data: data,
            timestamp: timestamp || new Date().toISOString(),
            updatedAt: new Date()
        });
        
        console.log(`Saved: ${type}`);
        res.json({ success: true, type });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Load data
app.get('/load', async (req, res) => {
    try {
        const { type } = req.query;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        
        const doc = await db.collection(HK_COLLECTION).doc(type).get();
        if (!doc.exists) return res.json({ data: null });
        
        const docData = doc.data();
        res.json({ data: docData.data, timestamp: docData.timestamp });
    } catch (error) {
        console.error('Load error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List all types
app.get('/list', async (req, res) => {
    try {
        const snapshot = await db.collection(HK_COLLECTION).listDocuments();
        res.json({ types: snapshot.map(doc => doc.id) });
    } catch (error) {
        res.json({ types: [] });
    }
});

// Delete data
app.delete('/delete', async (req, res) => {
    try {
        const { type } = req.query;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        
        await db.collection(HK_COLLECTION).doc(type).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`HK API listening on port ${PORT}`));
