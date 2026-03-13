const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');
const { searchYouTube } = require('./youtubeClient');

const ensureBrainTables = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role VARCHAR(50), message TEXT)`);
  // We no longer need the 'current_topics' table because the AI will handle context dynamically!
};

async function processNguruMessage(userId, userMessage) {
  try {
      await ensureBrainTables();

      const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length === 0) throw new Error("Ghost User ID trapped in memory.");
      
      const userNameCapitalized = userRes.rows[0].email.split('@')[0].charAt(0).toUpperCase() + userRes.rows[0].email.split('@')[0].slice(1);
      const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
      const mind = mindRes.rows[0];

      // We pull the last 8 messages to give the AI a deep understanding of the current flow
      const historyRes = await pool.query('SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE user_id = $1 ORDER BY id DESC LIMIT 8) sub ORDER BY id ASC', [userId]);
      const chatHistory = historyRes.rows;

      // 1. THE CONTEXT-AWARE PROMPT
      let systemPrompt = `You are Nguru, an elite, highly intelligent mentorship AI speaking with ${userNameCapitalized}.
      USER CONTEXT: They learn using analogies related to: [${mind?.learning_analogies?.join(', ') || 'General concepts'}].
      
      CRITICAL COMMUNICATION RULES:
      1. MAXIMUM 2 SENTENCES. Be extremely concise and conversational.
      2. ZERO APOLOGIES. Do not say "I hear you", "No worries", or "Got it." Act like a street-smart expert.
      3. DYNAMIC VIDEO FETCHING: You have a built-in YouTube engine. Read the user's latest message. If they explicitly ask for a video/visual, OR if they express frustration (e.g., "I don't understand", "I'm lost"), you MUST include a secret command at the very end of your response like this: [FETCH_VIDEO: The Exact Educational Concept]. 
      Use the entire chat history to determine the exact, specific concept they are struggling with. Do not use vague terms like 'it' or 'that'.`;

      // 2. LET THE AI THINK
      const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);
      
      let cleanAiResponse = rawAiResponse;
      let videoToFetch = null;
      let injectVideo = false;
      let finalVideoId = null;

      // 3. INTERCEPT THE SECRET COMMAND
      const videoMatch = rawAiResponse.match(/\[FETCH_VIDEO:\s*(.+?)\]/i);
      
      if (videoMatch) {
          videoToFetch = videoMatch[1].trim(); // The AI used full context to pick this search term
          cleanAiResponse = rawAiResponse.replace(videoMatch[0], '').trim(); // Hide the command from the user
          
          const videoId = await searchYouTube(videoToFetch);
          if (videoId) {
              injectVideo = true;
              finalVideoId = videoId;
              cleanAiResponse += `\n\nText isn't doing this justice. Watch this visual breakdown of ${videoToFetch}, then tell me what clicks.`;
          } else {
              cleanAiResponse += `\n\n(I tried to pull up a video on ${videoToFetch}, but my connection failed. Let's try another angle.)`;
          }
      }

      // 4. SAVE TO LONG-TERM MEMORY
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'user', $2)", [userId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, role, message) VALUES ($1, 'ai', $2)", [userId, cleanAiResponse]);

      return { 
          ai_response_text: cleanAiResponse,
          inject_video: injectVideo,
          video_id: finalVideoId
      };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; 
  }
}

module.exports = { processNguruMessage };
