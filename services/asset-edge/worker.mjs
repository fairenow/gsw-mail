const widths = new Set([64, 128, 256, 512, 1024, 1600]);
const raster = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const encoder = new TextEncoder();
export async function authorize(url, secret, now = Date.now()) {
  const key = url.searchParams.get('key');
  const variant = url.searchParams.get('variant');
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');
  const ttl = Number(expires) - Math.floor(now / 1000);
  if (!secret || !key || key.length > 2048 || !signature || !/^[a-f0-9]{64}$/.test(signature) || !/^\d+$/.test(expires || '') || ttl <= 0 || ttl > 3600 || !(variant === 'original' || widths.has(Number(variant)))) return null;
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g), value => parseInt(value, 16));
  const valid = await crypto.subtle.verify('HMAC', signingKey, bytes, encoder.encode(JSON.stringify([key, variant, expires])));
  return valid ? { key, variant, ttl } : null;
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'gsw-asset-edge' });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, X-Asset-Cache, X-Asset-Transform' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    if (url.pathname !== '/asset') return new Response('Not found', { status: 404 });
    const grant = await authorize(url, env.ASSET_SIGNING_SECRET);
    if (!grant) return new Response('Invalid or expired link', { status: 403, headers: { ...cors, 'Cache-Control': 'no-store' } });
    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = '/internal-cache/v1';
    cacheUrl.search = new URLSearchParams({ key: grant.key, variant: grant.variant }).toString();
    const cacheKey = new Request(cacheUrl, { method: 'GET' });
    const range = request.headers.get('Range');
    let response = !range ? await caches.default.match(cacheKey) : null;
    const hit = Boolean(response);
    if (!response) {
      const object = await env.ASSETS.get(grant.key, range && grant.variant === 'original' ? { range: request.headers } : undefined);
      if (!object) return new Response('Not found', { status: 404, headers: { ...cors, 'Cache-Control': 'no-store' } });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('ETag', object.httpEtag);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.delete('Set-Cookie');
      if (grant.variant !== 'original' && raster.has(object.httpMetadata?.contentType) && object.size <= 20 * 1024 * 1024) {
        try {
          response = (await env.IMAGES.input(object.body).transform({ width: Number(grant.variant), fit: 'scale-down' }).output({ format: 'image/webp', quality: 80 })).response();
          response = new Response(response.body, response);
          response.headers.set('X-Asset-Transform', 'webp');
        } catch {
          const original = await env.ASSETS.get(grant.key);
          if (!original) return new Response('Not found', { status: 404 });
          response = new Response(original.body, { headers });
          response.headers.set('X-Asset-Transform', 'original-fallback');
        }
      } else {
        headers.set('Content-Length', String(range ? object.range?.length ?? object.size : object.size));
        headers.set('Accept-Ranges', 'bytes');
        if (range && object.range) headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
        if (!raster.has(object.httpMetadata?.contentType) && object.httpMetadata?.contentType !== 'application/pdf') headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
        response = new Response(object.body, { status: range && object.range ? 206 : 200, headers });
      }
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Cache-Control', 'public, max-age=86400');
      if (!range && object.size <= 25 * 1024 * 1024 && response.status === 200 && response.headers.get('X-Asset-Transform') !== 'original-fallback') ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    }
    response = new Response(request.method === 'HEAD' ? null : response.body, response);
    response.headers.set('Cache-Control', `private, max-age=${Math.min(300, grant.ttl)}`);
    response.headers.set('X-Asset-Cache', hit ? 'HIT' : 'MISS');
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
};
