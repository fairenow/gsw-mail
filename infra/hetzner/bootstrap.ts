import { execFileSync } from "node:child_process";
import { listServerIpv4, loadVars, requireToken, SSH_PRIVATE_KEY } from "./common.js";

const STRICT = "StrictHostKeyChecking=accept-new";

function ssh(remote: string, command: string): string {
  return execFileSync(
    "ssh",
    ["-i", SSH_PRIVATE_KEY, "-o", STRICT, "-o", "ConnectTimeout=30", "-o", "IdentitiesOnly=yes", `root@${remote}`, command],
    { encoding: "utf8", env: { ...process.env } },
  ).trim();
}

function bootstrapRemote(remote: string): void {
  console.log(`connecting to ${remote}`);
  const os = ssh(remote, "cat /etc/os-release | grep '^PRETTY_NAME='");
  console.log(`os: ${os}`);

  const dockerVersion = ssh(
    remote,
    "command -v docker >/dev/null 2>&1 && docker --version 2>/dev/null || echo 'docker:missing'",
  );
  if (dockerVersion.includes("missing")) {
    console.log("installing docker...");
    ssh(remote, "curl -fsSL https://get.docker.com | sh");
  } else {
    console.log(`docker present: ${dockerVersion}`);
  }

  const compose = ssh(remote, "docker compose version 2>/dev/null || echo 'compose:missing'");
  if (compose.includes("missing")) {
    console.log("installing docker compose plugin...");
    ssh(remote, "apt-get install -y docker-compose-plugin >/dev/null 2>&1 && docker compose version");
  } else {
    console.log(`compose present: ${compose}`);
  }

  ssh(remote, "groupadd -f docker");
  ssh(remote, "mkdir -p /opt/gsw-mail /opt/gsw-mail/backups");
  console.log("created /opt/gsw-mail and /opt/gsw-mail/backups");

  const maildir = ssh(remote, "test -d /var/lib/stalwart && echo present || echo missing");
  if (maildir === "missing") {
    console.log("creating /var/lib/stalwart for the mail store");
    ssh(remote, "mkdir -p /var/lib/stalwart /etc/stalwart && chown 2000:2000 /var/lib/stalwart /etc/stalwart || true");
  }

  const rclone = ssh(remote, "command -v rclone >/dev/null 2>&1 && echo present || echo missing");
  if (rclone === "missing") {
    console.log("rclone missing; install with the R2 backup runbook before enabling off-site backups");
  } else {
    console.log("rclone present");
  }
}

requireToken();
loadVars();
const ip = listServerIpv4();
bootstrapRemote(ip);
console.log(`bootstrap complete on ${ip}. Next: npm run infra:hetzner:deploy`);