import { existsSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import {
  detectPlatform,
  ensureDir,
  getYouTubeId,
  readJson,
  slugify,
  type CurationDraft,
  type FrameAnalysis,
  type ItemGuess,
  type Platform,
  writeJson,
} from "./shared";

const url = process.argv[2];
const slugArg = process.argv.find((arg) => arg.startsWith("--slug="))?.split("=")[1];
const force = process.argv.includes("--force");

if (!url) {
  console.error('Usage: corepack pnpm ingest "<social-video-url>" [--slug=my-build]');
  process.exit(1);
}

const platform = detectPlatform(url);
const slug = slugArg || slugify(url);
const curationDir = path.join(process.cwd(), "curation", slug);
const framesDir = path.join(curationDir, "frames");
const outputPath = path.join(process.cwd(), "curation", `${slug}.json`);
const firstFramePath = path.join(framesDir, "candidate-1.png");
const firstRelativeFramePath = path.relative(process.cwd(), firstFramePath);

if (existsSync(outputPath) && !force) {
  console.error(`Curation draft already exists: ${outputPath}`);
  console.error("Pass --force to recapture and overwrite it.");
  process.exit(1);
}

if (force && existsSync(framesDir)) {
  rmSync(framesDir, { recursive: true, force: true });
}
await ensureDir(framesDir);

let pageTitle = "Untitled Pokopia build";
let captureNote = "";
let visibleText = "";
let sourceTitle = "";
let sourceAuthor = "";
let sourceAuthorUrl = "";
let sourcePublishedAt = "";
let frameAnalyses: FrameAnalysis[] = [];
let sourceDurationSeconds = 0;
let shouldTryBrowserFallback = true;
const capturedFrames: string[] = [];
const frameSourceTimes = new Map<string, number>();

try {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(4500);

  const playTarget = page
    .getByRole("button", { name: /play|watch|pause/i })
    .first();
  if (await playTarget.count().catch(() => 0)) {
    await playTarget.click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(2500);
  }

  pageTitle = (await page.title()) || pageTitle;
  visibleText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  const metadata = await extractSourceMetadata(page, platform);
  sourceTitle = metadata.sourceTitle;
  sourceAuthor = metadata.sourceAuthor;
  sourceAuthorUrl = metadata.sourceAuthorUrl;
  sourcePublishedAt = metadata.sourcePublishedAt;
  sourceDurationSeconds = await getVideoDurationSeconds(page);

  const youTubeId = platform === "youtube" ? getYouTubeId(url) : null;
  if (youTubeId) {
    shouldTryBrowserFallback = false;
    const sampleTimes = buildShowcaseSampleTimes(sourceDurationSeconds);
    let candidateIndex = 1;
    let consecutiveInvalidCaptures = 0;
    for (const time of sampleTimes) {
      const candidatePath = path.join(framesDir, `candidate-${candidateIndex}.png`);
      const timedUrl = `https://www.youtube.com/watch?v=${youTubeId}&t=${time}s`;
      await page.goto(timedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const videoFrame = await waitForPlayableVideo(page, time);
      if (videoFrame) {
        await videoFrame.screenshot({ path: candidatePath });
        const relativeCandidatePath = path.relative(process.cwd(), candidatePath);
        frameSourceTimes.set(relativeCandidatePath, time);
        const analysis = await analyzeFrames(page, [relativeCandidatePath], frameSourceTimes, sourceDurationSeconds);
        if (analysis[0] && !analysis[0].rejected) {
          capturedFrames.push(relativeCandidatePath);
          candidateIndex += 1;
          consecutiveInvalidCaptures = 0;
        } else {
          consecutiveInvalidCaptures += 1;
          unlinkIfExists(candidatePath);
          frameSourceTimes.delete(relativeCandidatePath);
          captureNote += `\nRejected YouTube timestamp ${time}s because the capture looked invalid: ${
            analysis[0]?.reasons.join(", ") ?? "unknown reason"
          }.`;
          if (consecutiveInvalidCaptures >= 3 && capturedFrames.length === 0) {
            captureNote +=
              "\nStopped YouTube browser capture early after repeated invalid player screenshots.";
            break;
          }
        }
      } else {
        captureNote += `\nSkipped YouTube timestamp ${time}s because no playable video frame became visible.`;
      }
    }
    if (capturedFrames.length === 0) {
      captureNote +=
        "\nNo usable YouTube frames were captured from the browser player. Try importing a manual screenshot or rerun with a media-stream capture method.";
    }
  }

  const video = shouldTryBrowserFallback && capturedFrames.length === 0 ? page.locator("video").first() : null;
  const videoBox = video ? await video.boundingBox().catch(() => null) : null;
  if (capturedFrames.length === 0 && video && videoBox && videoBox.width > 240 && videoBox.height > 180) {
    const duration = await video
      .evaluate((node) => {
        const media = node as HTMLVideoElement;
        return Number.isFinite(media.duration) ? media.duration : 0;
      })
      .catch(() => 0);
    const sampleTimes = Array.from(
      new Set(
        [2, 8, 15, 25, 40, 55, duration * 0.25, duration * 0.5, duration * 0.75]
          .filter((time) => Number.isFinite(time) && time > 0 && (!duration || time < duration - 1))
          .map((time) => Math.round(time)),
      ),
    ).slice(0, 8);

    for (const [index, time] of sampleTimes.entries()) {
      await video
        .evaluate(
          async (node, targetTime) => {
            const media = node as HTMLVideoElement;
            media.pause();
            await new Promise<void>((resolve) => {
              const done = () => {
                media.removeEventListener("seeked", done);
                resolve();
              };
              media.addEventListener("seeked", done, { once: true });
              media.currentTime = targetTime;
              setTimeout(done, 1800);
            });
          },
          time,
        )
        .catch(() => undefined);
      await page.waitForTimeout(700);
      const candidatePath = path.join(framesDir, `candidate-${index + 1}.png`);
      await video.screenshot({ path: candidatePath });
      const relativeCandidatePath = path.relative(process.cwd(), candidatePath);
      frameSourceTimes.set(relativeCandidatePath, time);
      capturedFrames.push(relativeCandidatePath);
    }

    if (capturedFrames.length === 0) {
      await video.screenshot({ path: firstFramePath });
      frameSourceTimes.set(firstRelativeFramePath, 0);
      capturedFrames.push(firstRelativeFramePath);
    }
  } else if (shouldTryBrowserFallback && capturedFrames.length === 0) {
    await page.screenshot({ path: firstFramePath, fullPage: false });
    frameSourceTimes.set(firstRelativeFramePath, 0);
    capturedFrames.push(firstRelativeFramePath);
  }
  frameAnalyses = await analyzeFrames(page, capturedFrames, frameSourceTimes, sourceDurationSeconds);
  await browser.close();
} catch (error) {
  captureNote =
    error instanceof Error
      ? `Automatic browser capture failed: ${error.message}`
      : "Automatic browser capture failed for an unknown reason.";
}

if (!existsSync(firstFramePath)) {
  captureNote +=
    "\nManual fallback: add a screenshot to this path, then rerun export after review.";
}

type ItemVocabularyEntry = { name: string; aliases?: string[]; searchTerms?: string[] };
type ItemCatalog = { items?: ItemVocabularyEntry[] };

const itemDb = await readJson<ItemCatalog | ItemVocabularyEntry[]>(
  path.join(process.cwd(), "data", "pokopia-item-catalog.json"),
)
  .then((database) => {
    if (Array.isArray(database)) return database;
    return database.items ?? [];
  })
  .catch(() => readJson<ItemVocabularyEntry[]>(path.join(process.cwd(), "data", "items.json")).catch(() => []));
const haystack = `${pageTitle}\n${visibleText}`.toLowerCase();
const inferredItems: ItemGuess[] = itemDb
  .filter((item) =>
    [item.name, ...(item.aliases ?? []), ...(item.searchTerms ?? [])].some((name) =>
      haystack.includes(name.toLowerCase()),
    ),
  )
  .map((item) => ({
    name: item.name,
    confidence: 0.35,
    evidenceFrame: capturedFrames[0],
    note: "Matched by title/page text. Review visually before exporting.",
  }));

const itemsExcerpt = JSON.stringify(itemDb.slice(0, 40), null, 2);
const aiReviewPrompt = `Review the captured frames in curation/${slug}/frames for a Pokemon Pokopia build.

Use data/pokopia-item-catalog.json as the item vocabulary when present, falling back to data/items.json. Suggest likely exact item names, tags, and a short public summary.
Keep confidence and rejected guesses in this private curation JSON only. Do not publish confidence scores to the website.
Pick selectedFrame only after visually confirming it shows the complete build, not the intro, creator face, UI chrome, or a transition.
The script auto-picked selectedFrame from frameAnalyses; treat that as a ranked suggestion, not a final visual review.
Prefer frames that show a finished whole build, usually showcase or recap moments near the beginning or end of a video.
For compilation videos, use sourceTimeSeconds to identify separate builds and pick the strongest full-building frame for each useful entry.
Also look for explicit item/material list frames such as "recommended items", "materials", or "what I used". Keep those as item-evidence frames even when they are not suitable hero screenshots.

First item database entries:
${itemsExcerpt}`;

const draft: CurationDraft = {
  slug,
  title: cleanTitle(sourceTitle || pageTitle, platform) || "Untitled Pokopia build",
  sourceUrl: url,
  sourceTitle: cleanTitle(sourceTitle || pageTitle, platform) || undefined,
  sourceAuthor: sourceAuthor || undefined,
  sourceAuthorUrl: sourceAuthorUrl || undefined,
  sourcePublishedAt: sourcePublishedAt || undefined,
  platform,
  creator: sourceAuthor || "Unknown creator",
  capturedAt: new Date().toISOString(),
  selectedFrame: capturedFrames.length > 0 ? pickSelectedFrame(frameAnalyses, capturedFrames[0]) : "",
  frames: capturedFrames,
  tags: ["cozy"],
  summary: "A Pokopia build saved from a social video. Review this summary before exporting.",
  publicNotes: captureNote
    ? `## Curator notes\n\n${captureNote}\n\nReplace this with public-facing build notes after review.`
      : "## Curator notes\n\nAdd the visual details that make this build worth saving.",
  aiReviewPrompt,
  automationNotes: buildAutomationNotes(frameAnalyses, sourceAuthor, captureNote),
  frameAnalyses,
  reviewChecklist: {
    selectedFrameAutoPicked: frameAnalyses.length > 0,
    selectedFrameNeedsHumanCheck: true,
    sourceMetadataNeedsHumanCheck: !sourceAuthor,
    itemsNeedVisualReview: true,
    notesNeedRewrite: true,
  },
  inferredItems,
  rejectedItems: [],
  reviewState: "draft",
};

await writeJson(outputPath, draft);

console.log(`Draft curation written: ${outputPath}`);
console.log(`Frame candidates: ${draft.frames.length ? draft.frames.join(", ") : "none"}`);
console.log(`Auto-selected frame: ${draft.selectedFrame || "none"}`);
if (draft.automationNotes?.length) {
  console.log("Automation notes:");
  for (const note of draft.automationNotes) console.log(`- ${note}`);
}
if (captureNote) {
  console.log(captureNote);
}

function cleanTitle(title: string, platformName: Platform): string {
  return title
    .replace(/\s+-\s+YouTube$/i, "")
    .replace(platformName === "instagram" ? /\s+•\s+Instagram$/i : /$^/, "")
    .trim();
}

async function extractSourceMetadata(page: Page, platformName: Platform) {
  const metadata = await page
    .evaluate(() => {
      const meta = (name: string) =>
        document
          .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
          ?.getAttribute("content")
          ?.trim() ?? "";
      const link = (rel: string) =>
        document.querySelector(`link[rel="${rel}"]`)?.getAttribute("href")?.trim() ?? "";
      return {
        sourceTitle: meta("og:title") || meta("twitter:title") || document.title || "",
        sourceAuthor: meta("author") || "",
        sourceAuthorUrl: link("author"),
        sourcePublishedAt:
          meta("article:published_time") || meta("video:release_date") || meta("date") || "",
      };
    })
    .catch(() => ({
      sourceTitle: "",
      sourceAuthor: "",
      sourceAuthorUrl: "",
      sourcePublishedAt: "",
    }));

  if (platformName === "youtube" && !metadata.sourceAuthor) {
    const authorName = await page
      .locator('span[itemprop="author"] link[itemprop="name"]')
      .first()
      .getAttribute("content", { timeout: 1000 })
      .catch(() => "");
    const authorUrl = await page
      .locator('span[itemprop="author"] link[itemprop="url"]')
      .first()
      .getAttribute("href", { timeout: 1000 })
      .catch(() => "");
    metadata.sourceAuthor = authorName || metadata.sourceAuthor;
    metadata.sourceAuthorUrl = authorUrl || metadata.sourceAuthorUrl;
  }

  return metadata;
}

async function waitForPlayableVideo(page: Page, targetTime: number) {
  const videos = page.locator("video");
  const count = await videos.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const video = videos.nth(index);
    const box = await video.boundingBox().catch(() => null);
    if (!box || box.width < 320 || box.height < 240) continue;

    await video
      .evaluate(
        async (node, time) => {
          const media = node as HTMLVideoElement;
          media.muted = true;
          media.pause();
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            const timeout = window.setTimeout(done, 2500);
            const onReady = () => {
              window.clearTimeout(timeout);
              resolve();
            };
            media.addEventListener("loadeddata", onReady, { once: true });
            media.addEventListener("seeked", onReady, { once: true });
            if (Number.isFinite(media.duration) && time < media.duration) {
              media.currentTime = time;
            }
            void media.play().catch(() => undefined);
          });
          media.pause();
        },
        targetTime,
      )
      .catch(() => undefined);

    await page.waitForTimeout(900);
    const ready = await video
      .evaluate((node) => {
        const media = node as HTMLVideoElement;
        return media.readyState >= 2 && media.videoWidth > 0 && media.videoHeight > 0;
      })
      .catch(() => false);
    if (ready) return video;
  }

  return null;
}

async function getVideoDurationSeconds(page: Page) {
  return page
    .evaluate(() => {
      const video = document.querySelector("video");
      if (video instanceof HTMLVideoElement && Number.isFinite(video.duration) && video.duration > 0) {
        return video.duration;
      }

      const durationMeta = document
        .querySelector('meta[itemprop="duration"], meta[property="video:duration"], meta[name="duration"]')
        ?.getAttribute("content");
      if (!durationMeta) return 0;
      const numericDuration = Number(durationMeta);
      if (Number.isFinite(numericDuration)) return numericDuration;
      const match = durationMeta.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
      if (!match) return 0;
      return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    })
    .catch(() => 0);
}

function buildShowcaseSampleTimes(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [6, 12, 20, 32, 48, 66, 88, 115, 150, 190, 240, 300];
  }

  const duration = Math.max(12, Math.floor(durationSeconds));
  const proportionalTimes = [
    0.04,
    0.08,
    0.12,
    0.18,
    0.25,
    0.33,
    0.42,
    0.5,
    0.58,
    0.66,
    0.72,
    0.78,
    0.84,
    0.9,
    0.94,
    0.97,
  ].map((portion) => Math.round(duration * portion));

  const endWindowStart = Math.max(8, duration - 90);
  const endWindow = [endWindowStart, duration - 60, duration - 40, duration - 25, duration - 12];

  return Array.from(
    new Set([...proportionalTimes, ...endWindow].filter((time) => time > 2 && time < duration - 2).map(Math.round)),
  )
    .sort((a, b) => a - b)
    .slice(0, 24);
}

async function analyzeFrames(
  page: Page,
  frames: string[],
  sourceTimes = new Map<string, number>(),
  durationSeconds = 0,
): Promise<FrameAnalysis[]> {
  const analyses: FrameAnalysis[] = [];
  for (const frame of frames) {
    const absolutePath = path.join(process.cwd(), frame);
    const fileSizeBytes = statSync(absolutePath).size;
    const metrics = await page
      .evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();

        const canvas = document.createElement("canvas");
        const width = Math.min(image.naturalWidth, 240);
        const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas context unavailable");
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;

        let sum = 0;
        let sumSquares = 0;
        let darkPixels = 0;
        let lightPixels = 0;
        let topSkinPixels = 0;
        let topPixels = 0;
        let colorfulness = 0;
        let edgeSum = 0;
        const luminance: number[] = [];

        for (let index = 0; index < data.length; index += 4) {
          const pixel = index / 4;
          const y = Math.floor(pixel / width);
          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];
          const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          luminance.push(value);
          sum += value;
          sumSquares += value * value;
          if (value < 24) darkPixels += 1;
          if (value > 232) lightPixels += 1;
          colorfulness += Math.max(red, green, blue) - Math.min(red, green, blue);
          if (y < height * 0.45) {
            topPixels += 1;
            if (red > 95 && green > 40 && blue > 20 && red > green && green > blue && red - blue > 35) {
              topSkinPixels += 1;
            }
          }
        }

        const rowMeans: number[] = [];
        for (let y = 1; y < height; y += 1) {
          let rowSum = 0;
          for (let x = 1; x < width; x += 1) {
            const current = luminance[y * width + x];
            rowSum += current;
            edgeSum += Math.abs(current - luminance[y * width + x - 1]);
            edgeSum += Math.abs(current - luminance[(y - 1) * width + x]);
          }
          rowMeans.push(rowSum / Math.max(1, width - 1));
        }

        const pixels = width * height;
        const mean = sum / pixels;
        const variance = sumSquares / pixels - mean * mean;
        const horizontalSeamScore = rowMeans.reduce((max, rowMean, index) => {
          if (index === 0) return max;
          return Math.max(max, Math.abs(rowMean - rowMeans[index - 1]));
        }, 0);
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          darkRatio: darkPixels / pixels,
          lightRatio: lightPixels / pixels,
          variance,
          colorfulness: colorfulness / pixels,
          edgeScore: edgeSum / pixels,
          skinRatioTop: topPixels > 0 ? topSkinPixels / topPixels : 0,
          horizontalSeamScore,
        };
      }, pathToFileURL(absolutePath).href)
      .catch(() => ({
        width: 0,
        height: 0,
        darkRatio: 1,
        lightRatio: 0,
        variance: 0,
        colorfulness: 0,
        edgeScore: 0,
        skinRatioTop: 0,
        horizontalSeamScore: 0,
      }));

    const reasons: string[] = [];
    const normalizedSize = Math.min(1, fileSizeBytes / 450_000);
    const detailScore = Math.min(1, metrics.edgeScore / 48);
    const varianceScore = Math.min(1, metrics.variance / 3200);
    const colorScore = Math.min(1, metrics.colorfulness / 48);
    const sourceTimeSeconds = sourceTimes.get(frame);
    let score = normalizedSize * 0.35 + detailScore * 0.3 + varianceScore * 0.2 + colorScore * 0.15;

    if (sourceTimeSeconds !== undefined && durationSeconds > 0) {
      const progress = sourceTimeSeconds / durationSeconds;
      if (progress < 0.15) {
        score += 0.04;
        reasons.push("early-video showcase zone");
      }
      if (progress > 0.65) {
        score += 0.12;
        reasons.push("late-video showcase zone");
      }
      if (progress > 0.85) {
        score += 0.08;
        reasons.push("end recap zone");
      }
    }

    if (metrics.width < 480 || metrics.height < 270) {
      score -= 0.2;
      reasons.push("small capture");
    }
    if (metrics.darkRatio > 0.55) {
      score -= 0.25;
      reasons.push("mostly dark");
    }
    if (metrics.lightRatio > 0.55) {
      score -= 0.2;
      reasons.push("mostly light");
    }
    if (fileSizeBytes < 25_000) {
      score -= 0.15;
      reasons.push("low file detail");
    }
    if (metrics.variance < 100 && metrics.edgeScore < 8) {
      score -= 0.4;
      reasons.push("near-blank image");
    }
    if (metrics.skinRatioTop > 0.18) {
      score -= 0.2;
      reasons.push("possible talking-head frame");
    }
    if (metrics.horizontalSeamScore > 18) {
      score -= 0.1;
      reasons.push("possible split-screen frame");
    }
    if (reasons.length === 0) {
      reasons.push("good visual detail");
    }

    const rejected =
      fileSizeBytes < 25_000 ||
      metrics.width < 480 ||
      metrics.height < 270 ||
      metrics.darkRatio > 0.7 ||
      metrics.lightRatio > 0.7 ||
      (metrics.variance < 100 && metrics.edgeScore < 8);

    analyses.push({
      frame,
      sourceTimeSeconds,
      width: metrics.width,
      height: metrics.height,
      fileSizeBytes,
      score: Number(Math.max(0, Math.min(1, score)).toFixed(3)),
      reasons,
      rejected,
    });
  }

  return analyses.sort((a, b) => Number(a.rejected) - Number(b.rejected) || b.score - a.score);
}

function pickSelectedFrame(analyses: FrameAnalysis[], fallback: string) {
  return analyses.find((analysis) => !analysis.rejected)?.frame ?? analyses[0]?.frame ?? fallback;
}

function buildAutomationNotes(analyses: FrameAnalysis[], author: string, note: string) {
  const notes: string[] = [];
  if (analyses[0]) {
    const timestamp =
      analyses[0].sourceTimeSeconds === undefined ? "" : ` at ${formatTimestamp(analyses[0].sourceTimeSeconds)}`;
    notes.push(
      `Top ranked frame is ${analyses[0].frame}${timestamp} with score ${analyses[0].score} (${analyses[0].reasons.join(", ")}).`,
    );
  }
  const rejectedCount = analyses.filter((analysis) => analysis.rejected).length;
  if (rejectedCount > 0) {
    notes.push(`${rejectedCount} candidate frame(s) were rejected by automatic validity checks.`);
  }
  if (!author) {
    notes.push("Creator metadata was not found automatically.");
  }
  if (note.trim()) {
    notes.push("Capture produced warnings; review publicNotes before publishing.");
  }
  return notes;
}

function formatTimestamp(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function unlinkIfExists(filePath: string) {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only; stale rejected frames are still marked invalid in JSON.
  }
}
