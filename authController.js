const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./models');
const nodemailer = require('nodemailer');

// Connects to your Gmail to send the verification codes
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS  
  }
});

const registerUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Safely upgrade the database to hold PINs
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10)`);

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) return res.status(400).json({ error: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Generate a random 6-digit PIN
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); 

    const newUser = await pool.query(
      'INSERT INTO users (email, password_hash, is_verified, verification_code) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hashedPassword, false, verificationCode]
    );

    // Send the email to the user
    const mailOptions = {
      from: `"Nguru Mentorship" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Nguru - Your Verification PIN',
      text: `Welcome to Nguru. Your 6-digit verification PIN is: ${verificationCode}\n\nPlease enter this in the app to unlock your account.`
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({ message: 'Verification email sent', userId: newUser.rows[0].id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { email, pin, analogies } = req.body;
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userRes.rows.length === 0) return res.status(400).json({ error: 'User not found' });
    const user = userRes.rows[0];

    // Check if the PIN matches
    if (user.verification_code !== pin) return res.status(400).json({ error: 'Invalid PIN code' });

    // Unlock the user account
    await pool.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE email = $1', [email]);

    // Build their Mind Object in the database
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
    const { email, password } = req.body;
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

    const user = userRes.rows[0];

    // Block login if they never typed their PIN
    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email address first.', unverified: true });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.status(200).json({ message: 'Login successful', userId: user.id, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { registerUser, verifyEmail, loginUser };
