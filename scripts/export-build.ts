import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJson, type CurationDraft } from "./shared";

const slug = process.argv[2];

if (!slug) {
  console.error("Usage: corepack pnpm export-build <slug>");
  process.exit(1);
}

const root = process.cwd();
const draftPath = path.join(root, "curation", `${slug}.json`);
const draft = await readJson<CurationDraft>(draftPath);

if (draft.reviewState !== "reviewed") {
  console.error(`Refusing to export ${slug}: curation reviewState is "${draft.reviewState}".`);
  console.error("Open the candidate frames, choose a real full-build screenshot, then set reviewState to \"reviewed\".");
  process.exit(1);
}

const heroDir = path.join(root, "public", "images", "builds", draft.slug);
const heroPath = path.join(heroDir, "hero.png");
await ensureDir(heroDir);
await copyFile(path.join(root, draft.selectedFrame), heroPath);

const publicItems = draft.inferredItems.map((item) => item.name);
const mdx = `---
title: ${JSON.stringify(draft.title)}
sourceUrl: ${JSON.stringify(draft.sourceUrl)}
platform: ${JSON.stringify(draft.platform)}
creator: ${JSON.stringify(draft.creator)}
heroImage: ${JSON.stringify(`/images/builds/${draft.slug}/hero.png`)}
tags: ${JSON.stringify(draft.tags)}
items: ${JSON.stringify(publicItems)}
summary: ${JSON.stringify(draft.summary)}
capturedAt: ${JSON.stringify(draft.capturedAt)}
---

${draft.publicNotes.trim()}

## Source

Original source: [${draft.sourceUrl}](${draft.sourceUrl})
`;

const buildPath = path.join(root, "src", "content", "builds", `${draft.slug}.mdx`);
await ensureDir(path.dirname(buildPath));
await writeFile(buildPath, `${mdx}\n`);

console.log(`Exported public build: ${buildPath}`);
console.log(`Copied hero image: ${heroPath}`);
