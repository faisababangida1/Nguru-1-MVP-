const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./models');

const sendVerificationEmail = async (email, pin) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Nguru Mentorship <onboarding@nguru.online>',
      to: email,
      subject: 'Nguru - Your Verification PIN',
      html: `<h2>Welcome to Nguru.</h2><p>Your 6-digit verification PIN is: <strong>${pin}</strong></p><p>Please enter this in the app to unlock your account.</p>`
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error("Resend API blocked the request:", errorText);
    throw new Error('Email API failure');
  }
};

const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL
    )
  `);
  
  // Safely ensure both columns exist
  try { await pool.query(`ALTER TABLE users ADD COLUMN password VARCHAR(255)`); } catch(e){}
  try { await pool.query(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)`); } catch(e){}
  try { await pool.query(`ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE`); } catch(e){}
  try { await pool.query(`ALTER TABLE users ADD COLUMN verification_code VARCHAR(10)`); } catch(e){}

  // THE SMOKING GUN FIX: Force the database to drop the strict rules that caused your crash
  try { await pool.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`); } catch(e){}
  try { await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`); } catch(e){}
};

const registerUser = async (req, res) => {
  try {
    await ensureTables();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // GHOST EXTERMINATOR
    if (userExists.rows.length > 0) {
        if (!userExists.rows[0].is_verified) {
            const stuckUserId = userExists.rows[0].id;
            // Delete child data first to prevent the 'mind_objects_user_id_fkey' error
            await pool.query('DELETE FROM mind_objects WHERE user_id = $1', [stuckUserId]);
            // Now delete the parent user
            await pool.query('DELETE FROM users WHERE id = $1', [stuckUserId]);
        } else {
            return res.status(400).json({ error: 'User already exists and is verified. Please log in.' });
        }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); 

    // Insert into BOTH password and password_hash to completely bypass the old constraint crash
    const newUser = await pool.query(
      'INSERT INTO users (email, password_hash, password, is_verified, verification_code) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [email, hashedPassword, hashedPassword, false, verificationCode]
    );

    try {
      await sendVerificationEmail(email, verificationCode);
      res.status(201).json({ message: 'Verification email sent', userId: newUser.rows[0].id });
    } catch (emailError) {
      console.error("Email Sending Error:", emailError);
      const failedUserId = newUser.rows[0].id;
      await pool.query('DELETE FROM mind_objects WHERE user_id = $1', [failedUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [failedUserId]);
      res.status(500).json({ error: 'Failed to send email. Server crash prevented.' });
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
