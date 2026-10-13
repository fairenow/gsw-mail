# GSW Files — private storage, branded links and sharing design

## Decision (October 2026)
Keep existing gsw-mail-assets R2 bucket PRIVATE. Do NOT enable Cloudflare Public Development URL or attach a publicly accessible custom R2 domain to this mixed private-content bucket.

User-facing share base: `https://files.guidedstepswellnessthecommunityonline.org` (proposed, NOT yet DNS configured). Use an app route /s/:opaqueToken behind a GSW application/Worker that checks access before issuing a short-lived R2 download. Until provisioned, use an equivalent route on the already-deployed GSW domain. Never show raw account-ID/R2 keys or permanent presigned storage URLs as user-facing share links.

## Root cause evidence for CSV chat prompt
Previous `shouldPreAnalyzeAttachments()` matcher omitted CSV, XLSX and generic file; 'Tell me what this csv file is about' did not match the preanalysis route. Updated matcher enables eager analysis. The stream returned HTTP 200 after approximately 92 seconds but an SSE/chat-level error occurred; HTTP 200 is insufficient to mark run successful. Verify model events, tool outputs, and persisted command status before asserting a second root cause.

## Data model (planned; do not auto-enable)
`file_shares`:
- id, owner_user_id, asset_id, permission (viewer initially; editor only with version-safe edit path), access_mode (restricted|anyone_with_link), recipient_email (nullable), token_hash (nullable), expires_at, revoked_at, created_at, updated_at
- unique link token hash, owner+asset indexes, recipient email normalized; avoid enumerate-shares endpoints.
- Shared files remain owned by their original user. Revocation/expiry is checked at EACH request. Block deleted/trashed/unready assets.
- Email-restricted access: authenticated session AND verified normalized account email match; mere possession of an emailed URL is not authorization. Invitation notifications must not grant access to nonmembers until identity is verified.
- Public link: 256-bit randomly generated opaque token, store SHA-256 only. Default to viewer, no edit and no anonymous write.
- Separate download/preview streaming through authenticated backend for strict revocation, or issue 60-second R2 presigned redirect with documented residual validity after revocation. Do not cache private responses on a public CDN.

## API plan
- POST /product/files/:assetId/shares : create restricted recipient or public-viewer link (owner only)
- GET /product/files/:assetId/shares : view existing grants (owner only)
- DELETE /product/files/:assetId/shares/:id : revoke (owner only)
- GET /product/files/shared-with-me : recipient's granted assets
- GET /product/files/shared/:id/download : verify authenticated recipient, then stream/redirect
- GET /s/:opaqueToken : anonymous/public viewer link only with explicit opt-in, throttling and attachment-safe headers
- PATCH sharing settings only after audit log and authorization tests are in place

## Web & mobile UI
- Share dialog on each file: 'Restricted' / 'Anyone with the link', invite by email, viewer permission, Copy link, Revoke, Expires, Shared with me section.
- Editor role future: only after concurrency/versioning, audit log and no lost writes.
- For CSV/XLSX: preview, open/download original, analyze, produce new version via files.transform; avoid destructive overwrite until version history is implemented.
- Changes to shares must show ownership, warn before enabling public access, and invalidate accessible-file caches on revoke.

## Tests / roll-out gates
- Two signed-in users: owner, invited, unrelated; anonymous visitor. Verify deny/allow/revoke/expiry across all endpoints.
- Confirm public link cannot leak private owner path, R2 credential or storage key.
- Verify signed URL TTL and that revoked links cannot mint new signed URLs.
- Invalid share tokens return generic 404 to prevent enumeration.
- Restrict content disposition to attachment for risky types; sandbox inline previews.
- Test one actual CSV extraction and XLSX transformation from an attached GSW file.
- Provision DNS/SSL + Worker/custom application domain via Cloudflare; do NOT expose bucket directly.
