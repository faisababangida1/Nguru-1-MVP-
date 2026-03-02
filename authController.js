const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./models');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_nguru_key_for_dev';

const registerUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) return res.status(400).json({ error: 'User exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create User
    const newUser = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id',
      [email, hashedPassword]
    );
    const userId = newUser.rows[0].id;

    // Initialize the blank Mind Object for the AI
    await pool.query('INSERT INTO mind_objects (user_id) VALUES ($1)', [userId]);
    await pool.query('INSERT INTO learning_states (user_id) VALUES ($1)', [userId]);

    const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ message: 'User registered', token, userId });
  } catch (error) {
    res.status(500).json({ error: 'Server error during registration' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(200).json({ message: 'Login successful', token, userId: user.id });
  } catch (error) {
    res.status(500).json({ error: 'Server error during login' });
  }
};

module.exports = { registerUser, loginUser };
