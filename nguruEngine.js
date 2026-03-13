const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');
const { searchYouTube } = require('./youtubeClient');

const ensureBrainTables = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role VARCHAR(50), message TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS weak_points (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, failed_concept VARCHAR(255), failure_count INTEGER DEFAULT 1, status VARCHAR(50) DEFAULT 'unresolved')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS learning_states (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, deferred_topics TEXT[])`);
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

      // THE IRON MENTOR PROMPT
      let systemPrompt = `You are Nguru, an elite, highly intelligent, and direct mentorship AI speaking with ${userNameCapitalized}.
      USER CONTEXT: They learn using analogies related to: [${mind?.learning_analogies?.join(', ') || 'General concepts'}].
      
      CRITICAL COMMUNICATION RULES:
      1. NO LECTURES. Keep responses strictly to 2 short, punchy sentences. 
      2. ZERO APOLOGIES. Never say "I'm sorry", "I hear you", "Got it", or "No worries". Be a confident, street-smart guide.
      3. RARE ANALOGIES. Do not force their analogies into every message. Use them ONLY when introducing a highly complex topic, then drop them.
      4. YOU HAVE YOUTUBE CAPABILITIES. If the user explicitly asks for a video, visual, or says they are confused, YOU MUST silently include "[FLAG_CONFUSED: Concept_Name]" at the end of your response. NEVER say "I can't show videos".`;

      const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);
      
      let cleanAiResponse = rawAiResponse;
      let conceptToFlag = null;

      const implicitMatch = rawAiResponse.match(/\[FLAG_CONFUSED:\s*(.+?)\]/);
      const explicitConfusion = userMessage.toLowerCase().match(/(don't understand|confused|get it|video|visual|show me)/);
      
      if (implicitMatch) {
         conceptToFlag = implicitMatch[1];
         cleanAiResponse = rawAiResponse.replace(implicitMatch[0], '').trim();
      } else if (explicitConfusion) {
         conceptToFlag = "this concept"; 
      }

      // THE YOUTUBE PIVOT
      if (conceptToFlag) {
          const wpCheck = await pool.query('SELECT * FROM weak_points WHERE user_id = $1 AND failed_concept = $2 AND status = $3', [userId, conceptToFlag, 'unresolved']);
          let fails = 1;
          
          if (wpCheck.rows.length > 0) {
              fails = wpCheck.rows[0].failure_count + 1;
              await pool.query('UPDATE weak_points SET failure_count = $1 WHERE id = $2', [fails, wpCheck.rows[0].id]);
          } else {
              await pool.query('INSERT INTO weak_points (user_id, failed_concept, failure_count) VALUES ($1, $2, 1)', [userId, conceptToFlag]);
          }

          if (fails >= 2 || userMessage.toLowerCase().includes("video")) {
              const videoId = await searchYouTube(conceptToFlag);
              await pool.query("UPDATE weak_points SET status = 'resolved' WHERE user_id = $1 AND failed_concept = $2", [userId, conceptToFlag]);
              
              if(videoId) {
                  return {
                      ai_response_text: `Text isn't doing it justice. Watch this visual breakdown, then tell me what you see.`,
                      inject_video: true,
                      video_id: videoId
                  };
              }
          }
      }

      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)", [userId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)", [userId, cleanAiResponse]);

      return { ai_response_text: cleanAiResponse };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; 
  }
}

module.exports = { processNguruMessage };
