const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, MindObject, LearningState } = require('./models');

// Use an environment variable for the secret key in Railway
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_nguru_key_for_dev';

const registerUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash the password securely
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create the new user
    const newUser = await User.create({ email, password: hashedPassword });

    // CRUCIAL: Automatically initialize the user's Mind Object and Learning State
    await MindObject.create({ userId: newUser._id });
    await LearningState.create({ userId: newUser._id });

    // Generate JWT token
    const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ 
      message: 'User registered and Mind Object initialized',
      token, 
      userId: newUser._id 
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during registration' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(200).json({ 
      message: 'Login successful',
      token, 
      userId: user._id 
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during login' });
  }
};

module.exports = { registerUser, loginUser, JWT_SECRET };
