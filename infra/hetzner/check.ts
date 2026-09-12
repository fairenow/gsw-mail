import { hcloud, loadVars, requireToken } from "./common.js";

const RESOURCES: { label: string; args: string[] }[] = [
  { label: "servers", args: ["server", "list", "-o", "columns=name,status,ipv4", "-o", "noheader"] },
  { label: "ssh keys", args: ["ssh-key", "list", "-o", "columns=name,fingerprint", "-o", "noheader"] },
  { label: "firewalls", args: ["firewall", "list", "-o", "columns=name", "-o", "noheader"] },
  { label: "locations", args: ["location", "list", "-o", "columns=id,description", "-o", "noheader"] },
];

async function main(): Promise<void> {
  requireToken();
  loadVars();
  console.log("Hetzner Cloud read-only check:");
  for (const resource of RESOURCES) {
    const out = hcloud(resource.args, { quiet: true });
    const lines = out.split("\n").filter((l) => l.length > 0);
    console.log(`  ${resource.label}:`);
    if (lines.length === 0) {
      console.log("    (none)");
    } else {
      for (const line of lines) console.log(`    ${line}`);
    }
  }
  console.log("OK: read-only list succeeded; the token is valid for the linked Hetzner Cloud project.");
  console.log("No infrastructure was created.");
}

main().catch((err: unknown) => {
  console.error(`infra:hetzner:check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});