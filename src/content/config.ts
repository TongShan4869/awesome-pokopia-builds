import { defineCollection, z } from "astro:content";

const builds = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    sourceUrl: z.string().url(),
    platform: z.enum(["youtube", "tiktok", "instagram", "other"]),
    creator: z.string().default("Unknown creator"),
    heroImage: z.string(),
    tags: z.array(z.string()).default([]),
    items: z.array(z.string()).default([]),
    summary: z.string(),
    capturedAt: z.string().optional(),
  }),
});

export const collections = { builds };
