import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://tongshan4869.github.io",
  base: "/awesome-pokopia-builds",
  integrations: [mdx()],
});
