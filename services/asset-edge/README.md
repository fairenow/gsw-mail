# GSW asset delivery

The deployed Worker at https://gsw-asset-edge.ramon-709.workers.dev serves only signed requests for objects in the private gsw-mail-assets bucket. API routes must complete their existing ownership or publication checks before issuing a link. The bucket is not public.

Set ASSET_EDGE_URL and ASSET_EDGE_SIGNING_SECRET in the API deployment. Set the same secret as ASSET_SIGNING_SECRET in the Worker. Never commit the secret. Remove ASSET_EDGE_URL to fall back to direct R2 signed URLs.

Variants: original, 64, 128, 256, 512, 1024, 1600. Width variants resize supported raster images to WebP at quality 80; failed or oversized transformations retain the original. Original downloads preserve the bytes and support ranges. Image transformations can incur Cloudflare usage charges.

Signatures cover JSON.stringify([objectKey, variant, expiryInSeconds]). Links last 10–15 minutes, with stable URLs within five-minute windows. Authorization is verified before every edge-cache lookup. Responses sent to browsers use private caching for at most five minutes; internal authenticated cache entries last one day. Existing signed links can remain usable until expiry after access changes, as with the previous presigned R2 links. Object keys must be immutable; uploads already use distinct object keys.

The API uses original variants for downloads, width 128 for avatars, width 512 for published template logos, and width 1600 for requested image previews. Existing web/mobile download clients benefit from the same API response shape. Mobile clients can request a width from the download endpoint for previews. Do not send third-party email images through this service without a separate privacy design.

Run node --test services/asset-edge/worker.test.mjs. Deploy with Wrangler or Cloudflare's multipart upload API, preserving the secret binding. Observability is disabled so signed capability URLs are not written to Worker invocation logs.
