// aiClient.js

// Securely pulling your API key from Render Environment Variables
const API_KEY = process.env.AI_API_KEY; 

// The officially verified REST endpoint for the active Gemini 2.5 Flash model
const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function generateAIResponse(systemInstruction, userMessage) {
  if (!API_KEY) {
    console.error("CRITICAL ERROR: AI_API_KEY is missing from environment variables.");
    return "Nguru Engine Error: API Key missing.";
  }

  try {
    // The OFFICIAL JSON payload structure separated into instructions and contents
    const payload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        parts: [{ text: userMessage }]
      }]
    };

    const response = await fetch(`${AI_ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    // If Google rejects the request, this forces Render to print the EXACT reason.
    if (!response.ok || !data.candidates) {
      console.error("GOOGLE API REJECTED THE REQUEST. RAW RESPONSE:", JSON.stringify(data, null, 2));
      throw new Error(`Google API Error: ${data.error?.message || "Unknown error"}`);
    }

    // Safely extract the AI's response text
    return data.candidates[0].content.parts[0].text;
    
  } catch (error) {
    console.error("AI Client Error:", error.message);
    return "Nguru is currently taking a breath. Please try again in a moment.";
  }
}

module.exports = { generateAIResponse };
