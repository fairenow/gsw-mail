import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hcloud, loadVars, publicIpv4, requireToken, SERVER_NAME, SSH_KEY_NAME, FIREWALL_NAME, SSH_PRIVATE_KEY, SSH_PUBLIC_KEY, serverUserData } from "./common.js";

const TYPE = process.env.HETZNER_SERVER_TYPE ?? "cx23";
const IMAGE = process.env.HETZNER_SERVER_IMAGE ?? "ubuntu-24.04";
const LOCATION = process.env.HETZNER_LOCATION ?? "nbg1";
const SSH_ALLOW = process.env.HETZNER_SSH_ALLOW_IPS ?? "";

function toCidr(ip: string): string {
  return ip.includes("/") ? ip : `${ip}/32`;
}

function ensureLocalKeypair(): void {
  if (existsSync(SSH_PRIVATE_KEY)) {
    console.log(`local ssh key present: ${SSH_PRIVATE_KEY}`);
    return;
  }
  mkdirSync(dirname(SSH_PRIVATE_KEY), { recursive: true });
  execFileSync("ssh-keygen", ["-t", "ed25519", "-f", SSH_PRIVATE_KEY, "-N", "", "-C", "gsw-mail-mx1@guidedstepswellness.com"], { stdio: "inherit" });
  console.log(`generated ssh key: ${SSH_PRIVATE_KEY}`);
}

function ensureHcloudSshKey(): void {
  const existing = hcloud(["ssh-key", "list", "-o", "columns=name", "-o", "noheader"]);
  if (existing.split("\n").includes(SSH_KEY_NAME)) {
    console.log(`hetzner ssh key present: ${SSH_KEY_NAME}`);
    return;
  }
  const pub = readFileSync(SSH_PUBLIC_KEY, "utf8").trim();
  hcloud(["ssh-key", "create", "--name", SSH_KEY_NAME, "--public-key", pub, "--label", "project=gsw-mail"]);
  console.log(`created hetzner ssh key: ${SSH_KEY_NAME}`);
}

interface FirewallRule {
  direction: string;
  source_ips: string[];
  protocol: string;
  port: string;
}

function readFirewallRules(name: string): FirewallRule[] {
  const json = JSON.parse(hcloud(["firewall", "list", "-o", "json"])) as {
    name: string;
    rules: FirewallRule[];
  }[];
  return json.find((f) => f.name === name)?.rules ?? [];
}

function ruleKey(rule: FirewallRule): string {
  return `${rule.direction}|${rule.protocol}|${rule.port}|${[...rule.source_ips].sort().join(",")}`;
}

const desiredRules: Omit<FirewallRule, "source_ips">[] = [
  { direction: "in", protocol: "tcp", port: "25" },
  { direction: "in", protocol: "tcp", port: "443" },
];

function ensureFirewall(): void {
  const existing = hcloud(["firewall", "list", "-o", "columns=name", "-o", "noheader"]);
  if (!existing.split("\n").includes(FIREWALL_NAME)) {
    hcloud(["firewall", "create", "--name", FIREWALL_NAME, "--label", "project=gsw-mail"]);
    console.log(`created firewall: ${FIREWALL_NAME}`);
  }
  const allowSsh = (SSH_ALLOW || publicIpv4() || "0.0.0.0/0").split(",").map((s) => toCidr(s.trim()));
  desiredRules.push({ direction: "in", protocol: "tcp", port: "22" });
  const present = new Set(readFirewallRules(FIREWALL_NAME).map(ruleKey));
  const wanted: FirewallRule[] = desiredRules.map((rule) => ({
    ...rule,
    source_ips: rule.port === "22" ? allowSsh : ["0.0.0.0/0"],
  }));
  for (const rule of wanted) {
    if (!present.has(ruleKey(rule))) {
      hcloud([
        "firewall", "add-rule", "--direction", rule.direction, "--protocol", rule.protocol,
        "--port", rule.port, "--source-ips", ...rule.source_ips, FIREWALL_NAME,
      ]);
      console.log(`added rule ${rule.protocol}:${rule.port} from ${rule.source_ips.join(",")}`);
    }
  }
  console.log(`firewall reconciled: ${FIREWALL_NAME} ssh:${allowSsh.join(",")} smtp:25 https:443`);
}

function ensureServer(): void {
  const existing = hcloud(["server", "list", "-o", "columns=name,ipv4", "-o", "noheader"]);
  const row = existing.split("\n").find((l) => l.startsWith(`${SERVER_NAME}\t`));
  if (row) {
    console.log(`server present: ${SERVER_NAME} @ ${row.split("\t")[1]}`);
    return;
  }
  const userDataFile = "/tmp/gsw-mail-mx1-userdata.yaml";
  writeFileSync(userDataFile, serverUserData(), "utf8");
  const out = hcloud([
    "server",
    "create",
    "--name", SERVER_NAME,
    "--type", TYPE,
    "--image", IMAGE,
    "--location", LOCATION,
    "--ssh-key", SSH_KEY_NAME,
    "--firewall", FIREWALL_NAME,
    "--label", "project=gsw-mail",
    "--label", "role=stalwart",
    "--user-data-from-file", userDataFile,
    "-o", "json",
  ]);
  try {
    const json = JSON.parse(out);
    const ip = json.server?.public_net?.ipv4?.ip;
    console.log(`created server ${SERVER_NAME} (${TYPE}/${IMAGE}/${LOCATION}) @ ${ip}`);
  } catch {
    console.log(`created server ${SERVER_NAME}; run the check script to read its ipv4`);
  }
}

requireToken();
loadVars();
ensureLocalKeypair();
ensureHcloudSshKey();
ensureFirewall();
ensureServer();
console.log("provision complete. Next: npm run infra:hetzner:bootstrap");