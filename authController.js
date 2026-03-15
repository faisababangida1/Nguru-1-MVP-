const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./models');

// Secret key for JWT (in production, this should be in your Render Environment Variables)
const JWT_SECRET = process.env.JWT_SECRET || 'nguru_super_secret_key_2026';

// --- UPGRADED: REGISTER NOW REQUIRES A NAME ---
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email, and password are required." });
        }

        // Check if user already exists
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Email is already registered." });
        }

        // Hash the password for security
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Save user to database (Assuming we alter the table to include 'name')
        const newUser = await pool.query(
            'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
            [name, email, hashedPassword]
        );

        res.status(201).json({ 
            message: "Registration successful.", 
            user: newUser.rows[0] 
        });

    } catch (error) {
        console.error('[REGISTER ERROR]:', error);
        res.status(500).json({ error: "Server error during registration." });
    }
};

const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            return res.status(400).json({ error: "Invalid credentials." });
        }

        const user = userRes.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ error: "Invalid credentials." });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({ 
            message: "Login successful.", 
            token, 
            user: { id: user.id, name: user.name, email: user.email } 
        });

    } catch (error) {
        console.error('[LOGIN ERROR]:', error);
        res.status(500).json({ error: "Server error during login." });
    }
};

// --- NEW: FORGOT PASSWORD (MVP SIMULATION) ---
// In a full production app, this would send an email with a secure reset link.
// For this MVP, we will instantly reset the password to a temporary one and return it.
const resetPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required." });

        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            return res.status(400).json({ error: "No account found with that email." });
        }

        // Generate a temporary 6-digit password
        const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedTempPassword = await bcrypt.hash(tempPassword, salt);

        await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashedTempPassword, email]);

        // Instead of emailing, we return it to the UI for testing purposes.
        res.status(200).json({ 
            success: true, 
            message: `Password reset successful. Your temporary password is: ${tempPassword}` 
        });

    } catch (error) {
        console.error('[RESET ERROR]:', error);
        res.status(500).json({ error: "Server error during password reset." });
    }
};

// We will keep verifyEmail as a placeholder if you want to implement magic links later.
const verifyEmail = async (req, res) => {
    res.status(200).json({ message: "Email verification not required for MVP." });
};

module.exports = { registerUser, loginUser, verifyEmail, resetPassword };
