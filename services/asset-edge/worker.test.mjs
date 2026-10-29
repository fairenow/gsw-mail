import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import worker, { authorize } from './worker.mjs';
const secret = 'test-secret-never-used-in-production';
function signed(overrides = {}) {
  const values = { key: 'private/user/image.png', variant: '128', expires: String(Math.floor(Date.now() / 1000) + 600), ...overrides };
  const signature = createHmac('sha256', secret).update(JSON.stringify([values.key, values.variant, values.expires])).digest('hex');
  return new URL(`https://assets.example/asset?${new URLSearchParams({ ...values, signature })}`);
}
test('signatures bind the object, variant and expiry', async () => {
  const url = signed();
  assert.ok(await authorize(url, secret));
  for (const [key, value] of [['key','another-user/secret'], ['variant','original'], ['expires', '1']]) {
    const changed = new URL(url);
    changed.searchParams.set(key, value);
    assert.equal(await authorize(changed, secret), null);
  }
  assert.equal(await authorize(signed({expires:String(Math.floor(Date.now()/1000)-1)}), secret), null);
  assert.equal(await authorize(signed({variant:'99999'}), secret), null);
  assert.equal(await authorize(url, 'wrong-secret'), null);
});
test('edge cache is checked only after authentication and browser response stays private', async () => {
  let reads = 0, checks = 0;
  const cache = new Map();
  globalThis.caches = { default: { match: async key => { checks++; return cache.get(key.url)?.clone(); }, put: async (key,value) => { cache.set(key.url,value); } } };
  const env = { ASSET_SIGNING_SECRET:secret, ASSETS:{ get: async () => { reads++; return { size:5, body:'hello', range:{offset:0,length:5}, httpMetadata:{contentType:'text/plain'}, httpEtag:'"v1"', writeHttpMetadata:h=>h.set('Content-Type','text/plain') }; } } };
  const pending = [];
  const ctx = {waitUntil:p=>pending.push(p)};
  const url = signed({variant:'original'});
  const first = await worker.fetch(new Request(url),env,ctx);
  assert.equal(first.status,200);
  assert.match(first.headers.get('Cache-Control'),/^private/);
  assert.equal(await first.text(),'hello');
  await Promise.all(pending);
  const second = await worker.fetch(new Request(url),env,ctx);
  assert.equal(second.headers.get('X-Asset-Cache'),'HIT');
  assert.equal(reads,1);
  const invalid = new URL(url); invalid.searchParams.set('signature','0'.repeat(64));
  assert.equal((await worker.fetch(new Request(invalid),env,ctx)).status,403);
  assert.equal(checks,2);
  const ranged = await worker.fetch(new Request(url,{headers:{Range:'bytes=0-4'}}),env,ctx);
  assert.equal(ranged.status,206);
  assert.equal(ranged.headers.get('Content-Range'),'bytes 0-4/5');
});
