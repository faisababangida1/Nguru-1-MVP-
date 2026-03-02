const express = require('express');
const { registerUser, loginUser } = require('./authController');
const { processNguruMessage } = require('./nguruEngine');

const app = express();
app.use(express.json());

// Routes
app.post('/api/auth/register', registerUser);
app.post('/api/auth/login', loginUser);

app.post('/api/chat', async (req, res) => {
  try {
    const { userId, userMessage } = req.body;
    if (!userId || !userMessage) return res.status(400).json({ error: 'Missing userId or userMessage' });

    const nguruResponse = await processNguruMessage(userId, userMessage);
    res.status(200).json(nguruResponse);
  } catch (error) {
    console.error('Nguru Engine Error:', error);
    res.status(500).json({ error: 'Critical engine error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Nguru Gateway is live on port ${PORT}`);
});
