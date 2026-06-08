import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Platform = "youtube" | "tiktok" | "instagram" | "reddit" | "other";

export interface ItemGuess {
  name: string;
  confidence: number;
  image?: string;
  evidence?: string;
  evidenceFrame?: string;
  note?: string;
}

export interface FrameAnalysis {
  frame: string;
  sourceTimeSeconds?: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  score: number;
  reasons: string[];
  rejected: boolean;
}

export interface ReviewChecklist {
  selectedFrameAutoPicked: boolean;
  selectedFrameNeedsHumanCheck: boolean;
  sourceMetadataNeedsHumanCheck: boolean;
  itemsNeedVisualReview: boolean;
  notesNeedRewrite: boolean;
}

export interface GalleryFrame {
  frame: string;
  alt?: string;
  caption?: string;
}

export interface CurationDraft {
  slug: string;
  title: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceAuthor?: string;
  sourceAuthorUrl?: string;
  sourcePublishedAt?: string;
  platform: Platform;
  creator: string;
  capturedAt: string;
  selectedFrame: string;
  frames: string[];
  galleryFrames?: GalleryFrame[];
  tags: string[];
  summary: string;
  publicNotes: string;
  automationNotes?: string[];
  frameAnalyses?: FrameAnalysis[];
  reviewChecklist?: ReviewChecklist;
  inferredItems: ItemGuess[];
  rejectedItems: ItemGuess[];
  reviewState: "draft" | "reviewed";
}

export function detectPlatform(rawUrl: string): Platform {
  const host = new URL(rawUrl).hostname.replace(/^www\./, "");
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("reddit.com")) return "reddit";
  return "other";
}

export function getYouTubeId(rawUrl: string): string | null {
  const parsed = new URL(rawUrl);
  if (parsed.hostname.includes("youtu.be")) {
    return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (parsed.pathname.startsWith("/shorts/")) {
    return parsed.pathname.split("/").filter(Boolean)[1] ?? null;
  }
  return parsed.searchParams.get("v");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || `build-${Date.now()}`;
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function writeJson(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
