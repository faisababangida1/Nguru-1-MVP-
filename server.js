const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron'); 
const { registerUser, verifyEmail, loginUser } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');
const { pool } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.get('/', (req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });
app.get('/chat.html', (req, res) => { res.sendFile(path.join(publicPath, 'chat.html')); });

app.post('/api/auth/register', registerUser);
app.post('/api/auth/verify', verifyEmail);
app.post('/api/auth/login', loginUser);

// --- NEW: SAVE WIZARD INTERESTS ---
app.post('/api/user/interests', async (req, res) => {
    try {
        const { userId, interests } = req.body;
        if (!userId || !interests) return res.status(400).json({ error: "Missing data" });

        // Check if user already has a mind_objects profile
        const existing = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
        
        if (existing.rows.length > 0) {
            await pool.query('UPDATE mind_objects SET learning_analogies = $1 WHERE user_id = $2', [JSON.stringify(interests), userId]);
        } else {
            await pool.query('INSERT INTO mind_objects (user_id, learning_analogies) VALUES ($1, $2)', [userId, JSON.stringify(interests)]);
        }
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[WIZARD CRASH]:', error);
        res.status(500).json({ error: "Failed to save interests" });
    }
});

app.get('/api/chat/sessions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const sessions = await pool.query('SELECT id, title, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        res.status(200).json(sessions.rows);
    } catch (error) {
        res.status(500).json({ error: "Failed to load sessions" });
    }
});

app.put('/api/chat/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { title } = req.body;
        if (!title) return res.status(400).json({ error: "Title is required" });
        await pool.query('UPDATE chat_sessions SET title = $1 WHERE id = $2', [title, sessionId]);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to rename session" });
    }
});

app.delete('/api/chat/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        await pool.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete session" });
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

async function fireProactiveEmails() {
    console.log("Starting proactive email sequence...");
    try {
        const usersRes = await pool.query(`
            SELECT u.email, u.id, 
            (SELECT title FROM chat_sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_topic
            FROM users u
        `);

        let emailsSent = 0;

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

            const resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Nguru Mentorship <faisal@nguru.online>', 
                    to: user.email,
                    subject: `Still thinking about ${user.last_topic}?`,
                    html: emailContent
                })
            });

            if (resendResponse.ok) emailsSent++;
        }
        return { success: true, emailsSent };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

app.get('/api/admin/send-nudges', async (req, res) => {
    const result = await fireProactiveEmails();
    if (result.success) res.status(200).json({ success: true, message: `Proactive emails sent to ${result.emailsSent} users.` });
    else res.status(500).json({ error: "Failed to send emails" });
});

cron.schedule('0 17 * * *', async () => {
    console.log("CRON TRIGGER: 5:00 PM WAT. Firing King Maker Email Sequence...");
    await fireProactiveEmails();
}, {
    scheduled: true,
    timezone: "Africa/Lagos" 
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`Nguru Gateway is live on port ${PORT}`);
    try {
        await pool.query('SELECT 1');
        // Safely ensure the mind_objects table exists so the wizard never crashes
        await pool.query('CREATE TABLE IF NOT EXISTS mind_objects (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, learning_analogies JSONB)');
        console.log("Nguru Database Matrix Initialized.");
    } catch (dbErr) {
        console.error("Database failed to connect on startup:", dbErr);
    }
});
