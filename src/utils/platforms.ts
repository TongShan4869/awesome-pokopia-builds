export const platformLabels: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  reddit: "Reddit",
  other: "Other",
};

export function formatPlatform(platform: string) {
  return platformLabels[platform] ?? platform;
}
