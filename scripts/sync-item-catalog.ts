import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CATALOG_URL = process.env.POKOPIA_ITEM_CATALOG_URL;

if (!CATALOG_URL) {
  console.error("Set POKOPIA_ITEM_CATALOG_URL to refresh the local Pokopia item catalog.");
  process.exit(1);
}

const CATALOG_BASE = new URL("./", CATALOG_URL);

interface CatalogItem {
  name: string;
  slug: string;
  section: string;
  description: string;
  tags: string[];
  locations: string[];
  image: string;
  imageAvailable: boolean;
  searchTerms: string[];
}

const shouldDownloadImages = !process.argv.includes("--no-images");
const root = process.cwd();
const outputPath = path.join(root, "data", "pokopia-item-catalog.json");
const imageDir = path.join(root, "public", "images", "items");

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    eacute: "é",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => named[entity.toLowerCase()] ?? match);
}

function stripHtml(value: string) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim(),
  );
}

function fieldList(value: string) {
  return stripHtml(value)
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

function slugFromHref(href: string) {
  return href
    .replace(/^items\//, "")
    .replace(/\.shtml$/i, "")
    .toLowerCase();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  return new TextDecoder("windows-1252").decode(bytes);
}

async function downloadImage(item: CatalogItem, imageUrl: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    console.warn(`Skipped missing image for ${item.name}: ${response.status} ${response.statusText}`);
    item.image = "";
    item.imageAvailable = false;
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(root, "public", item.image.replace(/^\//, "")), bytes);
  item.imageAvailable = true;
}

function parseItems(html: string) {
  const items: Array<CatalogItem & { remoteImage: string }> = [];
  let section = "Unknown";
  const blockPattern = /<h2>([\s\S]*?)<\/h2>|<tr>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(html))) {
    if (match[1]) {
      const heading = stripHtml(match[1]).replace(/^List of\s+/i, "");
      if (heading) section = heading;
      continue;
    }

    const row = match[2];
    if (!row || !row.includes('href="items/')) continue;

    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 3) continue;

    const imageMatch = cells[0].match(/<a href="(items\/[^"]+\.shtml)"[\s\S]*?<img src="(items\/[^"]+\.png)"[\s\S]*?alt="([^"]+)"/i);
    if (!imageMatch) continue;

    const href = decodeEntities(imageMatch[1]);
    const imageSrc = decodeEntities(imageMatch[2]);
    const imageAlt = stripHtml(imageMatch[3]);
    const name = stripHtml(cells[1]) || imageAlt;
    if (!name || name === "Name") continue;

    const slug = slugFromHref(href);
    const tags = fieldList(cells[3] ?? "").filter((tag) => tag !== "\u00a0");
    const locations = fieldList(cells[4] ?? "");
    const searchTerms = unique([
      name,
      name.toLowerCase(),
      slug,
      slug.replace(/[()]/g, ""),
      name.replace(/\s*\([^)]*\)/g, ""),
    ].filter(Boolean));

    items.push({
      name,
      slug,
      section,
      description: stripHtml(cells[2]),
      tags,
      locations,
      image: `/images/items/${path.basename(imageSrc)}`,
      imageAvailable: false,
      searchTerms,
      remoteImage: new URL(imageSrc, CATALOG_BASE).toString(),
    });
  }

  const bySlug = new Map<string, CatalogItem & { remoteImage: string }>();
  for (const item of items) {
    bySlug.set(item.slug, item);
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(imageDir, { recursive: true });

const html = await fetchText(CATALOG_URL);
const items = parseItems(html);

if (items.length === 0) {
  throw new Error("No items were parsed. The page structure may have changed.");
}

if (shouldDownloadImages) {
  for (const item of items) {
    await downloadImage(item, item.remoteImage);
  }
}

const publicItems: CatalogItem[] = items.map(({ remoteImage, ...item }) => item);

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      imagePolicy: shouldDownloadImages ? "local-copy" : "metadata-only",
      count: publicItems.length,
      items: publicItems,
    },
    null,
    2,
  )}\n`,
);

console.log(`Updated ${publicItems.length} Pokopia catalog items.`);
console.log(`Wrote ${path.relative(root, outputPath)}`);
if (shouldDownloadImages) {
  console.log(`Updated item figures in ${path.relative(root, imageDir)}`);
}
