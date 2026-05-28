import { copyFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJson, writeJson, type CurationDraft } from "./shared";

const slug = process.argv[2];
const screenshotPath = process.argv[3];

if (!slug || !screenshotPath) {
  console.error("Usage: corepack pnpm tsx scripts/import-screenshot.ts <slug> <absolute-screenshot-path>");
  process.exit(1);
}

const root = process.cwd();
const draftPath = path.join(root, "curation", `${slug}.json`);
const draft = await readJson<CurationDraft>(draftPath);
const targetDir = path.join(root, "curation", slug, "frames");
const targetPath = path.join(targetDir, "selected-manual.png");
const relativeTarget = path.relative(root, targetPath);

await ensureDir(targetDir);
await copyFile(screenshotPath, targetPath);

draft.selectedFrame = relativeTarget;
draft.frames = Array.from(new Set([relativeTarget, ...draft.frames]));

await writeJson(draftPath, draft);

console.log(`Imported manual screenshot: ${relativeTarget}`);
console.log(`Updated selectedFrame in: ${draftPath}`);
