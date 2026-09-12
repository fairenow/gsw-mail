import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface HetznerResource {
  label: string;
  args: string[];
  apiPath: string;
  apiKey: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENV_LOCAL_PATH = join(REPO_ROOT, ".env.local");
const HCLOUD_BIN = "hcloud";
const API_BASE = "https://api.hetzner.cloud/v1";

const RESOURCES: HetznerResource[] = [
  { label: "servers", args: ["server", "list"], apiPath: "/servers", apiKey: "servers" },
  { label: "ssh keys", args: ["ssh-key", "list"], apiPath: "/ssh_keys", apiKey: "ssh_keys" },
  { label: "locations", args: ["location", "list"], apiPath: "/locations", apiKey: "locations" },
  { label: "server types", args: ["server-type", "list"], apiPath: "/server_types", apiKey: "server_types" },
];

function loadEnvLocal(): Record<string, string> {
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

function resolveToken(fileVars: Record<string, string>): string {
  return (
    process.env.HCLOUD_TOKEN ??
    process.env.HETZNER_API_TOKEN ??
    fileVars.HCLOUD_TOKEN ??
    fileVars.HETZNER_API_TOKEN ??
    ""
  );
}

function tokenSource(fileVars: Record<string, string>, token: string): string {
  if (fileVars.HCLOUD_TOKEN === token || fileVars.HETZNER_API_TOKEN === token) return ".env.local";
  return "the environment";
}

function hcloudInstalled(): boolean {
  try {
    execFileSync("which", [HCLOUD_BIN], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runCliCheck(): void {
  for (const resource of RESOURCES) {
    const records = execFileSync(HCLOUD_BIN, [...resource.args, "-o", "noheader"], {
      encoding: "utf8",
      env: { ...process.env },
    });
    const lines = records.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    console.log(`hcloud ${resource.label}:`);
    if (lines.length === 0) {
      console.log("  (none)");
    } else {
      for (const line of lines) console.log(`  ${line}`);
    }
  }
}

interface ApiListBody {
  [key: string]: unknown;
}

async function runApiCheck(token: string): Promise<void> {
  for (const resource of RESOURCES) {
    const res = await fetch(`${API_BASE}${resource.apiPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error(`Hetzner API rejected the token (HTTP 401)`);
    if (!res.ok) throw new Error(`Hetzner API ${resource.apiPath} failed with HTTP ${res.status}`);
    const body = (await res.json()) as ApiListBody;
    const items = (body[resource.apiKey] as unknown[] | undefined) ?? [];
    console.log(`api ${resource.label}: ${items.length}`);
  }
}

async function main(): Promise<void> {
  const fileVars = loadEnvLocal();
  for (const [key, value] of Object.entries(fileVars)) {
    process.env[key] ??= value;
  }
  const token = resolveToken(fileVars);
  if (!token) {
    console.error(
      `infra:hetzner:check: HETZNER_API_TOKEN is not set. Create ${ENV_LOCAL_PATH} with HETZNER_API_TOKEN=<hetzner cloud api token> (keep it gitignored) or export it.`,
    );
    process.exit(2);
  }
  process.env.HCLOUD_TOKEN = token;

  console.log(`Hetzner Cloud read-only check (token from ${tokenSource(fileVars, token)})`);
  if (hcloudInstalled()) {
    runCliCheck();
  } else {
    await runApiCheck(token);
    console.log("hcloud CLI not installed; used the Hetzner Cloud API directly.");
  }
  console.log("OK: read-only list succeeded; the token is valid for the linked Hetzner Cloud project.");
  console.log("No infrastructure was created.");
}

main().catch((err: unknown) => {
  console.error(`infra:hetzner:check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});