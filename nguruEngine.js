// nguruEngine.js

const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');

async function processNguruMessage(userId, userMessage) {
  // 1. Auto-create a memory bank for this user if it doesn't exist yet
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      role VARCHAR(10),
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Fetch User Profile (Mind Object)
  const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
  const weakRes = await pool.query("SELECT * FROM weak_points WHERE user_id = $1 AND status = 'unresolved'", [userId]);
  const mind = mindRes.rows[0];
  const weakPoints = weakRes.rows;

  // 3. Fetch past conversation (The Amnesia Fix) - Retrieves the last 10 messages
  const historyRes = await pool.query(
    'SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE user_id = $1 ORDER BY id DESC LIMIT 10) sub ORDER BY id ASC',
    [userId]
  );
  const chatHistory = historyRes.rows;

  // 4. The Master Personality Prompt
  let systemPrompt = `You are Nguru, an elite, highly intelligent mentorship AI. 
  You are NOT a generic assistant. You speak directly, insightfully, and with emotional intelligence. 
  CRITICAL RULES:
  1. If the user tells you their name, you MUST remember it and use it.
  2. NEVER say "As an AI, I don't experience..." Talk like a real, wise mentor.
  3. Keep the conversation flowing naturally based on the chat history provided.`;

  let responseFlags = { is_testing: false, inject_video: false, deferred_topic: null };

  // Anti-Frustration Check
  const criticalWeakPoint = weakPoints.find(wp => wp.failure_count >= 2);
  if (criticalWeakPoint) {
    return {
      ai_response_text: `Let's pause. Text isn't working here. Let's look at a visual for ${criticalWeakPoint.failed_concept}.`,
      is_testing: false, inject_video: true, deferred_topic: null
    };
  }

  // Analogy Injection
  if (mind && mind.learning_analogies && mind.learning_analogies.length > 0) {
    const analogies = mind.learning_analogies.join(', ');
    systemPrompt += `\n4. If the user is confused, use analogies strictly based on their interests: [${analogies}].`;
  }

  // 5. Generate AI Response
  const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);

  // 6. Save the new conversation to the PostgreSQL memory bank
  await pool.query(
    "INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)",
    [userId, userMessage]
  );
  await pool.query(
    "INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)",
    [userId, rawAiResponse]
  );

  return { ai_response_text: rawAiResponse, ...responseFlags };
}

module.exports = { processNguruMessage };
