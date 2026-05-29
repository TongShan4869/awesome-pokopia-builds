import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { ensureDir, readJson, writeJson, type CurationDraft, type FrameAnalysis } from "./shared";

const execFileAsync = promisify(execFile);

const slug = process.argv[2];
const nameArg = process.argv.find((arg) => arg.startsWith("--name="))?.split("=")[1] ?? "chrome-selected.png";
const rectArg = process.argv.find((arg) => arg.startsWith("--rect="))?.split("=")[1];
const sourceTimeArg = process.argv.find((arg) => arg.startsWith("--time="))?.split("=")[1];
const settleMsArg = process.argv.find((arg) => arg.startsWith("--settle-ms="))?.split("=")[1];
const openSource = process.argv.includes("--open-source");
const toggleMute = process.argv.includes("--toggle-mute");

if (!slug) {
  console.error(
    "Usage: corepack pnpm capture-chrome-frame <slug> [--open-source] [--toggle-mute] [--name=chrome-selected.png] [--rect=x,y,w,h] [--time=seconds] [--settle-ms=1200]",
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
const rect = parseRect(rectArg);
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
await execFileAsync("open", openSource ? ["-a", "Google Chrome", sourceUrlAtTime(draft.sourceUrl, sourceTimeSeconds)] : ["-a", "Google Chrome"]);
await sleep(settleMs);
if (toggleMute) {
  await pressChromeKey("m").catch(() => undefined);
  await sleep(250);
}
await execFileAsync("screencapture", ["-x", `-R${rect.join(",")}`, targetPath]);

if (!existsSync(targetPath)) {
  console.error(`Chrome frame capture failed: ${targetPath}`);
  process.exit(1);
}

draft.selectedFrame = relativeTarget;
draft.frames = Array.from(new Set([relativeTarget, ...draft.frames]));
draft.frameAnalyses = upsertManualFrameAnalysis(draft.frameAnalyses ?? [], {
  frame: relativeTarget,
  sourceTimeSeconds,
  width: rect[2] * 2,
  height: rect[3] * 2,
  fileSizeBytes: statSync(targetPath).size,
  score: 0.95,
  reasons: [
    "manual Chrome showcase capture",
    "real browser video pixels",
    "tight video-player crop",
    "curator-selected finished-build frame",
  ],
  rejected: false,
});
draft.automationNotes = [
  "Selected frame was captured from real Chrome with a narrow screencapture crop after headless capture was insufficient.",
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

console.log(`Captured Chrome frame: ${relativeTarget}`);
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
