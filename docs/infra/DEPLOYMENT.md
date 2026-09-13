# Deployment bundle

Run from the repository root on a Docker host. Stalwart is pinned to `v0.16.18`; the API uses Node 22 and runs as a non-root user. Docker is unavailable on the development workstation, so image build, live JMAP, delivery, and restore verification must run on the target host before cutover.

1. Copy `infra/.env.example` to `infra/.env` and `infra/api.env.example` to `infra/api.env`. Restrict both files to the deploy user. Replace every placeholder; use a URL-encoded Postgres password in DATABASE_URL, matching PG_PASSWORD. The database hostname is `postgres` inside compose.
2. Set the real OIDC issuer (`OIDC_ISSUER`) and the public PKCE client id (`OIDC_CLIENT_ID=gsw-mail-web`). The API calls Stalwart's `/auth/introspect` with the server-only `STALWART_MAIL_USERNAME`/`STALWART_MAIL_PASSWORD` credential. Normal request JMAP calls use each caller's OAuth bearer token; background recovery jobs using the service credential require explicit Stalwart delegation. Set RESEND_API_KEY and the Resend webhook signing secret.
3. Run `docker compose --env-file infra/.env -f infra/docker-compose.yml config --quiet`, then `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d postgres stalwart`.
4. Build the migration target: `docker build --target migrate -t gsw-mail-migrate -f apps/api/Dockerfile .`. Run `docker run --rm --network gsw-mail_default --env-file infra/api.env gsw-mail-migrate`. Back up before applying migrations to an existing database.
5. Provision domains, accounts, aliases, standard mailboxes and TLS through Stalwart administration. Product account creation currently creates metadata only; provision the matching Stalwart account separately. Its JMAP session account name must equal the full product email address. Confirm each user's OAuth-token session exposes that user's own and delegated accounts. The factory resolves product UUIDs to these addresses inside the engine boundary.
6. Start the API with `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build api`. Put a TLS reverse proxy in front of loopback port 4000. Keep Postgres and recovery administration private. Use a trusted certificate on STALWART_JMAP_URL that is reachable from the API container; do not disable TLS verification.
7. Configure Resend to POST delivery, delay, bounce and complaint events to `https://api.mail.guidedstepswellness.com/webhooks/delivery`. The handler verifies Svix signatures over raw bytes, reads `svix-id` and `data.email_id`, and records recipient outcomes. Test a signed event and replay it.
8. Follow DNS.md, ACCEPTANCE.md, BACKUP.md and MONITORING.md before changing MX.

The API worker owns outbound delivery and uses the Resend HTTP API. Saving Sent through JMAP does not submit mail through Stalwart. Other relay providers are not implemented. Avoid enabling a second automatic outbound path.

Rollback: stop the API, preserve both mail volumes and metadata, and redeploy the previous image only if its schema is compatible. Restore the matching backup set if a migration requires database rollback. Reconcile accepted relay sends before restarting a restored queue to avoid duplicates. Retain the old MX values for rollback; an old provider is not automatically a valid backup MX.

References: [Stalwart Docker setup](https://stalw.art/docs/install/platform/docker/), [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction).
