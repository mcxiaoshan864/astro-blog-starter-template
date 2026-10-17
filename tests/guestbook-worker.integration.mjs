import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';

const deployment = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../dist/_worker.js/', import.meta.url)).replace(/\/$/, '');
async function modulesAt(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) result.push(...await modulesAt(path));
    else if (/\.(mjs|js)$/.test(entry.name)) result.push({ type: 'ESModule', path, contents: await readFile(path, 'utf8') });
  }
  return result;
}
const modules = await modulesAt(root);
modules.sort((a, b) => Number(b.path === root + '/index.js') - Number(a.path === root + '/index.js'));
const schema = await readFile(new URL('../migrations/0001_guestbook.sql', import.meta.url), 'utf8');
const origin = 'https://mcxiaoshan.test';
const password = 'Disposable-guestbook-tests-' + randomBytes(16).toString('hex');
const salt = randomBytes(16);
const auth = JSON.stringify({ version: 1, salt: salt.toString('base64url'), digest: pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64url'), sessionKey: randomBytes(32).toString('base64url') });
let ip = 0;
const post = (body, extra = {}) => ({ method: 'POST', headers: { origin, 'content-type': 'application/json', 'CF-Connecting-IP': `192.0.2.${++ip % 250}`, ...extra }, body: JSON.stringify(body), redirect: 'manual' });
const form = (fields, cookie, headers = {}) => ({ method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...headers }, body: new URLSearchParams(fields), redirect: 'manual' });
async function worker(limit = 100) {
  const seen = new Set();
  const mf = new Miniflare({
    modules, modulesRoot: root, compatibilityDate: deployment.compatibility_date, compatibilityFlags: deployment.compatibility_flags,
    log: new Log(LogLevel.ERROR),
    bindings: { ADMIN_AUTH: auth, TURNSTILE_SECRET: 'disposable-mock-secret', TURNSTILE_HOSTNAMES: 'mcxiaoshan.test' },
    d1Databases: ['GUESTBOOK_DB'],
    ratelimits: { ADMIN_LOGIN_LIMITER: { simple: { limit: 5, period: 60 } }, GUESTBOOK_LIMITER: { simple: { limit, period: 60 } } },
    serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
    outboundService: async request => {
      assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      const fields = new URLSearchParams(await request.text());
      assert.equal(fields.get('secret'), 'disposable-mock-secret');
      const token = fields.get('response');
      if (token === 'http-failure') return new Response('offline', { status: 503 });
      if (token === 'bad-json') return new Response('not json');
      const success = !seen.has(token) && token !== 'invalid'; seen.add(token);
      return Response.json({ success: token === 'truthy' ? 'true' : success, action: token === 'wrong-action' ? 'login' : 'guestbook', hostname: token === 'wrong-host' ? 'localhost' : 'mcxiaoshan.test' });
    },
  });
  const db = await mf.getD1Database('GUESTBOOK_DB');
  await db.batch(schema.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  return { mf, db };
}
const publicList = async mf => (await mf.dispatchFetch(origin + '/api/guestbook')).json();
async function login(mf) {
  const result = await mf.dispatchFetch(origin + '/admin/login/', form({ username: 'admin', password }));
  assert.equal(result.status, 303);
  return result.headers.get('set-cookie').split(';')[0];
}
test('real D1 moderation lifecycle hides pending content and escapes text in admin HTML', async () => {
  const { mf, db } = await worker();
  try {
    const nickname = '<img src=x>';
    const message = '<script>alert(1)</script>\n你好';
    const submitted = await mf.dispatchFetch(origin + '/api/guestbook', post({ nickname, message, token: 'first-real-flow' }));
    assert.equal(submitted.status, 202); assert.deepEqual(await submitted.json(), { ok: true });
    assert.deepEqual((await publicList(mf)).messages, []);
    const row = await db.prepare('SELECT * FROM guestbook_messages').first();
    assert.equal(row.status, 'pending'); assert.equal(row.message, message);
    const cookie = await login(mf);
    const page = await mf.dispatchFetch(origin + '/admin/guestbook/', { headers: { cookie } });
    assert.equal(page.status, 200); assert.match(page.headers.get('cache-control'), /no-store/);
    const html = await page.text(); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>alert\(1\)/); assert.match(html, /待审核/);
    const reply = await mf.dispatchFetch(origin + '/admin/guestbook/action', form({ id: String(row.id), action: 'reply', reply: '欢迎来玩！' }, cookie));
    assert.equal(reply.status, 303); assert.deepEqual((await publicList(mf)).messages, [], 'reply must not publish a pending message');
    const publish = await mf.dispatchFetch(origin + '/admin/guestbook/action', form({ id: String(row.id), action: 'publish' }, cookie)); assert.equal(publish.status, 303);
    const visible = (await publicList(mf)).messages; assert.equal(visible.length, 1); assert.equal(visible[0].reply, '欢迎来玩！'); assert.equal(visible[0].message, message); assert.equal(visible[0].status, undefined);
    await mf.dispatchFetch(origin + '/admin/guestbook/action', form({ id: String(row.id), action: 'reply', reply: '' }, cookie)); assert.equal((await publicList(mf)).messages[0].reply, '');
    await mf.dispatchFetch(origin + '/admin/guestbook/action', form({ id: String(row.id), action: 'hide' }, cookie)); assert.deepEqual((await publicList(mf)).messages, []);
    await mf.dispatchFetch(origin + '/admin/guestbook/action', form({ id: String(row.id), action: 'delete' }, cookie)); assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM guestbook_messages').first()).n, 0);
  } finally { await mf.dispose(); }
});
test('Turnstile rejects missing, replayed, wrong hostname/action, malformed and non-boolean results', async () => {
  const { mf, db } = await worker();
  try {
    for (const token of ['', 'invalid', 'wrong-host', 'wrong-action', 'truthy', 'http-failure', 'bad-json']) {
      const result = await mf.dispatchFetch(origin + '/api/guestbook', post({ nickname: '访客', message: 'hello', token }));
      assert.equal(result.status, 403, token); assert.equal((await result.json()).error, 'verification');
    }
    for (const expected of [202, 403]) {
      const response = await mf.dispatchFetch(origin + '/api/guestbook', post({ nickname: '访客', message: 'single use', token: 'single-use-token' })); assert.equal(response.status, expected);
    }
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM guestbook_messages').first()).n, 1);
  } finally { await mf.dispose(); }
});
test('guestbook rejects cross-origin writes, oversized input, reserved names and unauthorized moderation', async () => {
  const { mf, db } = await worker();
  try {
    const valid = { nickname: '来客', message: '你好', token: 'token' };
    for (const headers of [{origin:'https://evil.test'}, {origin:'null'}, {'sec-fetch-site':'cross-site'}]) {
      assert.equal((await mf.dispatchFetch(origin + '/api/guestbook', post(valid, headers))).status, 403);
    }
    for (const fields of [{nickname:'admin'}, {nickname:'站长'}, {nickname:'x'.repeat(25)}, {nickname:'a\nb'}, {message:'x'.repeat(1001)}, {message:'\u0000'}, {message:'  '}]) {
      assert.equal((await mf.dispatchFetch(origin + '/api/guestbook', post({...valid,...fields}))).status, 400);
    }
    assert.equal((await mf.dispatchFetch(origin + '/api/guestbook', post({...valid,message:'x'.repeat(20000)}))).status, 413);
    const forged = await mf.dispatchFetch(origin + '/admin/guestbook/action', form({id:'1',action:'publish'}, '__Host-admin_session=forged')); assert.equal(forged.status, 303); assert.match(forged.headers.get('location'), /admin\/login/);
    const cookie = await login(mf);
    assert.equal((await mf.dispatchFetch(origin + '/admin/guestbook/action', form({id:'1',action:'delete'}, cookie, {origin:'https://evil.test'}))).status, 403);
    assert.equal((await mf.dispatchFetch(origin + '/admin/guestbook/action', {headers:{cookie},redirect:'manual'})).status, 405);
    const duplicate = await mf.dispatchFetch(origin + '/admin/guestbook/action', {...form({},cookie),body:'id=1&id=2&action=delete'}); assert.match(duplicate.headers.get('location'), /error=invalid/);
    const unknown = await mf.dispatchFetch(origin + '/admin/guestbook/action', form({id:'999',action:'delete'},cookie)); assert.match(unknown.headers.get('location'), /error=missing/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM guestbook_messages').first()).n, 0);
  } finally { await mf.dispose(); }
});
test('public pagination is ordered, bounded, and excludes all pending messages', async () => {
  const { mf, db } = await worker();
  try {
    await db.batch(Array.from({length:45}, (_,i) => db.prepare('INSERT INTO guestbook_messages (nickname,message,status) VALUES (?,?,?)').bind('visitor',String(i),i % 2 ? 'published' : 'pending')));
    const first = await publicList(mf); assert.equal(first.messages.length, 20); assert.ok(first.nextCursor); assert.ok(first.messages.every(row => Number(row.message) % 2 === 1));
    const second = await (await mf.dispatchFetch(origin + '/api/guestbook?cursor=' + first.nextCursor)).json(); assert.equal(second.messages.length, 2); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.messages,...second.messages].map(row=>row.id)).size, 22);
    for (const cursor of ['-1','1 OR 1=1','9007199254740992','abc']) assert.equal((await mf.dispatchFetch(origin + '/api/guestbook?cursor=' + encodeURIComponent(cursor))).status, 400);
  } finally { await mf.dispose(); }
});
test('production guest rate limit rejects the fourth attempt per minute', async () => {
  const { mf, db } = await worker(3);
  try {
    for (let i=0;i<3;i++) assert.equal((await mf.dispatchFetch(origin + '/api/guestbook', post({nickname:'访客',message:'你好',token:'rate-'+i},{'CF-Connecting-IP':'198.51.100.1'}))).status, 202);
    const limited = await mf.dispatchFetch(origin + '/api/guestbook', post({nickname:'访客',message:'你好',token:'fourth'},{'CF-Connecting-IP':'198.51.100.1'})); assert.equal(limited.status,429); assert.equal(limited.headers.get('retry-after'),'60');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM guestbook_messages').first()).n,3);
  } finally { await mf.dispose(); }
});
