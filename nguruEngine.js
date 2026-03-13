const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');
const { searchYouTube } = require('./youtubeClient');

const ensureBrainTables = async () => {
  // 1. Keep the base history table safe
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role VARCHAR(50), message TEXT)`);
  
  // 2. Build the new "Filing Cabinet" (Sessions)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) DEFAULT 'New Chat',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Safely link messages to folders (Ignores error if column already exists)
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

      // IF NO SESSION EXISTS, CREATE A NEW ONE AND GENERATE A TITLE
      if (!activeSessionId) {
          // Generate a quick 3-word title based on their first message
          const titlePrompt = `Summarize this message in 3 words or less for a chat title: "${userMessage}"`;
          let chatTitle = await generateAIResponse("You are a title generator. Reply ONLY with the title, no quotes.", [], titlePrompt);
          chatTitle = chatTitle.replace(/["']/g, '').trim();

          const newSession = await pool.query(
              `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id`, 
              [userId, chatTitle]
          );
          activeSessionId = newSession.rows[0].id;
      }

      // Fetch history ONLY for this specific session
      const historyRes = await pool.query(
          'SELECT role, message FROM (SELECT id, role, message FROM chat_history WHERE user_id = $1 AND session_id = $2 ORDER BY id DESC LIMIT 8) sub ORDER BY id ASC', 
          [userId, activeSessionId]
      );
      const chatHistory = historyRes.rows;

      let systemPrompt = `You are Nguru, an elite mentorship AI speaking with ${userNameCapitalized}.
      USER CONTEXT: They learn using analogies related to: [${mind?.learning_analogies?.join(', ') || 'General concepts'}].
      
      CRITICAL COMMUNICATION RULES:
      1. MAXIMUM 2 SENTENCES. Be concise.
      2. ZERO APOLOGIES. Do not say "I hear you" or "Got it." Act like a street-smart expert.
      3. DYNAMIC VIDEO FETCHING: If they explicitly ask for a video, or express deep frustration, you MUST include a secret command at the end of your response like: [FETCH_VIDEO: Exact Concept]. Use chat context to determine the exact concept.`;

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

      // Save messages specifically to the active folder (session_id)
      await pool.query("INSERT INTO chat_history (user_id, session_id, role, message) VALUES ($1, $2, 'user', $3)", [userId, activeSessionId, userMessage]);
      await pool.query("INSERT INTO chat_history (user_id, session_id, role, message) VALUES ($1, $2, 'ai', $3)", [userId, activeSessionId, cleanAiResponse]);

      return { 
          ai_response_text: cleanAiResponse,
          inject_video: injectVideo,
          video_id: finalVideoId,
          session_id: activeSessionId // Send the session ID back to the phone so it remembers what folder it's in!
      };
      
  } catch (error) {
      console.error("Nguru Engine Error:", error);
      throw error; 
  }
}

module.exports = { processNguruMessage };
