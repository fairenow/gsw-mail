#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f infra/.env ]; then
  cp infra/.env.example infra/.env
  echo "Created infra/.env — edit the passwords before starting."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker first." >&2
  exit 1
fi

docker compose -f infra/docker-compose.yml up -d

echo
echo "=== Stalwart first-boot ==="
echo "Bootstrap admin password: docker logs stalwart | grep 'administrator account'"
echo "Admin UI: http://localhost:8080  (https on :443)"
echo
echo "Next steps:"
echo "  1. In the admin UI add the domain guidedstepswellness.com and copy the"
echo "     MX/SPF/DKIM/DMARC records to DNS (docs/DNS.md)."
echo "  2. Create a mailbox account to use with JMAP/IMAP."
echo "  3. Run the API: cd apps/api && npm install && npm run dev"