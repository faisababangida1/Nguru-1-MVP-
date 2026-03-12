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

      // 1. THE NEW PERSONALITY AND TEXT-MESSAGE RULE
      let systemPrompt = `You are Nguru, an elite, street-smart mentorship AI speaking with ${userNameCapitalized}.
      USER CONTEXT: They learn well using analogies related to: [${mind?.learning_analogies?.join(', ') || 'General concepts'}].
      
      CRITICAL COMMUNICATION RULES:
      1. DO NOT LECTURE. Keep responses to 2 or 3 short sentences maximum. Act like we are texting.
      2. Do NOT use their analogies in every message. Only use an analogy ONCE to explain a complex topic. Never force it.
      3. Do not constantly apologize. Be confident, direct, and conversational.

      // 2. THE "EGO BYPASS" (IMPLICIT CONFUSION DETECTION)
      Read between the lines. If the user's message implies they are confused, guessing incorrectly, or subtly struggling (e.g., they ask "but why?", "huh?", "is it like...", or ask the same question again), YOU MUST silently include the exact text "[FLAG_CONFUSED: Concept_Name]" at the very end of your response. Replace 'Concept_Name' with the 1 or 2 word topic they are stuck on. Do this even if they don't explicitly say "I don't understand."`;

      const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);
      
      let cleanAiResponse = rawAiResponse;
      let conceptToFlag = null;

      // Check if the AI secretly flagged them as confused, OR if they said it explicitly
      const implicitMatch = rawAiResponse.match(/\[FLAG_CONFUSED:\s*(.+?)\]/);
      const explicitConfusion = userMessage.toLowerCase().includes("don't understand") || userMessage.toLowerCase().includes("don't get") || userMessage.toLowerCase().includes("confused");
      
      if (implicitMatch) {
         conceptToFlag = implicitMatch[1];
         cleanAiResponse = rawAiResponse.replace(implicitMatch[0], '').trim(); // Hide the flag from the user
      } else if (explicitConfusion) {
         conceptToFlag = "the current topic"; // Fallback if AI missed the flag but user said it
      }

      // 3. LOG THE FRUSTRATION AND PIVOT TO YOUTUBE
      if (conceptToFlag) {
          const wpCheck = await pool.query('SELECT * FROM weak_points WHERE user_id = $1 AND failed_concept = $2 AND status = $3', [userId, conceptToFlag, 'unresolved']);
          let fails = 1;
          
          if (wpCheck.rows.length > 0) {
              fails = wpCheck.rows[0].failure_count + 1;
              await pool.query('UPDATE weak_points SET failure_count = $1 WHERE id = $2', [fails, wpCheck.rows[0].id]);
          } else {
              await pool.query('INSERT INTO weak_points (user_id, failed_concept, failure_count) VALUES ($1, $2, 1)', [userId, conceptToFlag]);
          }

          if (fails >= 2) {
              const videoId = await searchYouTube(conceptToFlag);
              await pool.query("UPDATE weak_points SET status = 'resolved' WHERE user_id = $1 AND failed_concept = $2", [userId, conceptToFlag]);
              
              // Skip the text lecture entirely and drop the video
              return {
                  ai_response_text: `Okay, let's switch gears. Trying to force this with text isn't working. Watch this quick visual breakdown of ${conceptToFlag}, then tell me what you think.`,
                  inject_video: true,
                  video_id: videoId
              };
          }
      }

      // 4. Save normal memory
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)", [userId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)", [userId, cleanAiResponse]);

      return { ai_response_text: cleanAiResponse };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; 
  }
}

module.exports = { processNguruMessage };
