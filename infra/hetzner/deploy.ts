import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, listServerIpv4, loadVars, requireToken, SSH_PRIVATE_KEY } from "./common.js";

const STRICT = "StrictHostKeyChecking=accept-new";
const REMOTE_DIR = "/opt/gsw-mail";
const ARGS = ["-i", SSH_PRIVATE_KEY, "-o", STRICT, "-o", "ConnectTimeout=30", "-o", "IdentitiesOnly=yes"];

function ssh(remote: string, command: string): void {
  execFileSync("ssh", [...ARGS, `root@${remote}`, command], {
    encoding: "utf8",
    env: { ...process.env },
    stdio: "inherit",
  });
}

interface RemoteEnv {
  HOSTNAME: string;
  TZ: string;
  STALWART_PUBLIC_URL: string;
  STALWART_RECOVERY_ADMIN: string;
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return vars;
}

function resolveEnv(): RemoteEnv {
  const merged = { ...readEnvFile(join(REPO_ROOT, "infra", ".env")) };
  for (const key of Object.keys(merged)) process.env[key] ??= merged[key];
  for (const key of ["HOSTNAME", "TZ", "STALWART_PUBLIC_URL", "STALWART_RECOVERY_ADMIN"] as const) {
    const value = process.env[key];
    if (!value || value.includes("change-me")) {
      console.error(`deploy requires ${key} in infra/.env (see infra/.env.example); got ${value === undefined ? "unset" : "placeholder"}`);
      process.exit(1);
    }
  }
  return {
    HOSTNAME: process.env.HOSTNAME!,
    TZ: process.env.TZ!,
    STALWART_PUBLIC_URL: process.env.STALWART_PUBLIC_URL!,
    STALWART_RECOVERY_ADMIN: process.env.STALWART_RECOVERY_ADMIN!,
  };
}

requireToken();
loadVars();
const env = resolveEnv();
const remote = listServerIpv4();

ssh(remote, `mkdir -p ${REMOTE_DIR}`);
const localCompose = join(REPO_ROOT, "infra", "hetzner", "stalwart-compose.yml");
execFileSync("scp", [...ARGS, localCompose, `root@${remote}:${REMOTE_DIR}/docker-compose.yml`], { stdio: "inherit" });

const remoteEnvPath = `${REMOTE_DIR}/.env`;
const serialized = Object.entries(env)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");
writeFileSync("/tmp/gsw-mail-stalwart.env", `${serialized}\n`, "utf8");
execFileSync("scp", [...ARGS, "/tmp/gsw-mail-stalwart.env", `root@${remote}:${remoteEnvPath}`], { stdio: "inherit" });

ssh(
  remote,
  `cd ${REMOTE_DIR} && docker compose --env-file .env up -d && sleep 3 && docker compose ps`,
);

console.log(`Stalwart deployed to ${remote}. TLS/domain/accounts: follow docs/infra/STALWART.md and STALWART_RECOVERY_ADMIN bootstrap logs via 'docker compose -f ${REMOTE_DIR}/docker-compose.yml logs stalwart'.`);