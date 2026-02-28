// nguruEngine.js
const { MindObject, LearningState, WeakPoint } = require('./models');
const { generateAIResponse } = require('./aiClient');

async function processNguruMessage(userId, userMessage) {
  // 1. Fetch the user's specific Mind Object and current state from MongoDB
  const mind = await MindObject.findOne({ userId });
  const state = await LearningState.findOne({ userId });
  const weakPoints = await WeakPoint.find({ userId, status: 'unresolved' });

  let systemPrompt = "You are Nguru, a highly specialized educational AI. You do not give generic answers. ";
  let responseFlags = {
    is_testing: false,
    inject_video: false,
    deferred_topic: null
  };

  // STEP 4: The Media Pivot (Check this FIRST)
  // If they failed a concept twice, short-circuit the AI completely and trigger a video.
  const criticalWeakPoint = weakPoints.find(wp => wp.failure_count >= 2);
  if (criticalWeakPoint) {
    return {
      ai_response_text: `Text explanations aren't working for this. Let's look at a visual for ${criticalWeakPoint.failed_concept}.`,
      is_testing: false,
      inject_video: true,
      deferred_topic: null
    };
  }

  // STEP 1: The "Hold & Drill" Mechanic
  const lowerMessage = userMessage.toLowerCase();
  const indicatesConfusion = lowerMessage.includes("i don't get") || lowerMessage.includes("confused") || lowerMessage.includes("hard");
  
  if (indicatesConfusion && mind.learning_analogies.length > 0) {
    const analogies = mind.learning_analogies.join(', ');
    systemPrompt += `\nThe user is confused. Isolate the current topic. You MUST explain it using ONLY an analogy based on these interests: [${analogies}]. Do not generate a broad new lesson. `;
  }

  // STEP 2: The "Very Deep" Deflection
  systemPrompt += `\nCRITICAL RULE: If the user asks a question that skips fundamental prerequisites, you must refuse to answer it directly. Output EXACTLY: 'This is very deep to understand. We need to know [Insert Prerequisite Name] first.' `;

  // STEP 3: The Weak Point Interrogator
  if (!indicatesConfusion && weakPoints.length > 0) {
    const targetConcept = weakPoints[0].failed_concept;
    systemPrompt += `\nBefore finishing your response, you MUST ask the user a direct, challenging question about '${targetConcept}' to test if they finally understand it. `;
    responseFlags.is_testing = true;
  }

  // 5. Fire the constructed algorithm to the AI Client
  const rawAiResponse = await generateAIResponse(systemPrompt, userMessage);

  // 6. Post-Processing: Check if the AI triggered the "Very Deep" deflection
  if (rawAiResponse.includes("This is very deep to understand. We need to know")) {
    // Extract what the prerequisite is
    const prerequisite = rawAiResponse.split("know ")[1].replace(" first.", "").trim();
    
    // Park this topic in the database so Nguru remembers to teach it later
    await LearningState.findOneAndUpdate(
      { userId },
      { $push: { deferred_topics: prerequisite } },
      { upsert: true }
    );
    
    responseFlags.deferred_topic = prerequisite;
  }

  // Return the fully structured JSON package to send to the phone
  return {
    ai_response_text: rawAiResponse,
    ...responseFlags
  };
}

module.exports = { processNguruMessage };
