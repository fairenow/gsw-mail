import { createHmac } from "node:crypto";

const widths = new Set([64, 128, 256, 512, 1024, 1600]);

export function signedAssetEdgeUrl(input: { key: string; width?: number; now?: number; baseUrl?: string; secret?: string }): string | null {
  const baseUrl = input.baseUrl ?? process.env.ASSET_EDGE_URL;
  const secret = input.secret ?? process.env.ASSET_EDGE_SIGNING_SECRET;
  if (!baseUrl || !secret) return null;
  const variant = input.width && widths.has(input.width) ? String(input.width) : "original";
  const expires = String((Math.floor((input.now ?? Date.now()) / 300_000) + 3) * 300);
  const signature = createHmac("sha256", secret).update(JSON.stringify([input.key, variant, expires])).digest("hex");
  const url = new URL("/asset", baseUrl);
  url.search = new URLSearchParams({ key: input.key, variant, expires, signature }).toString();
  return url.toString();
}
