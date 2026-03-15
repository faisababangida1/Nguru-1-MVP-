const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');
const { searchYouTube } = require('./youtubeClient');

const ensureBrainTables = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role VARCHAR(50), message TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, title VARCHAR(255) DEFAULT 'New Chat', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  try {
      await pool.query(`ALTER TABLE chat_history ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE`);
  } catch (e) {
      // Column exists, safe to continue
  }
};

async function processNguruMessage(userId, sessionId, userMessage) {
  try {
      await ensureBrainTables();

      const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length === 0) throw new Error("Ghost User ID trapped in memory.");
      
      const userNameCapitalized = userRes.rows[0].email.split('@')[0].charAt(0).toUpperCase() + userRes.rows[0].email.split('@')[0].slice(1);
      const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
      const mind = mindRes.rows[0];

      let activeSessionId = sessionId;

      if (!activeSessionId) {
          const titlePrompt = `Summarize this message in 3 words or less for a chat title: "${userMessage}"`;
          let chatTitle = await generateAIResponse("You are a title generator. Reply ONLY with the title, no quotes.", [], titlePrompt);
          chatTitle = chatTitle.replace(/["']/g, '').trim();

          const newSession = await pool.query(
              `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id`, 
              [userId, chatTitle]
          );
          activeSessionId = newSession.rows[0].id;
      }

      const historyRes = await pool.query(
          'SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE user_id = $1 AND session_id = $2 ORDER BY id DESC LIMIT 8) sub ORDER BY id ASC', 
          [userId, activeSessionId]
      );
      const chatHistory = historyRes.rows;

      // NGURU IDENTITY RESTORED
      let systemPrompt = `You are Nguru, an elite, highly intelligent, and encouraging mentorship AI speaking with ${userNameCapitalized}.
      
      CRITICAL KNOWLEDGE RULE: You are an absolute expert in ALL subjects (e.g., Material Science, Physics, Coding, Business, History, etc.). You must enthusiastically teach the user whatever subject they ask about. NEVER say a topic is outside your scope.

      USER CONTEXT & ANALOGIES: The user grasps complex topics best when they are compared to: [${mind?.learning_analogies?.join(', ') || 'everyday life'}]. 
      HOW TO USE THIS: If the user asks about Material Science, explain Material Science perfectly, but use a quick analogy about ${mind?.learning_analogies?.[0] || 'sports'} to make it click. NEVER tell the user you only teach those specific analogy topics.
      
      COMMUNICATION STYLE:
      1. MAXIMUM 3 SENTENCES. Be concise, conversational, and easy to read.
      2. BE AN ENCOURAGING MENTOR. Do not be rude, dismissive, or argue. Guide them patiently.
      3. DYNAMIC VIDEO FETCHING: If they explicitly ask for a video, or say they are frustrated/confused, you MUST include a secret command at the end of your response like: [FETCH_VIDEO: The Exact Educational Concept]. Use the chat history to determine the specific scientific or academic concept they need to see.`;

      const rawAiResponse = await generateAIResponse(systemPrompt, chatHistory, userMessage);
      
      let cleanAiResponse = rawAiResponse;
      let videoToFetch = null;
      let injectVideo = false;
      let finalVideoId = null;

      const videoMatch = rawAiResponse.match(/\[FETCH_VIDEO:\s*(.+?)\]/i);
      
      if (videoMatch) {
          videoToFetch = videoMatch[1].trim(); 
          cleanAiResponse = rawAiResponse.replace(videoMatch[0], '').trim(); 
          
          const videoId = await searchYouTube(videoToFetch);
          if (videoId) {
              injectVideo = true;
              finalVideoId = videoId;
              cleanAiResponse += `\n\nText isn't doing this justice. Watch this visual breakdown of ${videoToFetch}, then tell me what clicks.`;
          }
      }

      await pool.query("INSERT INTO chat_history (user_id, session_id, role, message) VALUES ($1, $2, 'user', $3)", [userId, activeSessionId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, session_id, role, message) VALUES ($1, $2, 'ai', $3)", [userId, activeSessionId, cleanAiResponse]);

      return { 
          ai_response_text: cleanAiResponse,
          inject_video: injectVideo,
          video_id: finalVideoId,
          session_id: activeSessionId
      };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; 
  }
}

module.exports = { processNguruMessage };
