import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string): Buffer => createHmac("sha256", key).update(value).digest();

const amzDate = (date: Date): string => date.toISOString().replace(/[:-]|\.\d{3}/g, "");
const dateStamp = (date: Date): string => amzDate(date).slice(0, 8);

const credentials = () => {
  const { accountId, accessKeyId, secretAccessKey, bucket, endpoint } = config.r2;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
};

export const r2Configured = (): boolean => Boolean(
  config.r2.accountId
  && config.r2.accessKeyId
  && config.r2.secretAccessKey
  && config.r2.bucket,
);

const canonicalPath = (bucket: string, key: string): string =>
  `/${encodeRfc3986(bucket)}/${key.split("/").map(encodeRfc3986).join("/")}`;

const canonicalQuery = (entries: Array<[string, string]>): string =>
  entries
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

const signingKey = (secret: string, stamp: string): Buffer => {
  const dateKey = hmac(`AWS4${secret}`, stamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

export function createR2PresignedUrl(input: {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  key: string;
  expiresSeconds?: number;
  now?: Date;
}): string {
  const { accountId, accessKeyId, secretAccessKey, bucket, endpoint } = credentials();
  const now = input.now ?? new Date();
  const expires = Math.max(1, Math.min(input.expiresSeconds ?? 600, 604800));
  const timestamp = amzDate(now);
  const stamp = dateStamp(now);
  const endpointUrl = new URL(endpoint || `https://${accountId}.r2.cloudflarestorage.com`);
  const host = endpointUrl.host;
  const scope = `${stamp}/auto/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", timestamp],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const uri = canonicalPath(bucket, input.key);
  const canonical = [
    input.method,
    uri,
    canonicalQuery(query),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    hash(canonical),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(secretAccessKey, stamp)).update(stringToSign).digest("hex");
  return `${endpointUrl.protocol}//${host}${uri}?${canonicalQuery([...query, ["X-Amz-Signature", signature]])}`;
}

export async function headR2Object(key: string): Promise<{ size: number; contentType: string | null; etag: string | null } | null> {
  const response = await fetch(createR2PresignedUrl({ method: "HEAD", key, expiresSeconds: 60 }), { method: "HEAD" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 HEAD failed with status ${response.status}`);
  return {
    size: Number(response.headers.get("content-length") ?? "0"),
    contentType: response.headers.get("content-type"),
    etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? null,
  };
}

export async function deleteR2Object(key: string): Promise<void> {
  const response = await fetch(createR2PresignedUrl({ method: "DELETE", key, expiresSeconds: 60 }), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`R2 DELETE failed with status ${response.status}`);
}


export async function verifyR2Connection(): Promise<{ configured: boolean; reachable: boolean }> {
  if (!r2Configured()) return { configured: false, reachable: false };
  await headR2Object("_gsw/healthcheck/nonexistent");
  return { configured: true, reachable: true };
}


export async function putR2Object(key: string, content: Buffer, contentType = "application/octet-stream"): Promise<{ etag: string | null }> {
  const response = await fetch(createR2PresignedUrl({ method: "PUT", key, expiresSeconds: 300 }), {
    method: "PUT",
    headers: { "content-type": contentType },
    body: content,
  });
  if (!response.ok) throw new Error(`R2 PUT failed with status ${response.status}`);
  return { etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? null };
}

export async function getR2Object(key: string): Promise<{ content: Buffer; contentType: string | null }> {
  const response = await fetch(createR2PresignedUrl({ method: "GET", key, expiresSeconds: 300 }));
  if (!response.ok) throw new Error(`R2 GET failed with status ${response.status}`);
  return {
    content: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}
