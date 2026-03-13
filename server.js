const express = require('express');
const cors = require('cors');
const path = require('path');
const { registerUser, verifyEmail, loginUser } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');
const { pool } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/auth/register', registerUser);
app.post('/api/auth/verify', verifyEmail);
app.post('/api/auth/login', loginUser);

// --- NEW: FETCH ALL SESSIONS FOR THE SIDEBAR ---
app.get('/api/chat/sessions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const sessions = await pool.query(
            'SELECT id, title, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        res.status(200).json(sessions.rows);
    } catch (error) {
        console.error('[SESSION CRASH]:', error);
        res.status(500).json({ error: "Failed to load sessions" });
    }
});

// --- NEW: FETCH MESSAGES FOR A SPECIFIC CHAT ---
app.get('/api/chat/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const historyRes = await pool.query(
            'SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE session_id = $1 ORDER BY id DESC LIMIT 50) sub ORDER BY id ASC',
            [sessionId]
        );
        res.status(200).json(historyRes.rows);
    } catch (error) {
        console.error('[HISTORY CRASH]:', error);
        res.status(500).json({ error: "Failed to load history" });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        // We now expect sessionId from the frontend!
        const { userId, sessionId, message } = req.body; 
        
        if (!userId || !message) {
            return res.status(400).json({ error: "Missing data" });
        }

        const aiResponse = await processNguruMessage(userId, sessionId, message);
        res.status(200).json(aiResponse);

    } catch (error) {
        console.error('[SEVERE AI CRASH]:', error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

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
