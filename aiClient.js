// aiClient.js

// We pull the API key securely from the environment, NEVER hardcode it here.
const API_KEY = process.env.AI_API_KEY; 

// If you are using Vertex AI / Gemini, the endpoint looks like this. 
// Change the URL if you are using OpenAI or Anthropic.
const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

async function generateAIResponse(systemInstruction, userMessage) {
  if (!API_KEY) {
    throw new Error("CRITICAL: AI_API_KEY is missing from environment variables.");
  }

  try {
    // We combine the Nguru Engine's strict system instructions with the user's prompt
    const combinedPrompt = `${systemInstruction}\n\nUser Message: ${userMessage}`;

    const response = await fetch(`${AI_ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: combinedPrompt }]
        }]
      })
    });

    const data = await response.json();
    
    // Parse the response (This parsing matches Gemini's JSON structure. Adjust if using OpenAI)
    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Invalid response from AI provider.");
    }
  } catch (error) {
    console.error("AI Client Error:", error);
    return "Nguru is currently taking a breath. Please try again in a moment.";
  }
}

module.exports = { generateAIResponse };
