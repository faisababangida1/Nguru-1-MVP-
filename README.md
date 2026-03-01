# Nguru-1-MVP-
The backend and login.

## API Endpoints

### Authentication
- `POST /api/auth/register`
- `POST /api/auth/login`

### Nguru chat
- `POST /api/chat`

### Short-form video generator
- `POST /api/video/generate`

Generate a ready-to-publish vertical video for YouTube Shorts or TikTok.

#### Request body
```json
{
  "topic": "High-protein diet for fat loss",
  "platform": "tiktok",
  "durationSeconds": 60,
  "isVeryViral": false
}
```

#### Behavior
- Generates a full MP4 video with 1080x1920 format.
- Adds scene captions, hook, and outro text overlays.
- Produces audio track for the full duration.
- Uses 60 seconds by default.
- If `isVeryViral` is true, duration can expand up to 90 seconds.

#### Response (example)
```json
{
  "message": "Video generated successfully.",
  "outputVideoPath": "/workspace/Nguru-1-MVP-/generated-videos/tiktok-High_protein_diet_for_fat_loss-12345678.mp4",
  "outputStoryboardPath": "/workspace/Nguru-1-MVP-/generated-videos/tiktok-High_protein_diet_for_fat_loss-12345678.json",
  "durationSeconds": 60,
  "storyboard": {
    "title": "Viral diet reel",
    "hook": "...",
    "scenes": [
      { "caption": "...", "voiceover": "...", "mood": "energetic" }
    ],
    "outro": "..."
  }
}
```

> Note: video rendering requires `ffmpeg` to be installed in the runtime environment.
