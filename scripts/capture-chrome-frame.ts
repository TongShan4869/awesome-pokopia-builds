import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Locator, type Page } from "playwright";
import { ensureDir, readJson, writeJson, type CurationDraft, type FrameAnalysis } from "./shared";

const execFileAsync = promisify(execFile);

const slug = process.argv[2];
const nameArg = process.argv.find((arg) => arg.startsWith("--name="))?.split("=")[1] ?? "chrome-selected.png";
const rectArg = process.argv.find((arg) => arg.startsWith("--rect="))?.split("=")[1];
const sourceTimeArg = process.argv.find((arg) => arg.startsWith("--time="))?.split("=")[1];
const settleMsArg = process.argv.find((arg) => arg.startsWith("--settle-ms="))?.split("=")[1];
const browserArg = process.argv.find((arg) => arg.startsWith("--browser="))?.split("=")[1] ?? "chrome";
const headed = process.argv.includes("--headed");
const desktopCapture = process.argv.includes("--desktop");
const openSource = process.argv.includes("--open-source");
const toggleMute = process.argv.includes("--toggle-mute");

if (!slug) {
  console.error(
    "Usage: corepack pnpm capture-chrome-frame <slug> [--open-source] [--name=chrome-selected.png] [--time=seconds] [--settle-ms=1200] [--browser=chrome|chromium] [--headed] [--desktop --rect=x,y,w,h --toggle-mute]",
  );
  process.exit(1);
}

const root = process.cwd();
const draftPath = path.join(root, "curation", `${slug}.json`);
const draft = await readJson<CurationDraft>(draftPath);
const framesDir = path.join(root, "curation", slug, "frames");
const safeName = nameArg.replace(/[^a-z0-9._-]/gi, "-");
const targetPath = path.join(framesDir, safeName);
const relativeTarget = path.relative(root, targetPath);
const rect = desktopCapture ? parseRect(rectArg) : undefined;
const sourceTimeSeconds = sourceTimeArg === undefined ? undefined : Number(sourceTimeArg);
const settleMs = settleMsArg === undefined ? 1000 : Number(settleMsArg);

if (sourceTimeArg !== undefined && !Number.isFinite(sourceTimeSeconds)) {
  console.error(`Invalid --time value: ${sourceTimeArg}`);
  process.exit(1);
}
if (!Number.isFinite(settleMs) || settleMs < 0) {
  console.error(`Invalid --settle-ms value: ${settleMsArg}`);
  process.exit(1);
}

await ensureDir(framesDir);
if (desktopCapture) {
  await captureDesktopFrame(draft, targetPath, rect ?? parseRect(undefined), sourceTimeSeconds, settleMs, openSource);
} else {
  await capturePlaywrightFrame(draft, targetPath, sourceTimeSeconds, settleMs, browserArg, headed);
}

if (!existsSync(targetPath)) {
  console.error(`Browser frame capture failed: ${targetPath}`);
  process.exit(1);
}

const dimensions = await readImageDimensions(targetPath);
const fileSizeBytes = statSync(targetPath).size;
if (fileSizeBytes < 75_000) {
  console.error(
    `Captured frame looks invalid or blank (${fileSizeBytes} bytes): ${relativeTarget}. ` +
      "Try --headed or a different --time value.",
  );
  process.exit(1);
}
draft.selectedFrame = relativeTarget;
draft.frames = Array.from(new Set([relativeTarget, ...draft.frames]));
draft.frameAnalyses = upsertManualFrameAnalysis(draft.frameAnalyses ?? [], {
  frame: relativeTarget,
  sourceTimeSeconds,
  width: dimensions.width,
  height: dimensions.height,
  fileSizeBytes,
  score: 0.95,
  reasons: [
    desktopCapture ? "manual desktop Chrome showcase capture" : "Playwright video-element capture",
    desktopCapture ? "visible-screen crop" : "isolated browser context",
    desktopCapture ? "tight video-player crop" : "desktop-private background capture",
    "curator-selected finished-build frame",
  ],
  rejected: false,
});
draft.automationNotes = [
  desktopCapture
    ? "Selected frame was captured from real Chrome with a narrow screencapture crop after browser capture was insufficient."
    : "Selected frame was captured through Playwright from an isolated browser context without exposing the desktop.",
  ...(draft.automationNotes ?? []),
];
draft.reviewChecklist = {
  selectedFrameAutoPicked: false,
  selectedFrameNeedsHumanCheck: false,
  sourceMetadataNeedsHumanCheck: draft.reviewChecklist?.sourceMetadataNeedsHumanCheck ?? !draft.sourceAuthor,
  itemsNeedVisualReview: draft.reviewChecklist?.itemsNeedVisualReview ?? true,
  notesNeedRewrite: draft.reviewChecklist?.notesNeedRewrite ?? true,
};

for (const item of draft.inferredItems) {
  item.evidenceFrame = relativeTarget;
}

await writeJson(draftPath, draft);

console.log(`Captured browser frame: ${relativeTarget}`);
console.log(`Updated selectedFrame in: ${draftPath}`);

function parseRect(value: string | undefined): [number, number, number, number] {
  if (!value) return [15, 220, 925, 405];
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part <= 0)) {
    console.error(`Invalid --rect value: ${value}`);
    console.error("Expected --rect=x,y,width,height, for example --rect=15,220,925,405");
    process.exit(1);
  }
  return parts as [number, number, number, number];
}

function upsertManualFrameAnalysis(analyses: FrameAnalysis[], manualAnalysis: FrameAnalysis) {
  return [manualAnalysis, ...analyses.filter((analysis) => analysis.frame !== manualAnalysis.frame)];
}

async function capturePlaywrightFrame(
  curationDraft: CurationDraft,
  outputPath: string,
  seconds: number | undefined,
  waitMs: number,
  browserName: string,
  showBrowser: boolean,
) {
  const launchOptions =
    browserName === "chromium"
      ? { headless: !showBrowser }
      : { channel: browserName, headless: !showBrowser };

  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await page.goto(sourceUrlAtTime(curationDraft.sourceUrl, seconds), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(Math.max(500, waitMs));

    const video = await findPlayableVideo(page.locator("video"));
    if (!video) {
      throw new Error("No playable video element became visible.");
    }
    await video.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);

    await video.evaluate(
      `async (node, targetTime) => {
        const media = node;
        media.muted = true;
        media.pause();
        if (targetTime !== undefined && Number.isFinite(targetTime)) {
          await new Promise((resolve) => {
            let resolved = false;
            const done = () => {
              if (resolved) return;
              resolved = true;
              media.removeEventListener("seeked", done);
              window.clearTimeout(timeout);
              resolve();
            };
            const timeout = window.setTimeout(done, 2500);
            media.addEventListener("seeked", done, { once: true });
            media.currentTime = Math.min(
              Math.max(0, targetTime),
              Number.isFinite(media.duration) ? Math.max(0, media.duration - 0.1) : Math.max(0, targetTime),
            );
          });
        }
        await media.play().catch(() => undefined);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        media.pause();
      }`,
      seconds,
    );
    await page.waitForTimeout(Math.max(250, Math.floor(waitMs / 2)));
    await video.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
    await hideYouTubePlayerChrome(page);
    const captureTarget = page.locator("#movie_player, .html5-video-player").first();
    const box = (await captureTarget.boundingBox().catch(() => null)) ?? (await video.boundingBox());
    if (!box) throw new Error("Video frame was not visible at capture time.");
    await page.screenshot({
      path: outputPath,
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: box.height,
      },
    });
  } finally {
    await browser.close();
  }
}

async function hideYouTubePlayerChrome(page: Page) {
  await page
    .addStyleTag({
      content: `
        .ytp-chrome-top,
        .ytp-chrome-bottom,
        .ytp-gradient-top,
        .ytp-gradient-bottom,
        .ytp-large-play-button,
        .ytp-pause-overlay,
        .ytp-bezel,
        .ytp-spinner,
        .ytp-contextmenu,
        .ytp-tooltip {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }
      `,
    })
    .catch(() => undefined);
}

async function findPlayableVideo(videos: Locator) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const count = await videos.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const video = videos.nth(index);
      const box = await video.boundingBox().catch(() => null);
      if (!box || box.width < 320 || box.height < 180) continue;
      if (box.y + box.height < 40) {
        await video.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
      }

      const ready = await video
        .evaluate((node) => {
          const media = node as HTMLVideoElement;
          media.muted = true;
          return media.readyState >= 1 && media.videoWidth > 0 && media.videoHeight > 0;
        })
        .catch(() => false);
      if (ready) return video;
    }
    await sleep(500);
  }

  return null;
}

async function captureDesktopFrame(
  curationDraft: CurationDraft,
  outputPath: string,
  captureRect: [number, number, number, number],
  seconds: number | undefined,
  waitMs: number,
  shouldOpenSource: boolean,
) {
  await execFileAsync(
    "open",
    shouldOpenSource
      ? ["-a", "Google Chrome", sourceUrlAtTime(curationDraft.sourceUrl, seconds)]
      : ["-a", "Google Chrome"],
  );
  await sleep(waitMs);
  if (toggleMute) {
    await pressChromeKey("m").catch(() => undefined);
    await sleep(250);
  }
  await execFileAsync("screencapture", ["-x", `-R${captureRect.join(",")}`, outputPath]);
}

function sourceUrlAtTime(sourceUrl: string, seconds: number | undefined) {
  if (seconds === undefined) return sourceUrl;
  const parsed = new URL(sourceUrl);
  parsed.searchParams.delete("si");
  parsed.searchParams.set("t", `${Math.max(0, Math.round(seconds))}s`);
  return parsed.toString();
}

async function pressChromeKey(key: string) {
  await execFileAsync("osascript", [
    "-e",
    'tell application "Google Chrome" to activate',
    "-e",
    'tell application "System Events"',
    "-e",
    `keystroke "${key}"`,
    "-e",
    "end tell",
  ]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readImageDimensions(imagePath: string) {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Could not read image dimensions for ${imagePath}`);
  }
  return { width, height };
}
