const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');
const { searchYouTube } = require('./youtubeClient');

const ensureBrainTables = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role VARCHAR(50), message TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS current_topics (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, topic VARCHAR(255), failure_count INTEGER DEFAULT 0)`);
};

// A helper function to extract the main noun/concept from the AI's last message
const extractTopic = (text) => {
    if (!text) return "physics concepts";
    // We look for the first major noun or capitalized phrase. If it fails, default to a safe search term.
    const words = text.split(' ');
    const firstFewWords = words.slice(0, 4).join(' ').replace(/[^\w\s]/gi, ''); 
    return firstFewWords || "science concept";
};

async function processNguruMessage(userId, userMessage) {
  try {
      await ensureBrainTables();

      const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length === 0) throw new Error("Ghost User ID trapped in memory.");
      
      const userNameCapitalized = userRes.rows[0].email.split('@')[0].charAt(0).toUpperCase() + userRes.rows[0].email.split('@')[0].slice(1);
      const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
      const mind = mindRes.rows[0];

      const historyRes = await pool.query('SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE user_id = $1 ORDER BY id DESC LIMIT 6) sub ORDER BY id ASC', [userId]);
      const chatHistory = historyRes.rows;

      const userMsgLower = userMessage.toLowerCase();
      
      // 1. THE HARD-CODED INTERCEPTOR
      // We don't trust the AI to flag confusion anymore. We check the user's text directly.
      const isFrustrated = userMsgLower.includes("don't understand") || userMsgLower.includes("don't get") || userMsgLower.includes("confused") || userMsgLower.includes("hard to grasp");
      const wantsVideo = userMsgLower.includes("video") || userMsgLower.includes("show me") || userMsgLower.includes("visual") || userMsgLower.includes("watch");

      // Get the last topic we were talking about
      const topicRes = await pool.query('SELECT * FROM current_topics WHERE user_id = $1', [userId]);
      let currentTopic = topicRes.rows.length > 0 ? topicRes.rows[0].topic : "science concept";
      let fails = topicRes.rows.length > 0 ? topicRes.rows[0].failure_count : 0;

      // 2. THE AGGRESSIVE VIDEO PIVOT
      if (isFrustrated) {
          fails += 1;
          await pool.query('INSERT INTO current_topics (user_id, topic, failure_count) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET failure_count = $3', [userId, currentTopic, fails]);
      }

      // If they failed twice OR directly asked for a video, we drop the video instantly. No AI required.
      if (fails >= 2 || wantsVideo) {
          // Reset the failure count so we don't get stuck in a video loop forever
          await pool.query('UPDATE current_topics SET failure_count = 0 WHERE user_id = $1', [userId]);
          
          const videoId = await searchYouTube(currentTopic);
          
          // Save this to chat history so the AI remembers we showed a video
          const videoMsg = `I showed a video about ${currentTopic}.`;
          await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)", [userId, userMessage]);
          await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)", [userId, videoMsg]);

          if (videoId) {
              return {
                  ai_response_text: `Text isn't working for this. Watch this visual breakdown of ${currentTopic}, then tell me what clicks.`,
                  inject_video: true,
                  video_id: videoId
              };
          } else {
              return { ai_response_text: `I tried to pull up a video on ${currentTopic}, but my connection failed. Let's try breaking it down another way.` };
          }
      }

      // 3. NORMAL TEXT GENERATION (If they aren't frustrated)
      let systemPrompt = `You are Nguru, an elite, highly intelligent, direct mentorship AI speaking with ${userNameCapitalized}.
      USER CONTEXT: They learn using analogies related to: [${mind?.learning_analogies?.join(', ') || 'General concepts'}].
      
      CRITICAL COMMUNICATION RULES:
      1. MAXIMUM 2 SENTENCES. Be extremely concise.
      2. ZERO APOLOGIES. Do not say "I hear you", "No worries", or "Got it."
      3. USE ANALOGIES RARELY. DO NOT use an analogy in every message. Only use one if the user asks a complex question. If they ask a simple question, give a simple, literal answer.`;

      const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);
      
      // Update our tracker with whatever new topic the AI just brought up
      const newTopic = extractTopic(rawAiResponse);
      await pool.query('INSERT INTO current_topics (user_id, topic, failure_count) VALUES ($1, $2, 0) ON CONFLICT (user_id) DO UPDATE SET topic = $2', [userId, newTopic]);

      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)", [userId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)", [userId, rawAiResponse]);

      return { ai_response_text: rawAiResponse };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; 
  }
}

module.exports = { processNguruMessage };
