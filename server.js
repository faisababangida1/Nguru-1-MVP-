const express = require('express');
const cors = require('cors');
const path = require('path');
const { registerUser, verifyEmail, loginUser } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');
const { pool } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

// Tell the server to load your HTML files from the 'public' folder
app.use(express.static('public'));

// --- THE FUEL LINES (Auth Routes) ---
app.post('/api/auth/register', registerUser);
app.post('/api/auth/verify', verifyEmail);
app.post('/api/auth/login', loginUser);

// --- THE BRAIN STEM (Chat Route) ---
app.post('/api/chat', async (req, res) => {
    try {
        const { userId, message } = req.body;
        
        // Aggressive logging so we can see the exact moment the server hears you
        console.log(`[INCOMING MESSAGE] User ID: ${userId} says: "${message}"`);
        
        if (!userId || !message) {
            console.log('[ERROR] Missing userId or message from frontend.');
            return res.status(400).json({ error: "Missing data" });
        }

        // Send the message to the AI Engine
        const aiResponse = await processNguruMessage(userId, message);
        
        console.log(`[SUCCESS] AI replied to User ID: ${userId}`);
        res.status(200).json(aiResponse);

    } catch (error) {
        // If the AI crashes, this will scream the exact reason into your Render logs
        console.error('[SEVERE AI CRASH]:', error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- ENGINE START ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, async () => {
    console.log(`Nguru Gateway is live on port ${PORT}`);
    try {
        await pool.query('SELECT 1');
        console.log("Nguru Database Matrix Initialized.");
    } catch (dbErr) {
        console.error("Database failed to connect on startup:", dbErr);
    }
});
