const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./models');
const { Resend } = require('resend');

// Connect to the Resend API
const resend = new Resend(process.env.RESEND_API_KEY);

// THE SELF-HEALING DATABASE ENGINE
const ensureTables = async () => {
  // 1. Ensure the base table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL
    )
  `);
  
  // 2. Forcefully inject columns one by one. 
  // We use try/catch so if they already exist, it ignores the error and keeps running safely.
  try { await pool.query(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)`); } catch(e){}
  try { await pool.query(`ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE`); } catch(e){}
  try { await pool.query(`ALTER TABLE users ADD COLUMN verification_code VARCHAR(10)`); } catch(e){}
};

const registerUser = async (req, res) => {
  try {
    await ensureTables();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // GHOST ACCOUNT EXTERMINATOR
    // If the account exists but is stuck in limbo, delete the corrupted data so we can start fresh.
    if (userExists.rows.length > 0) {
        if (!userExists.rows[0].is_verified) {
            await pool.query('DELETE FROM users WHERE email = $1', [email]);
        } else {
            return res.status(400).json({ error: 'User already exists and is verified. Please log in.' });
        }
    }

    // Build the clean, new account
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); 

    const newUser = await pool.query(
      'INSERT INTO users (email, password_hash, is_verified, verification_code) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hashedPassword, false, verificationCode]
    );

    try {
      // Fire the enterprise email via Resend
      await resend.emails.send({
        from: 'Nguru Mentorship <onboarding@nguru.online>',
        to: email,
        subject: 'Nguru - Your Verification PIN',
        html: `<p>Welcome to Nguru.</p><p>Your 6-digit verification PIN is: <strong>${verificationCode}</strong></p><p>Please enter this in the app to unlock your account.</p>`
      });
      res.status(201).json({ message: 'Verification email sent', userId: newUser.rows[0].id });
    } catch (emailError) {
      console.error("Resend Error:", emailError);
      await pool.query('DELETE FROM users WHERE id = $1', [newUser.rows[0].id]);
      res.status(500).json({ error: 'Email failed to send. Please try again.' });
    }
  } catch (error) {
    console.error('Registration database error:', error);
    res.status(500).json({ error: 'Critical Database error' });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { email, pin, analogies } = req.body;
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userRes.rows.length === 0) return res.status(400).json({ error: 'User not found' });
    const user = userRes.rows[0];

    if (user.verification_code !== pin) return res.status(400).json({ error: 'Invalid PIN code' });

    await pool.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE email = $1', [email]);

    // Save Mind Object analogies
    await pool.query(
      'INSERT INTO mind_objects (user_id, learning_analogies) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [user.id, analogies || []]
    );

    res.status(200).json({ message: 'Account verified successfully', userId: user.id });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Server error during verification' });
  }
};

const loginUser = async (req, res) => {
  try {
    await ensureTables();
    const { email, password } = req.body;
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

    const user = userRes.rows[0];

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email address first.', unverified: true });
    }

    const storedPassword = user.password_hash || user.password;
    if (!storedPassword) return res.status(400).json({ error: 'Database mismatch. Please create a new account.' });

    const isMatch = await bcrypt.compare(password, storedPassword);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.status(200).json({ message: 'Login successful', userId: user.id, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { registerUser, verifyEmail, loginUser };
