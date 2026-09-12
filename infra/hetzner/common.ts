import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_LOCAL_PATH = join(REPO_ROOT, ".env.local");
export const HCLOUD_BIN = "hcloud";
export const SERVER_NAME = "gsw-mail-mx1";
export const FIREWALL_NAME = "gsw-mail-mx1";
export const SSH_KEY_NAME = "gsw-mail-mx1";
export const KEYS_DIR = join(REPO_ROOT, "infra", "hetzner", "keys");
export const SSH_PRIVATE_KEY = join(KEYS_DIR, "mx1_ed25519");
export const SSH_PUBLIC_KEY = `${SSH_PRIVATE_KEY}.pub`;

export function loadEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_LOCAL_PATH)) return {};
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(ENV_LOCAL_PATH, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (vars[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function loadVars(): Record<string, string> {
  const fileVars = loadEnvLocal();
  for (const [key, value] of Object.entries(fileVars)) {
    process.env[key] ??= value;
  }
  return fileVars;
}

export function requireToken(): string {
  const fileVars = loadEnvLocal();
  const token =
    process.env.HCLOUD_TOKEN ??
    process.env.HETZNER_API_TOKEN ??
    fileVars.HCLOUD_TOKEN ??
    fileVars.HETZNER_API_TOKEN ??
    "";
  if (!token) {
    console.error(
      `HETZNER_API_TOKEN is not set. Create ${ENV_LOCAL_PATH} with HETZNER_API_TOKEN=<hetzner cloud api token> or export it.`,
    );
    process.exit(2);
  }
  process.env.HCLOUD_TOKEN = token;
  return token;
}

export function hcloud(args: string[], opts: { quiet?: boolean } = {}): string {
  try {
    return execFileSync(HCLOUD_BIN, args, { encoding: "utf8", env: { ...process.env } }).trim();
  } catch (err) {
    const detail = err instanceof Error && "stderr" in err ? String((err as { stderr?: Buffer }).stderr ?? "") : String(err);
    if (opts.quiet) return "";
    console.error(`hcloud ${args.join(" ")} failed: ${detail.trim()}`);
    process.exit(1);
  }
}

interface ServerRow {
  name: string;
  public_net: { ipv4?: { ip?: string } };
  status?: string;
}

export function listServers(): ServerRow[] {
  return JSON.parse(hcloud(["server", "list", "-o", "json"])) as ServerRow[];
}

export function listServerIpv4(): string {
  const row = listServers().find((s) => s.name === SERVER_NAME);
  const ip = row?.public_net?.ipv4?.ip;
  if (!ip) {
    console.error(`${SERVER_NAME} does not exist yet; run provision first.`);
    process.exit(1);
  }
  return ip;
}

export function publicIpv4(): string {
  try {
    const ip = execFileSync("curl", ["-fsS", "--max-time", "10", "https://api.ipify.org"], { encoding: "utf8" }).trim();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return `${ip}`;
  } catch {
    /* fall through */
  }
  return "";
}

export function serverUserData(): string {
  return `#cloud-config
preserve_hostname: false
hostname: mx1.guidedstepswellness.com
`;
}

export interface ServerInfo {
  name: string;
  status: string;
  ipv4: string;
}

export function describeServer(): ServerInfo | null {
  const rows = listServers();
  if (rows.length === 0) return null;
  const row = rows[0];
  return { name: row.name, status: row.status ?? "unknown", ipv4: row.public_net?.ipv4?.ip ?? "" };
}