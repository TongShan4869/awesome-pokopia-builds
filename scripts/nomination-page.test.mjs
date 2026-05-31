import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const root = new URL("../", import.meta.url);

const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

const homepage = await readProjectFile("src/pages/index.astro");
assert.match(homepage, /href=\{`\$\{basePath\}nominate\/`\}/, "homepage links to the nomination page");

const nominationPage = await readProjectFile("src/pages/nominate.astro");
const pagesWorkflow = await readProjectFile(".github/workflows/pages.yml");
const readme = await readProjectFile("README.md");
assert.match(nominationPage, /Nominate a build/, "nomination page has a clear title");
assert.match(nominationPage, /source link/i, "nomination form asks for a source link");
assert.match(nominationPage, /description/i, "nomination form asks for a description");
assert.match(nominationPage, /curator/i, "nomination page makes the admin review flow clear");
assert.match(nominationPage, /PUBLIC_FORMSPREE_ENDPOINT/, "nomination form uses a configurable Formspree endpoint");
assert.match(nominationPage, /https:\/\/formspree\.io\/f\/xjgzdogw/, "nomination form defaults to the configured Formspree endpoint");
assert.match(nominationPage, /method="post"/, "nomination form submits nomination data with POST");
assert.match(nominationPage, /event\.preventDefault\(\)/, "nomination form submits without navigating away");
assert.match(nominationPage, /Accept: "application\/json"/, "nomination form requests a JSON Formspree response");
assert.match(nominationPage, /data-nomination-success/, "nomination form renders an on-page success state");
assert.match(nominationPage, /allowedHosts/, "nomination page checks source domains before submission");
assert.match(nominationPage, /www\.reddit\.com/, "nomination page accepts Reddit source links");
assert.match(nominationPage, /url\.protocol !== "https:"/, "nomination page rejects non-HTTPS links");
assert.doesNotMatch(nominationPage, /issues\/new/, "nomination form no longer redirects visitors to GitHub");
assert.match(pagesWorkflow, /PUBLIC_FORMSPREE_ENDPOINT: \$\{\{ vars\.PUBLIC_FORMSPREE_ENDPOINT \}\}/, "Pages build injects the Formspree endpoint");
assert.match(readme, /PUBLIC_FORMSPREE_ENDPOINT/, "README documents Formspree setup");
