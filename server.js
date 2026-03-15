const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron'); 
const { registerUser, verifyEmail, loginUser, resetPassword } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');
const { pool } = require('./models');

const app = express();
app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.get('/', (req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });
app.get('/chat.html', (req, res) => { res.sendFile(path.join(publicPath, 'chat.html')); });

// --- AUTHENTICATION ---
app.post('/api/auth/register', registerUser);
app.post('/api/auth/verify', verifyEmail);
app.post('/api/auth/login', loginUser);
app.post('/api/auth/reset-password', resetPassword); // NEW

// --- NEW: USER PROFILE SETTINGS ---
app.get('/api/user/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
        const mindRes = await pool.query('SELECT learning_analogies FROM mind_objects WHERE user_id = $1', [userId]);
        
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        
        res.status(200).json({
            name: userRes.rows[0].name,
            email: userRes.rows[0].email,
            analogies: mindRes.rows.length > 0 ? mindRes.rows[0].learning_analogies : []
        });
    } catch (error) {
        console.error('[PROFILE GET CRASH]:', error);
        res.status(500).json({ error: "Failed to load profile" });
    }
});

app.put('/api/user/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { name, analogies } = req.body;
        
        if (name) {
            await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
        }
        if (analogies) {
            const existing = await pool.query('SELECT id FROM mind_objects WHERE user_id = $1', [userId]);
            if (existing.rows.length > 0) {
                await pool.query('UPDATE mind_objects SET learning_analogies = $1 WHERE user_id = $2', [JSON.stringify(analogies), userId]);
            } else {
                await pool.query('INSERT INTO mind_objects (user_id, learning_analogies) VALUES ($1, $2)', [userId, JSON.stringify(analogies)]);
            }
        }
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[PROFILE UPDATE CRASH]:', error);
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// For the Welcome Wizard
app.post('/api/user/interests', async (req, res) => {
    try {
        const { userId, interests } = req.body;
        if (!userId || !interests) return res.status(400).json({ error: "Missing data" });

        const existing = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
        if (existing.rows.length > 0) {
            await pool.query('UPDATE mind_objects SET learning_analogies = $1 WHERE user_id = $2', [JSON.stringify(interests), userId]);
        } else {
            await pool.query('INSERT INTO mind_objects (user_id, learning_analogies) VALUES ($1, $2)', [userId, JSON.stringify(interests)]);
        }
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to save interests" });
    }
});

// --- CHAT ROUTES ---
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

// --- AUTOMATION ENGINE ---
async function fireProactiveEmails() {
    console.log("Starting proactive email sequence...");
    try {
        const usersRes = await pool.query(`
            SELECT u.email, u.name, u.id, 
            (SELECT title FROM chat_sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_topic
            FROM users u
        `);

        let emailsSent = 0;

        for (let user of usersRes.rows) {
            if (!user.last_topic) continue; 
            
            // Use their real name, fallback to email prefix if name is missing
            const cleanName = user.name || (user.email.split('@')[0].charAt(0).toUpperCase() + user.email.split('@')[0].slice(1));
            
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
        // SAFETY UPGRADES: Ensure old databases don't crash when looking for 'name'
        try {
            await pool.query('ALTER TABLE users ADD COLUMN name VARCHAR(255)');
        } catch (e) { /* Column likely already exists, ignore */ }
        
        await pool.query('CREATE TABLE IF NOT EXISTS mind_objects (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, learning_analogies JSONB)');
        console.log("Nguru Database Matrix Initialized and Upgraded.");
    } catch (dbErr) {
        console.error("Database failed to connect on startup:", dbErr);
    }
});
