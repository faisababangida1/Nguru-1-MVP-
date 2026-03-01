const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { generateAIResponse } = require('./aiClient');

const OUTPUT_DIR = process.env.VIDEO_OUTPUT_DIR || path.join(__dirname, 'generated-videos');

function sanitizeForDrawtext(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/\n/g, ' ');
}

function safeName(value) {
  return String(value || 'clip').replace(/[^a-z0-9-_]/gi, '_').slice(0, 40);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });

    process.on('error', (error) => reject(error));
  });
}

function getDurationSeconds({ durationSeconds, isVeryViral }) {
  if (isVeryViral) {
    return Math.max(60, Math.min(Number(durationSeconds) || 75, 90));
  }

  return 60;
}

function fallbackStoryboard(topic, durationSeconds) {
  const sceneCount = 6;
  const sceneDuration = Math.floor(durationSeconds / sceneCount);

  return {
    title: `Viral ${topic} reel`,
    hook: `The ${topic} hack nobody explains correctly.`,
    scenes: Array.from({ length: sceneCount }).map((_, index) => ({
      caption: `${index + 1}. ${topic} tip that boosts retention`,
      voiceover: `Step ${index + 1}. Keep this ${topic} action simple and consistent for better results.`,
      mood: 'energetic'
    })),
    outro: 'Follow for more fast, practical breakdowns.'
  };
}

function buildStoryboardPrompt({ topic, platform, durationSeconds }) {
  return [
    'You are an expert short-form video producer.',
    `Create a ${durationSeconds}-second ${platform} reel plan for topic: ${topic}.`,
    'Return strict JSON only (no markdown) with this schema:',
    '{"title":"...","hook":"...","scenes":[{"caption":"...","voiceover":"...","mood":"..."}],"outro":"..."}',
    'Generate 6 scenes with punchy language and practical value.',
    'If topic seems related to diet/health, keep claims safe and avoid medical over-promising.'
  ].join(' ');
}

async function createStoryboard({ topic, platform, durationSeconds }) {
  const systemPrompt = buildStoryboardPrompt({ topic, platform, durationSeconds });

  try {
    const responseText = await generateAIResponse(systemPrompt, topic);
    const parsed = JSON.parse(responseText);

    if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      return fallbackStoryboard(topic, durationSeconds);
    }

    return parsed;
  } catch (error) {
    return fallbackStoryboard(topic, durationSeconds);
  }
}

function buildFilterGraph({ storyboard, durationSeconds }) {
  const sceneCount = storyboard.scenes.length || 1;
  const section = durationSeconds / sceneCount;

  const textLayers = storyboard.scenes.map((scene, index) => {
    const start = Number((index * section).toFixed(2));
    const end = Number(((index + 1) * section).toFixed(2));
    const caption = sanitizeForDrawtext(scene.caption || '');

    return `drawtext=fontcolor=white:fontsize=56:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${caption}':x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.45:boxborderw=20:enable='between(t,${start},${end})'`;
  });

  const hookText = sanitizeForDrawtext(storyboard.hook || storyboard.title || 'Viral video');
  const outroText = sanitizeForDrawtext(storyboard.outro || 'Follow for more');
  const outroStart = Math.max(durationSeconds - 6, 0);

  return [
    "[0:v]scale=1080:1920,format=yuv420p",
    "eq=contrast=1.1:saturation=1.25:brightness=0.02",
    `drawtext=fontcolor=yellow:fontsize=72:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${hookText}':x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.5:boxborderw=20:enable='between(t,0,5)'`,
    ...textLayers,
    `drawtext=fontcolor=white:fontsize=64:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${outroText}':x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.55:boxborderw=20:enable='between(t,${outroStart},${durationSeconds})'`
  ].join(',');
}

async function generateReelVideo({ topic, platform = 'youtube', durationSeconds, isVeryViral = false }) {
  if (!topic || !String(topic).trim()) {
    throw new Error('topic is required to generate a reel');
  }

  const finalDuration = getDurationSeconds({ durationSeconds, isVeryViral });
  const storyboard = await createStoryboard({
    topic: topic.trim(),
    platform,
    durationSeconds: finalDuration
  });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const baseName = `${safeName(platform)}-${safeName(topic)}-${id}`;
  const outputVideoPath = path.join(OUTPUT_DIR, `${baseName}.mp4`);
  const outputStoryboardPath = path.join(OUTPUT_DIR, `${baseName}.json`);

  const colors = ['#111827', '#0f172a', '#1f2937', '#111827'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const filterGraph = buildFilterGraph({ storyboard, durationSeconds: finalDuration });

  await runCommand('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=1080x1920:d=${finalDuration}`,
    '-f', 'lavfi',
    '-i', `anoisesrc=color=pink:amplitude=0.03:d=${finalDuration}`,
    '-filter_complex', filterGraph,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputVideoPath
  ]);

  await fs.writeFile(outputStoryboardPath, JSON.stringify({
    request: { topic, platform, durationSeconds: finalDuration, isVeryViral },
    storyboard
  }, null, 2));

  return {
    outputVideoPath,
    outputStoryboardPath,
    durationSeconds: finalDuration,
    storyboard
  };
}

module.exports = { generateReelVideo };
