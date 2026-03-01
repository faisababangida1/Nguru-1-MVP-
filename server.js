const express = require('express');
const mongoose = require('mongoose');
const { registerUser, loginUser } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');
const { generateReelVideo } = require('./reelGenerator');

const app = express();
app.use(express.json());

// Connect to MongoDB (Railway provides MONGO_URL automatically if you add a MongoDB database to your Railway project)
const MONGO_URI = process.env.MONGO_URL;
if (!MONGO_URI) {
  console.error("CRITICAL: MONGO_URL environment variable is missing.");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to Nguru Database'))
    .catch(err => console.error('Database connection error:', err));
}

// --- AUTHENTICATION ROUTES ---
app.post('/api/auth/register', registerUser);
app.post('/api/auth/login', loginUser);

// --- THE NGURU CHAT ROUTE ---
app.post('/api/chat', async (req, res) => {
  try {
    // In a production app, you would verify the JWT token here first.
    const { userId, userMessage } = req.body;

    if (!userId || !userMessage) {
      return res.status(400).json({ error: 'Missing userId or userMessage' });
    }

    // Pass the message directly into your custom state machine
    const nguruResponse = await processNguruMessage(userId, userMessage);

    // Send the structured JSON back to the Android app
    res.status(200).json(nguruResponse);

  } catch (error) {
    console.error('Error in Nguru Engine:', error);
    res.status(500).json({ error: 'Nguru Engine encountered a critical error.' });
  }
});

// --- SHORT-FORM VIDEO GENERATOR ROUTE ---
app.post('/api/video/generate', async (req, res) => {
  try {
    const { topic, platform, durationSeconds, isVeryViral } = req.body;

    if (!topic) {
      return res.status(400).json({ error: 'Missing topic' });
    }

    const video = await generateReelVideo({
      topic,
      platform: platform || 'youtube',
      durationSeconds,
      isVeryViral: Boolean(isVeryViral)
    });

    return res.status(200).json({
      message: 'Video generated successfully.',
      ...video
    });
  } catch (error) {
    console.error('Video generator error:', error);
    return res.status(500).json({
      error: 'Failed to generate video.',
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Nguru API Gateway is live on port ${PORT}`);
});
