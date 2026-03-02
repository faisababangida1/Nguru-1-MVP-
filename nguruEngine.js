const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');

async function processNguruMessage(userId, userMessage) {
  const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
  const weakRes = await pool.query("SELECT * FROM weak_points WHERE user_id = $1 AND status = 'unresolved'", [userId]);

  const mind = mindRes.rows[0];
  const weakPoints = weakRes.rows;

  let systemPrompt = "You are Nguru, a highly specialized educational AI. You do not give generic answers. ";
  let responseFlags = { is_testing: false, inject_video: false, deferred_topic: null };

  const criticalWeakPoint = weakPoints.find(wp => wp.failure_count >= 2);
  if (criticalWeakPoint) {
    return {
      ai_response_text: `Text explanations aren't working for this. Let's look at a visual for ${criticalWeakPoint.failed_concept}.`,
      is_testing: false, inject_video: true, deferred_topic: null
    };
  }

  const lowerMessage = userMessage.toLowerCase();
  const indicatesConfusion = lowerMessage.includes("i don't get") || lowerMessage.includes("confused") || lowerMessage.includes("hard");
  
  if (indicatesConfusion && mind.learning_analogies && mind.learning_analogies.length > 0) {
    const analogies = mind.learning_analogies.join(', ');
    systemPrompt += `\nThe user is confused. Isolate the current topic. You MUST explain it using ONLY an analogy based on these interests: [${analogies}]. Do not generate a broad new lesson. `;
  }

  systemPrompt += `\nCRITICAL RULE: If the user asks a question that skips fundamental prerequisites, you must refuse to answer it directly. Output EXACTLY: 'This is very deep to understand. We need to know [Insert Prerequisite Name] first.' `;

  if (!indicatesConfusion && weakPoints.length > 0) {
    const targetConcept = weakPoints[0].failed_concept;
    systemPrompt += `\nBefore finishing your response, you MUST ask the user a direct, challenging question about '${targetConcept}' to test if they finally understand it. `;
    responseFlags.is_testing = true;
  }

  const rawAiResponse = await generateAIResponse(systemPrompt, userMessage);

  if (rawAiResponse.includes("This is very deep to understand. We need to know")) {
    const prerequisite = rawAiResponse.split("know ")[1].replace(" first.", "").trim();
    
    await pool.query(
      'UPDATE learning_states SET deferred_topics = array_append(deferred_topics, $1) WHERE user_id = $2',
      [prerequisite, userId]
    );
    responseFlags.deferred_topic = prerequisite;
  }

  return { ai_response_text: rawAiResponse, ...responseFlags };
}

module.exports = { processNguruMessage };
