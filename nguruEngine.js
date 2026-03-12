const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');
const { searchYouTube } = require('./youtubeClient');

// THE SELF-HEALING BRAIN: Ensures all memory tables exist before thinking
const ensureBrainTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50),
      message TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weak_points (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      failed_concept VARCHAR(255),
      failure_count INTEGER DEFAULT 1,
      status VARCHAR(50) DEFAULT 'unresolved'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learning_states (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      deferred_topics TEXT[]
    )
  `);
};

async function processNguruMessage(userId, userMessage) {
  try {
      await ensureBrainTables(); // Force tables to exist before processing!

      // 1. Fetch User Identity
      const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length === 0) throw new Error("Ghost User ID trapped in memory.");
      
      const userEmail = userRes.rows[0].email;
      const userName = userEmail.split('@')[0];
      const userNameCapitalized = userName.charAt(0).toUpperCase() + userName.slice(1);

      const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
      const weakRes = await pool.query("SELECT * FROM weak_points WHERE user_id = $1 AND status = 'unresolved'", [userId]);

      const mind = mindRes.rows[0];
      const weakPoints = weakRes.rows;

      // 2. Fetch Chat History
      const historyRes = await pool.query(
        'SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE user_id = $1 ORDER BY id DESC LIMIT 10) sub ORDER BY id ASC',
        [userId]
      );
      const chatHistory = historyRes.rows;

      let analogiesContext = "";
      if (mind && mind.learning_analogies && mind.learning_analogies.length > 0) {
        analogiesContext = `The user learns best through analogies related to: [${mind.learning_analogies.join(', ')}]. ALWAYS try to weave these themes naturally into your explanations.`;
      }

      let systemPrompt = `You are Nguru, an elite, highly intelligent mentorship AI. 
      You are speaking with ${userNameCapitalized}. 
      ${analogiesContext}

      CRITICAL RULES:
      1. Act like a real, wise mentor. Talk like a human expert.
      2. If the user asks a simple question, answer it simply and naturally.
      3. ONLY if the user asks a highly complex academic question that requires a foundational prerequisite they clearly don't have, output EXACTLY: 'This is very deep to understand. We need to know [Insert Prerequisite] first.'`;

      let responseFlags = { is_testing: false, inject_video: false, video_id: null, deferred_topic: null };

      // 3. THE YOUTUBE PIVOT TRIGGER
      const criticalWeakPoint = weakPoints.find(wp => wp.failure_count >= 2);
      if (criticalWeakPoint) {
        const videoId = await searchYouTube(criticalWeakPoint.failed_concept);
        await pool.query("UPDATE weak_points SET status = 'resolved' WHERE id = $1", [criticalWeakPoint.id]);

        return {
          ai_response_text: `Let's pause, ${userNameCapitalized}. Text isn't working for ${criticalWeakPoint.failed_concept}. Watch this visual breakdown, then tell me if it clicks.`,
          is_testing: false, 
          inject_video: true, 
          video_id: videoId,
          deferred_topic: null
        };
      }

      // 4. Generate AI Text
      const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);

      if (rawAiResponse && rawAiResponse.includes("This is very deep to understand. We need to know")) {
        const prerequisite = rawAiResponse.split("know ")[1].replace(" first.", "").trim();
        await pool.query(
          'INSERT INTO learning_states (user_id, deferred_topics) VALUES ($1, ARRAY[$2]) ON CONFLICT (user_id) DO UPDATE SET deferred_topics = array_append(learning_states.deferred_topics, $2)',
          [userId, prerequisite]
        );
        responseFlags.deferred_topic = prerequisite;
      }

      // 5. Save Memory
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)", [userId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)", [userId, rawAiResponse || "I am processing that..."]);

      return { ai_response_text: rawAiResponse || "I am processing that...", ...responseFlags };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; // Let the server catch it and return 500
  }
}

module.exports = { processNguruMessage };
