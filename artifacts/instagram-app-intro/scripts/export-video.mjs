import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const WIDTH = 1080;
const HEIGHT = 1920;
const DEFAULT_URL = 'http://127.0.0.1:22762/';
const artifactDir = path.resolve(import.meta.dirname, '..');
const outputPath = path.resolve(
  artifactDir,
  'exports/instagram-intro-1080x1920.mp4',
);
const rawDir = path.resolve(artifactDir, '.recording');
const videoUrl = process.env.VIDEO_URL || DEFAULT_URL;

await rm(rawDir, { recursive: true, force: true });
await mkdir(rawDir, { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: rawDir,
    size: { width: WIDTH, height: HEIGHT },
  },
});

const page = await context.newPage();
const pageCreatedAt = Date.now();
let playbackStartedAt;
let playbackStoppedAt;
let stopPlayback;
const playbackStopped = new Promise((resolve) => {
  stopPlayback = resolve;
});

await page.exposeFunction('__portraitExportStarted', () => {
  playbackStartedAt = Date.now();
});
await page.exposeFunction('__portraitExportStopped', () => {
  playbackStoppedAt = Date.now();
  stopPlayback();
});
await page.addInitScript(() => {
  window.startRecording = async () => {
    await window.__portraitExportStarted();
  };
  window.stopRecording = () => {
    void window.__portraitExportStopped();
  };
});

const exportUrl = new URL(videoUrl);
exportUrl.searchParams.set('export', 'portrait');
await page.goto(exportUrl.toString(), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(
  () => typeof window.__replitBeginPortraitPlayback === 'function',
);
await page.waitForTimeout(500);
await page.evaluate(() => window.__replitBeginPortraitPlayback?.());
await page.waitForFunction(
  () =>
    window.__replitVideoPlayerMounted === true &&
    typeof window.__replitVideoTotalDurationMs === 'number',
);

const intendedDurationMs = await page.evaluate(
  () => window.__replitVideoTotalDurationMs,
);

if (!intendedDurationMs || intendedDurationMs < 1) {
  throw new Error('The video did not publish a valid duration.');
}

await Promise.race([
  playbackStopped,
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('Timed out waiting for the video to finish.')),
      intendedDurationMs + 10_000,
    ),
  ),
]);

await page.waitForTimeout(120);
const recordingClosedAt = Date.now();
const recordedVideo = page.video();
await context.close();
await browser.close();

if (!recordedVideo) {
  throw new Error('Playwright did not create a recording.');
}

const rawPath = await recordedVideo.path();
const { stdout: durationOutput } = await execFileAsync('ffprobe', [
  '-v',
  'error',
  '-show_entries',
  'format=duration',
  '-of',
  'default=noprint_wrappers=1:nokey=1',
  rawPath,
]);

const rawDuration = Number(durationOutput.trim());
const intendedDuration = intendedDurationMs / 1000;

if (!playbackStartedAt || !playbackStoppedAt) {
  throw new Error('The video lifecycle did not publish start/stop timestamps.');
}

const wallClockDuration = recordingClosedAt - pageCreatedAt;
const trimStart =
  rawDuration * ((playbackStartedAt - pageCreatedAt) / wallClockDuration);
const trimEnd =
  rawDuration * ((playbackStoppedAt - pageCreatedAt) / wallClockDuration);
const capturedContentDuration = trimEnd - trimStart;
const timingScale = intendedDuration / capturedContentDuration;

await execFileAsync(
  'ffmpeg',
  [
    '-y',
    '-ss',
    trimStart.toFixed(3),
    '-i',
    rawPath,
    '-vf',
    `trim=duration=${capturedContentDuration.toFixed(3)},setpts=${timingScale.toFixed(8)}*PTS,scale=${WIDTH}:${HEIGHT}:flags=lanczos,fps=30,setsar=1`,
    '-t',
    intendedDuration.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    outputPath,
  ],
  { maxBuffer: 10 * 1024 * 1024 },
);

const { stdout: probeOutput } = await execFileAsync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=width,height,sample_aspect_ratio,display_aspect_ratio:format=duration',
  '-of',
  'json',
  outputPath,
]);
const probe = JSON.parse(probeOutput);
const stream = probe.streams?.[0];

if (
  stream?.width !== WIDTH ||
  stream?.height !== HEIGHT ||
  stream?.display_aspect_ratio !== '9:16'
) {
  throw new Error(
    `Portrait export validation failed: ${JSON.stringify(probe)}`,
  );
}

await rm(rawDir, { recursive: true, force: true });
console.log(outputPath);
console.log(
  `Validated ${stream.width}x${stream.height}, DAR ${stream.display_aspect_ratio}, ${Number(probe.format.duration).toFixed(2)}s`,
);