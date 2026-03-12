// youtubeClient.js
const searchYouTube = async (searchQuery) => {
  if (!process.env.YOUTUBE_API_KEY) {
    console.error("Missing YOUTUBE_API_KEY in Render environment.");
    return null;
  }

  try {
    // We search for the concept and add "explained simply" to get the best educational videos
    const optimizedQuery = `${searchQuery} explained simply`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(optimizedQuery)}&type=video&key=${process.env.YOUTUBE_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].id.videoId; // This is the unique 11-character video ID
    }
    
    return null; // No video found
  } catch (error) {
    console.error("YouTube API Fetch Error:", error);
    return null;
  }
};

module.exports = { searchYouTube };
