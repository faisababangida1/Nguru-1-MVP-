const { pool } = require('./models');
const { generateAIResponse } = require('./aiClient');

async function processNguruMessage(userId, userMessage) {
  const mindRes = await pool.query('SELECT * FROM mind_objects WHERE user_id = $1', [userId]);
  const weakRes = await pool.query("SELECT * FROM weak_points WHERE user_id = $1 AND status = 'unresolved'", [userId]);

  const mind = mindRes.rows[0];
  const weakPoints = weakRes.rows;

  // We are making the AI much smarter and more conversational here
  let systemPrompt = "You are Nguru, a highly intelligent, conversational educational mentor. Act like a patient, wise teacher. ";
  let responseFlags = { is_testing: false, inject_video: false, deferred_topic: null };

  const criticalWeakPoint = weakPoints.find(wp => wp.failure_count >= 2);
  if (criticalWeakPoint) {
    return {
      ai_response_text: `Text explanations aren't working for this. Let's look at a visual for ${criticalWeakPoint.failed_concept}.`,
      is_testing: false, inject_video: true, deferred_topic: null
    };
  }

  const lowerMessage = userMessage.toLowerCase();
  const indicatesConfusion = lowerMessage.includes("i don't get") || lowerMessage.includes("confused") || lowerMessage.includes("hard") || lowerMessage.includes("explain");
  
  if (indicatesConfusion && mind.learning_analogies && mind.learning_analogies.length > 0) {
    const analogies = mind.learning_analogies.join(', ');
    systemPrompt += `\nThe user is confused. You MUST explain the concept using a real-world analogy based strictly on these interests: [${analogies}]. Keep it simple and relatable. `;
  }

  // REWRITTEN RULE: Only deflect if it's genuinely advanced physics, math, or deep theory.
  systemPrompt += `\nCRITICAL RULES:
  1. If the user asks a simple, basic question (like 'what is water'), just answer it naturally and simply.
  2. If the user's question lacks context (like 'how to get rid of them'), politely ask them to clarify what they mean.
  3. ONLY if the user asks a highly complex, advanced academic question that requires a foundational prerequisite they clearly don't have, you must refuse. If so, output EXACTLY: 'This is very deep to understand. We need to know [Insert Prerequisite] first.'`;

  if (!indicatesConfusion && weakPoints.length > 0) {
    const targetConcept = weakPoints[0].failed_concept;
    systemPrompt += `\nBefore finishing your response, ask the user a quick, friendly question to test if they understand '${targetConcept}'. `;
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
