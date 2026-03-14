const express = require('express');
const cors = require('cors');
const path = require('path');
const { registerUser, verifyEmail, loginUser } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');
const { pool } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

// --- BULLETPROOF ABSOLUTE ROUTING (Keeps screen from breaking) ---
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.get('/', (req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });
app.get('/chat.html', (req, res) => { res.sendFile(path.join(publicPath, 'chat.html')); });

// --- AUTH ROUTES ---
app.post('/api/auth/register', registerUser);
app.post('/api/auth/verify', verifyEmail);
app.post('/api/auth/login', loginUser);

// --- SIDEBAR & HISTORY ROUTES ---
app.get('/api/chat/sessions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const sessions = await pool.query('SELECT id, title, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        res.status(200).json(sessions.rows);
    } catch (error) {
        res.status(500).json({ error: "Failed to load sessions" });
    }
});

app.get('/api/chat/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const historyRes = await pool.query('SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE session_id = $1 ORDER BY id DESC LIMIT 50) sub ORDER BY id ASC', [sessionId]);
        res.status(200).json(historyRes.rows);
    } catch (error) {
        res.status(500).json({ error: "Failed to load history" });
    }
});

// --- THE AI BRAIN ---
app.post('/api/chat', async (req, res) => {
    try {
        const { userId, sessionId, message } = req.body; 
        if (!userId || !message) return res.status(400).json({ error: "Missing data" });
        const aiResponse = await processNguruMessage(userId, sessionId, message);
        res.status(200).json(aiResponse);
    } catch (error) {
        console.error('[SEVERE AI CRASH]:', error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- THE "KING MAKER" ENGINE (PROACTIVE EMAILS) ---
app.get('/api/admin/send-nudges', async (req, res) => {
    try {
        console.log("Starting proactive email sequence...");
        
        // 1. Get all users and their most recent chat session title
        const usersRes = await pool.query(`
            SELECT u.email, u.id, 
            (SELECT title FROM chat_sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_topic
            FROM users u
        `);

        let emailsSent = 0;

        // 2. Loop through users and send them a personalized email
        for (let user of usersRes.rows) {
            if (!user.last_topic) continue; 

            const userName = user.email.split('@')[0];
            const cleanName = userName.charAt(0).toUpperCase() + userName.slice(1);
            
            const emailContent = `
                <h2>Hey ${cleanName}, Nguru here.</h2>
                <p>We left off talking about <strong>${user.last_topic}</strong>.</p>
                <p>I was analyzing our last session, and I found a new way to break it down that I think will finally make it click for you.</p>
                <p><a href="https://nguru-engine.onrender.com" style="background:#6200EE; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; display:inline-block; margin-top:10px;">Jump Back In</a></p>
                <p>Stay sharp,<br>Nguru AI</p>
            `;

            // Send via Resend using YOUR verified domain!
            const resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Nguru Mentorship <hello@nguru.online>', // Your custom domain!
                    to: user.email,
                    subject: `Still thinking about ${user.last_topic}?`,
                    html: emailContent
                })
            });

            if (resendResponse.ok) emailsSent++;
        }

        res.status(200).json({ success: true, message: `Proactive emails sent to ${emailsSent} users.` });

    } catch (error) {
        console.error('[EMAIL CRASH]:', error);
        res.status(500).json({ error: "Failed to send emails" });
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
