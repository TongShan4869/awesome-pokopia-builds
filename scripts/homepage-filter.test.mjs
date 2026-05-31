import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const root = new URL("../", import.meta.url);
const homepage = await readFile(new URL("src/pages/index.astro", root), "utf8");

assert.match(homepage, /id="build-search"/, "homepage has a build search field");
assert.match(homepage, /id="theme-filter"/, "homepage has a theme filter");
assert.match(homepage, /id="build-result-count"/, "homepage shows the visible build count");
assert.match(homepage, /data-build-card/, "homepage identifies filterable build cards");
assert.match(homepage, /data-tags=\{JSON\.stringify\(build\.data\.tags\.map\(\(tag\) => tag\.toLowerCase\(\)\)\)\}/, "build cards preserve multi-word tags for filtering");
assert.match(homepage, /JSON\.parse\(card\.dataset\.tags \?\? "\[\]"\)/, "homepage reads exact tags for theme matching");
assert.match(homepage, /function updateGallery\(\)/, "homepage updates the gallery when filters change");
assert.match(homepage, /card\.hidden = !visible/, "homepage hides cards that do not match");
assert.doesNotMatch(homepage, /class="tag-ribbon"/, "homepage no longer renders the growing tag ribbon");
