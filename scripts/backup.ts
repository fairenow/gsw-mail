import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";

const destination = resolve(process.argv[2] ?? "backup", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(destination, { recursive: true, mode: 0o700 });
const compose = (...args: string[]) => execFileSync("docker", ["compose", "--env-file", "infra/.env", "-f", "infra/docker-compose.yml", ...args], { stdio: "inherit" });
compose("stop", "api", "stalwart");
try {
  const dump = openSync(`${destination}/metadata.dump`, "wx", 0o600);
  try {
    execFileSync("docker", ["compose", "--env-file", "infra/.env", "-f", "infra/docker-compose.yml", "exec", "-T", "postgres", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], { stdio: ["ignore", dump, "inherit"] });
  } finally {
    closeSync(dump);
  }
  for (const volume of ["stalwart-data", "stalwart-etc"]) {
    execFileSync("docker", ["run", "--rm", "-v", `gsw-mail_${volume}:/source:ro`, "-v", `${destination}:/backup`, "alpine:3.22", "tar", "czf", `/backup/${volume}.tar.gz`, "-C", "/source", "."], { stdio: "inherit" });
  }
} finally {
  compose("start", "stalwart", "api");
}
console.log(`Backup complete: ${destination}. Encrypt and copy off-host; monitor that transfer separately.`);
