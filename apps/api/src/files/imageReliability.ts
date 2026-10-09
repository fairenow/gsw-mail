export type AttemptClass = "permanent" | "rate_limit" | "timeout" | "provider_error";
export function classifyImageAttempt(status: number): AttemptClass {
  if ([400,401,403,404,422].includes(status)) return "permanent";
  if (status === 429) return "rate_limit";
  if (status === 504) return "timeout";
  return "provider_error";
}
export function imageAssetIsReady(
  asset: { status: string; userId: string; mimeType: string; sizeBytes: number | string },
  expected: { userId: string; mimeType: string; sizeBytes: number },
): boolean {
  return asset.status === "ready" && asset.userId === expected.userId && asset.mimeType === expected.mimeType && Number(asset.sizeBytes) === expected.sizeBytes;
}
