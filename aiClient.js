// aiClient.js

const API_KEY = process.env.AI_API_KEY; 
const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function generateAIResponse(systemInstruction, chatHistory, userMessage) {
  if (!API_KEY) {
    console.error("CRITICAL ERROR: AI_API_KEY is missing from environment variables.");
    return "Nguru Engine Error: API Key missing.";
  }

  try {
    // Format the past conversation so Gemini understands who said what
    const formattedHistory = chatHistory.map(msg => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.message }]
    }));

    // Add the brand new message to the end of the history
    formattedHistory.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const payload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: formattedHistory
    };

    const response = await fetch(`${AI_ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok || !data.candidates) {
      console.error("GOOGLE API REJECTED THE REQUEST. RAW RESPONSE:", JSON.stringify(data, null, 2));
      throw new Error(`Google API Error: ${data.error?.message || "Unknown error"}`);
    }

    return data.candidates[0].content.parts[0].text;
    
  } catch (error) {
    console.error("AI Client Error:", error.message);
    return "Nguru is currently taking a breath. Please try again in a moment.";
  }
}

module.exports = { generateAIResponse };
