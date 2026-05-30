import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const root = new URL("../", import.meta.url);

const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

const homepage = await readProjectFile("src/pages/index.astro");
assert.match(homepage, /href=\{`\$\{basePath\}nominate\/`\}/, "homepage links to the nomination page");

const nominationPage = await readProjectFile("src/pages/nominate.astro");
assert.match(nominationPage, /Nominate a build/, "nomination page has a clear title");
assert.match(nominationPage, /source link/i, "nomination form asks for a source link");
assert.match(nominationPage, /description/i, "nomination form asks for a description");
assert.match(nominationPage, /curator/i, "nomination page makes the admin review flow clear");
assert.match(nominationPage, /github\.com\/\$\{repoPath\}\/issues\/new/, "nomination form opens a GitHub issue");
assert.match(nominationPage, /allowedHosts/, "nomination page checks source domains before submission");
assert.match(nominationPage, /www\.reddit\.com/, "nomination page accepts Reddit source links");
assert.match(nominationPage, /url\.protocol !== "https:"/, "nomination page rejects non-HTTPS links");
assert.match(nominationPage, /\\`\\`\\`/, "nomination issue body renders source links as plain code blocks");
