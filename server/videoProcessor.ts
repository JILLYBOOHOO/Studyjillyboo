import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg';
const FFPROBE_BIN = fs.existsSync('/usr/bin/ffprobe') ? '/usr/bin/ffprobe' : 'ffprobe';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_VIDEO_SESSIONS = 5;

export interface VideoProbeInfo {
  durationSeconds: number;
  sizeBytes: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
}

export interface VideoSessionRecord {
  sessionId: string;
  dirPath: string;
  videoPath: string | null;
  audioPath: string | null;
  originalFileName: string;
  mimeType: string;
  durationSeconds: number;
  screenshotPaths: string[];
  createdAt: number;
  expiresAt: number;
}

const videoSessionStore = new Map<string, VideoSessionRecord>();

export function getVideoSessionsRoot(uploadsDir: string): string {
  const dir = path.join(uploadsDir, 'video_sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeRmDir(dirPath: string) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup failures
  }
}

export function pruneVideoSessions(uploadsDir: string) {
  const now = Date.now();
  for (const [id, rec] of videoSessionStore.entries()) {
    if (rec.expiresAt <= now) {
      safeRmDir(rec.dirPath);
      videoSessionStore.delete(id);
    }
  }

  while (videoSessionStore.size >= MAX_VIDEO_SESSIONS) {
    const oldestKey = videoSessionStore.keys().next().value;
    if (!oldestKey) break;
    const oldRec = videoSessionStore.get(oldestKey);
    if (oldRec) safeRmDir(oldRec.dirPath);
    videoSessionStore.delete(oldestKey);
  }

  // Also sweep orphaned directories older than TTL
  const root = getVideoSessionsRoot(uploadsDir);
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!videoSessionStore.has(ent.name)) {
        const full = path.join(root, ent.name);
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > SESSION_TTL_MS) {
          safeRmDir(full);
        }
      }
    }
  } catch {
    // ignore sweep errors
  }
}

export function createVideoSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `vid_${Date.now()}_${rand}`;
}

export function registerVideoSession(record: VideoSessionRecord) {
  videoSessionStore.set(record.sessionId, record);
}

export function getVideoSession(sessionId: string): VideoSessionRecord | null {
  const rec = videoSessionStore.get(sessionId);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    safeRmDir(rec.dirPath);
    videoSessionStore.delete(sessionId);
    return null;
  }
  return rec;
}

export function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export async function probeMedia(filePath: string): Promise<VideoProbeInfo> {
  const stat = fs.statSync(filePath);
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration,size:stream=codec_type,width,height',
        '-of',
        'json',
        filePath,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || '{}') as {
      format?: { duration?: string; size?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');
    return {
      durationSeconds: Math.max(0, Math.round(Number(parsed.format?.duration || 0))),
      sizeBytes: Number(parsed.format?.size || stat.size),
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
      width: Number(videoStream?.width || 0),
      height: Number(videoStream?.height || 0),
    };
  } catch {
    return {
      durationSeconds: 0,
      sizeBytes: stat.size,
      hasVideo: false,
      hasAudio: true,
      width: 0,
      height: 0,
    };
  }
}

export async function prepareLectureMedia(
  inputPath: string,
  sessionDir: string,
  originalName: string,
): Promise<{
  probe: VideoProbeInfo;
  audioPath: string | null;
  videoPath: string | null;
  wasCompressed: boolean;
  compressedSizeMb: number;
  originalSizeMb: number;
}> {
  fs.mkdirSync(sessionDir, { recursive: true });
  const probe = await probeMedia(inputPath);
  const originalSizeMb = Number((probe.sizeBytes / (1024 * 1024)).toFixed(2));

  const audioPath = path.join(sessionDir, 'speech_16k.mp3');
  let finalAudioPath: string | null = null;

  // 1. Extract speech-enhanced 16kHz mono MP3 for accent-resilient transcription
  try {
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-af',
        'highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=50',
        '-b:a',
        '48k',
        audioPath,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 },
    );
    if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 100) {
      finalAudioPath = audioPath;
    }
  } catch {
    // Fallback without audio filter in case source stream is unusual
    try {
      await execFileAsync(
        FFMPEG_BIN,
        ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audioPath],
        { maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      );
      if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 100) {
        finalAudioPath = audioPath;
      }
    } catch {
      finalAudioPath = null;
    }
  }

  // 2. Compress/normalize video for smooth streaming, frame capture, and Gemini upload
  let finalVideoPath: string | null = null;
  let wasCompressed = false;

  if (probe.hasVideo) {
    const compressedMp4 = path.join(sessionDir, 'lecture_optimized.mp4');
    const ext = path.extname(originalName).toLowerCase();
    const needsCompression =
      probe.sizeBytes > 32 * 1024 * 1024 ||
      probe.width > 960 ||
      ext !== '.mp4';

    if (needsCompression) {
      try {
        await execFileAsync(
          FFMPEG_BIN,
          [
            '-y',
            '-i',
            inputPath,
            '-vf',
            "scale='min(960,iw)':-2",
            '-r',
            '4',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '30',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '64k',
            '-movflags',
            '+faststart',
            compressedMp4,
          ],
          { maxBuffer: 12 * 1024 * 1024, timeout: 15 * 60 * 1000 },
        );
        if (fs.existsSync(compressedMp4) && fs.statSync(compressedMp4).size > 1000) {
          finalVideoPath = compressedMp4;
          wasCompressed = true;
        }
      } catch {
        // Fallback: copy original into sessionDir so player/cutter still work
        fs.copyFileSync(inputPath, compressedMp4);
        finalVideoPath = compressedMp4;
      }
    } else {
      fs.copyFileSync(inputPath, compressedMp4);
      finalVideoPath = compressedMp4;
    }
  }

  const activeMediaForSize = finalVideoPath || finalAudioPath || inputPath;
  const compressedSizeMb = Number(
    (fs.statSync(activeMediaForSize).size / (1024 * 1024)).toFixed(2),
  );

  return {
    probe,
    audioPath: finalAudioPath,
    videoPath: finalVideoPath,
    wasCompressed,
    compressedSizeMb,
    originalSizeMb,
  };
}

export async function extractFrameJpg(
  videoPath: string,
  seconds: number,
  outPath: string,
): Promise<boolean> {
  const safeSec = Math.max(0, Number(seconds) || 0);
  try {
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y',
        '-ss',
        String(safeSec),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        outPath,
      ],
      { maxBuffer: 2 * 1024 * 1024, timeout: 30 * 1000 },
    );
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 500;
  } catch {
    return false;
  }
}

export async function cutVideoClip(
  videoPath: string,
  startSeconds: number,
  endSeconds: number,
  outPath: string,
): Promise<boolean> {
  const safeStart = Math.max(0, Number(startSeconds) || 0);
  const rawEnd = Math.max(safeStart + 2, Number(endSeconds) || safeStart + 20);
  const safeEnd = Math.min(safeStart + 600, rawEnd); // cap clip cuts to 10 min max

  await execFileAsync(
    FFMPEG_BIN,
    [
      '-y',
      '-ss',
      String(safeStart),
      '-to',
      String(safeEnd),
      '-i',
      videoPath,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { maxBuffer: 8 * 1024 * 1024, timeout: 5 * 60 * 1000 },
  );
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 1000;
}

export { SESSION_TTL_MS };
