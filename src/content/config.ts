import { defineCollection, z } from "astro:content";

const builds = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    sourceUrl: z.string().url(),
    sourceTitle: z.string().optional(),
    sourceAuthor: z.string().optional(),
    sourceAuthorUrl: z.string().url().optional(),
    sourcePublishedAt: z.string().optional(),
    platform: z.enum(["youtube", "tiktok", "instagram", "other"]),
    creator: z.string().default("Unknown creator"),
    heroImage: z.string(),
    galleryImages: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string().optional(),
          caption: z.string().optional(),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
    items: z.array(z.string()).default([]),
    inferredItems: z
      .array(
        z.object({
          name: z.string(),
          image: z.string(),
          evidence: z.string().optional(),
        }),
      )
      .default([]),
    summary: z.string(),
    capturedAt: z.string().optional(),
  }),
});

export const collections = { builds };
