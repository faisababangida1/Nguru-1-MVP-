const searchYouTube = async (searchQuery) => {
  if (!process.env.YOUTUBE_API_KEY) {
    console.error("Missing YOUTUBE_API_KEY in Render environment.");
    return null;
  }

  try {
    // FORCE YOUTUBE TO ONLY RETURN EDUCATIONAL VIDEOS
    const optimizedQuery = `${searchQuery} educational science explained`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(optimizedQuery)}&type=video&videoCategoryId=27&key=${process.env.YOUTUBE_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].id.videoId; 
    }
    
    return null; 
  } catch (error) {
    console.error("YouTube API Fetch Error:", error);
    return null;
  }
};

module.exports = { searchYouTube };
