# awesome-pokopia-builds

A cute, public gallery of inspiring Pokemon Pokopia builds from social videos.

This repo stores source links, screenshots, public summaries, curated item notes, and the AI-assisted ingestion drafts in `curation/`. It does **not** store copied full videos. Raw confidence scores and review notes are kept in the repository for curator history, but only reviewed MDX content and public images are used by the website.

## What lives here

- `src/content/builds/*.mdx` - public build summaries shown on the website
- `public/images/builds/*/hero.png` - curated full-build screenshots
- `data/pokopia-item-catalog.json` - local item catalog for exact item-name inference
- `data/items.json` - small fallback item database maintained by the curator
- `public/images/items/*.png` - local item figure copies used by build pages
- `curation/*.json` and `curation/*/frames/*` - tracked ingestion drafts, frame candidates, review notes, and AI confidence data
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

The ingest command scans the video for likely showcase moments, captures timestamped candidate frames, scores them with local visual heuristics, auto-selects the strongest screenshot candidate, and fills any source metadata it can find. Review the generated file in `curation/{slug}.json` and open the selected image plus any close runners-up in `curation/{slug}/frames/`. These files are tracked so future curation work can see the original candidates and review trail, but they are not part of the rendered Astro site.

If YouTube headless capture returns blank/player-shell frames, use the real Chrome fallback. Open the video in Chrome, seek to a completed-build showcase frame, wait for YouTube controls to fade, then capture the visible player crop:

```bash
corepack pnpm capture-chrome-frame "{slug}" --time=0
```

The default crop is tuned for the current Chrome window layout (`15,220,925,405`), which avoids the YouTube header and controls. Override it with `--rect=x,y,width,height` if Chrome is positioned differently. This updates `selectedFrame`, prepends the screenshot to `frames`, and records that the frame came from a curator-selected real-Chrome capture.

For faster review, let the helper timestamp-hop in Chrome and capture after a short settle:

```bash
corepack pnpm capture-chrome-frame "{slug}" --open-source --time=0 --name=chrome-start.png --settle-ms=1400
corepack pnpm capture-chrome-frame "{slug}" --open-source --time=416 --name=chrome-final-tour.png --settle-ms=1400
```

Use `--toggle-mute` once if the YouTube tab is audible. It sends YouTube's `m` shortcut, so only use it when sound is currently on. The screenshot crop still needs the Chrome window visible; true background capture would need a separate browser/media-stream path.

The screenshot check is manual and strict:

- Reject creator intro frames, UI chrome, blank pages, loading shells, and transitions.
- Choose a `selectedFrame` only when the build itself is clearly visible.
- Keep explicit "recommended items", "materials", or "what I used" frames as item evidence, even when they are not suitable hero images.
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
