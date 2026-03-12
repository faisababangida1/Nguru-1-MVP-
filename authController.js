const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./models');
const { Resend } = require('resend');

// Connect to the Resend API using your Render variable
const resend = new Resend(process.env.RESEND_API_KEY);

const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_verified BOOLEAN DEFAULT FALSE,
      verification_code VARCHAR(10)
    )
  `);
};

const registerUser = async (req, res) => {
  try {
    await ensureTables();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // Resend Fix: If they exist but aren't verified, send a new PIN
    if (userExists.rows.length > 0) {
        const existingUser = userExists.rows[0];
        if (!existingUser.is_verified) {
            const newPin = Math.floor(100000 + Math.random() * 900000).toString();
            const salt = await bcrypt.genSalt(10);
            const newHashedPassword = await bcrypt.hash(password, salt);
            
            await pool.query('UPDATE users SET verification_code = $1, password_hash = $2 WHERE email = $3', [newPin, newHashedPassword, email]);

            try {
                await resend.emails.send({
                    from: 'Nguru Mentorship <onboarding@nguru.online>',
                    to: email,
                    subject: 'Nguru - Your New Verification PIN',
                    html: `<p>Your new 6-digit verification PIN is: <strong>${newPin}</strong></p>`
                });
                return res.status(201).json({ message: 'New verification email sent', userId: existingUser.id });
            } catch (emailErr) {
                console.error("Resend Error:", emailErr);
                return res.status(500).json({ error: 'Failed to send email. Please try again.' });
            }
        }
        return res.status(400).json({ error: 'User already exists and is verified. Please log in.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); 

    const newUser = await pool.query(
      'INSERT INTO users (email, password_hash, is_verified, verification_code) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hashedPassword, false, verificationCode]
    );

    try {
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

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email address first.', unverified: true });
    }

    const storedPassword = user.password_hash || user.password;
    const isMatch = await bcrypt.compare(password, storedPassword);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.status(200).json({ message: 'Login successful', userId: user.id, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { registerUser, verifyEmail, loginUser };
