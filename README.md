# awesome-pokopia-builds

A cute, public gallery of inspiring Pokemon Pokopia builds from social videos.

This repo stores source links, screenshots, public summaries, and curated item notes. It does **not** store copied full videos. Raw AI analysis, confidence scores, and review notes stay local in `curation/`, which is ignored by git.

## What lives here

- `src/content/builds/*.mdx` - public build summaries shown on the website
- `public/images/builds/*/hero.png` - curated full-build screenshots
- `data/pokopia-item-catalog.json` - local item catalog for exact item-name inference
- `data/items.json` - small fallback item database maintained by the curator
- `public/images/items/*.png` - local item figure copies used by build pages
- `scripts/ingest.ts` - local-only browser capture workflow for social links
- `scripts/export-build.ts` - converts reviewed curation data into public MDX
- `scripts/sync-item-catalog.ts` - refreshes the local item catalog and item figures

## Local workflow

Install dependencies:

```bash
corepack pnpm install
corepack pnpm exec playwright install chromium
```

Refresh the local item catalog:

```bash
POKOPIA_ITEM_CATALOG_URL="<catalog-url>" corepack pnpm sync:item-catalog
```

Capture frames from a source link:

```bash
corepack pnpm ingest "https://www.youtube.com/watch?v=V2PGF9Rfc8Q"
```

Review the generated file in `curation/{slug}.json` and open every image in `curation/{slug}/frames/`.

The screenshot check is manual and strict:

- Reject creator intro frames, UI chrome, blank pages, loading shells, and transitions.
- Choose a `selectedFrame` only when the build itself is clearly visible.
- Edit inferred items and public notes.
- Set `reviewState` to `"reviewed"` only after that visual check.

If you already have the right screenshot, import it directly:

```bash
corepack pnpm import-screenshot "{slug}" "/absolute/path/to/screenshot.png"
```

Then export:

```bash
corepack pnpm export-build "{slug}"
```

`export-build` refuses to publish drafts. `ingest` refuses to overwrite an existing curation file unless you pass `--force`.

Build the site:

```bash
corepack pnpm build
```

## Attribution and corrections

Every build page links back to the original creator/source. Screenshots are used as credited references for fan curation. If you created a featured build and want credit changed, an image removed, or a page taken down, open an issue or PR with the source URL and requested change.

Item inference is curator-reviewed and may be imperfect. Corrections are welcome.

## GitHub Pages

The included GitHub Actions workflow builds the Astro site and publishes it to GitHub Pages:

https://tongshan4869.github.io/awesome-pokopia-builds/

Optional: set `PUBLIC_REPO_URL` in your Pages build environment if you want the homepage repo button to point somewhere other than `https://github.com/TongShan4869/awesome-pokopia-builds`.
