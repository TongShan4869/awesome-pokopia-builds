import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { detectPlatform, ensureDir, getYouTubeId, readJson, slugify, type CurationDraft, type ItemGuess, writeJson } from "./shared";

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

await ensureDir(framesDir);

let pageTitle = "Untitled Pokopia build";
let captureNote = "";
let visibleText = "";
const capturedFrames: string[] = [];

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

  const youTubeId = platform === "youtube" ? getYouTubeId(url) : null;
  if (youTubeId) {
    const sampleTimes = [2, 8, 15, 25, 40, 55, 68];
    for (const [index, time] of sampleTimes.entries()) {
      const candidatePath = path.join(framesDir, `candidate-${index + 1}.png`);
      const timedUrl = `https://www.youtube.com/watch?v=${youTubeId}&t=${time}s`;
      await page.goto(timedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(4200);
      const frame = page.locator("video").first();
      const frameBox = await frame.boundingBox().catch(() => null);
      if (frameBox && frameBox.width > 240 && frameBox.height > 180) {
        await frame.screenshot({ path: candidatePath });
        capturedFrames.push(path.relative(process.cwd(), candidatePath));
      } else {
        captureNote += `\nSkipped YouTube timestamp ${time}s because no playable video frame was visible.`;
      }
    }
    if (capturedFrames.length === 0) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(4500);
    }
  }

  const video = capturedFrames.length === 0 ? page.locator("video").first() : null;
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
      capturedFrames.push(path.relative(process.cwd(), candidatePath));
    }

    if (capturedFrames.length === 0) {
      await video.screenshot({ path: firstFramePath });
      capturedFrames.push(firstRelativeFramePath);
    }
  } else if (capturedFrames.length === 0) {
    await page.screenshot({ path: firstFramePath, fullPage: false });
    capturedFrames.push(firstRelativeFramePath);
  }
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
    evidenceFrame: firstRelativeFramePath,
    note: "Matched by title/page text. Review visually before exporting.",
  }));

const itemsExcerpt = JSON.stringify(itemDb.slice(0, 40), null, 2);
const aiReviewPrompt = `Review the captured frames in curation/${slug}/frames for a Pokemon Pokopia build.

Use data/pokopia-item-catalog.json as the item vocabulary when present, falling back to data/items.json. Suggest likely exact item names, tags, and a short public summary.
Keep confidence and rejected guesses in this private curation JSON only. Do not publish confidence scores to the website.
Pick selectedFrame only after visually confirming it shows the complete build, not the intro, creator face, UI chrome, or a transition.

First item database entries:
${itemsExcerpt}`;

const draft: CurationDraft = {
  slug,
  title: pageTitle.replace(/\s+-\s+YouTube$/i, "").trim() || "Untitled Pokopia build",
  sourceUrl: url,
  platform,
  creator: "Unknown creator",
  capturedAt: new Date().toISOString(),
  selectedFrame: capturedFrames[0] ?? firstRelativeFramePath,
  frames: capturedFrames.length > 0 ? capturedFrames : [firstRelativeFramePath],
  tags: ["cozy"],
  summary: "A Pokopia build saved from a social video. Review this summary before exporting.",
  publicNotes: captureNote
    ? `## Curator notes\n\n${captureNote}\n\nReplace this with public-facing build notes after review.`
      : "## Curator notes\n\nAdd the visual details that make this build worth saving.",
  aiReviewPrompt,
  inferredItems,
  rejectedItems: [],
  reviewState: "draft",
};

await writeJson(outputPath, draft);

console.log(`Draft curation written: ${outputPath}`);
console.log(`Frame candidates: ${draft.frames.join(", ")}`);
if (captureNote) {
  console.log(captureNote);
}
