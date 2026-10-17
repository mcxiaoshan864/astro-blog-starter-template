import { sameOrigin } from './admin-auth';

// Binding shapes are generated from Wrangler; partial bindings allow fail-closed setup checks.
export interface GuestbookEnvironment extends Partial<Pick<Cloudflare.Env, 'GUESTBOOK_DB' | 'GUESTBOOK_LIMITER'>> {
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
}
export interface Message {
  id: number;
  nickname: string;
  message: string;
  reply: string;
  created_at: number;
  replied_at: number | null;
}
export interface AdminMessage extends Message { status: 'pending' | 'published' }
export class GuestbookError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  } });
}
export async function boundedText(request: Request, maximum = 32768): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new GuestbookError(400, 'invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new GuestbookError(413, 'too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new GuestbookError(400, 'invalid'); }
}
export function cleanText(value: unknown, maximum: number, multiline = false): string {
  if (typeof value !== 'string') throw new GuestbookError(400, 'invalid');
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!text || [...text].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || (!multiline && /[\n\t]/.test(text))) {
    throw new GuestbookError(400, 'invalid');
  }
  return text;
}
export function cursorValue(value: string | null): number {
  if (value === null) return Number.MAX_SAFE_INTEGER;
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new GuestbookError(400, 'invalid');
  return Number(value);
}
export async function publicMessages(env: GuestbookEnvironment, cursor: string | null) {
  if (!env.GUESTBOOK_DB) throw new GuestbookError(503, 'unavailable');
  const rows = await env.GUESTBOOK_DB.prepare("SELECT id, nickname, message, reply, created_at, replied_at FROM guestbook_messages WHERE status = 'published' AND id < ? ORDER BY id DESC LIMIT 21")
    .bind(cursorValue(cursor)).all<Message>();
  const messages = rows.results.slice(0, 20);
  return { messages, nextCursor: rows.results.length > 20 ? String(messages[19].id) : null };
}
export async function submitMessage(request: Request, env: GuestbookEnvironment, verifyFetch: typeof fetch = fetch): Promise<void> {
  if (!sameOrigin(request)) throw new GuestbookError(403, 'origin');
  if (!env.GUESTBOOK_DB || !env.GUESTBOOK_LIMITER || !env.TURNSTILE_SECRET) throw new GuestbookError(503, 'unavailable');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new GuestbookError(415, 'invalid');
  let limited;
  try { limited = await env.GUESTBOOK_LIMITER.limit({ key: `guestbook:${request.headers.get('CF-Connecting-IP') || 'unknown'}` }); }
  catch { throw new GuestbookError(503, 'unavailable'); }
  if (!limited.success) throw new GuestbookError(429, 'rate');
  let body;
  try { body = JSON.parse(await boundedText(request, 16384)); }
  catch (error) { if (error instanceof GuestbookError) throw error; throw new GuestbookError(400, 'invalid'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GuestbookError(400, 'invalid');
  const nickname = cleanText(body.nickname, 24);
  const message = cleanText(body.message, 1000, true);
  if (/^(admin|administrator|站长|站長|管理员|管理員|mcxiaoshan)$/iu.test(nickname)) throw new GuestbookError(400, 'reserved');
  const token = body.token;
  const expectedHosts = new Set((env.TURNSTILE_HOSTNAMES || '').split(',').map(host => host.trim()).filter(Boolean));
  // A deployment only accepts challenges from its own HTTPS frontend, never localhost in production.
  const hostname = new URL(request.url).hostname;
  if (!expectedHosts.has(hostname) || typeof token !== 'string' || !token || token.length > 2048) throw new GuestbookError(403, 'verification');
  let verified;
  try {
    const result = await verifyFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(request.headers.get('CF-Connecting-IP') ? { remoteip: request.headers.get('CF-Connecting-IP')! } : {}) }),
    });
    if (!result.ok) throw new Error('Verification unavailable');
    verified = await result.json() as { success?: boolean; action?: string; hostname?: string };
  } catch { throw new GuestbookError(403, 'verification'); }
  if (verified?.success !== true || verified.action !== 'guestbook' || verified.hostname !== hostname || !expectedHosts.has(verified.hostname)) throw new GuestbookError(403, 'verification');
  await env.GUESTBOOK_DB.prepare('INSERT INTO guestbook_messages (nickname, message) VALUES (?, ?)').bind(nickname, message).run();
}
export async function moderate(request: Request, env: GuestbookEnvironment): Promise<void> {
  // Authentication is checked by the protected route and middleware; enforce origin here too.
  if (!sameOrigin(request)) throw new GuestbookError(403, 'origin');
  if (!env.GUESTBOOK_DB) throw new GuestbookError(503, 'unavailable');
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new GuestbookError(415, 'invalid');
  const form = new URLSearchParams(await boundedText(request));
  if (['id', 'action'].some(key => form.getAll(key).length !== 1)) throw new GuestbookError(400, 'invalid');
  const id = cursorValue(form.get('id'));
  if (!form.has('id')) throw new GuestbookError(400, 'invalid');
  const action = form.get('action');
  let statement: D1PreparedStatement;
  if (action === 'publish' || action === 'hide') {
    statement = env.GUESTBOOK_DB.prepare('UPDATE guestbook_messages SET status = ?, moderated_at = unixepoch() WHERE id = ?').bind(action === 'publish' ? 'published' : 'pending', id);
  } else if (action === 'reply') {
    if (form.getAll('reply').length !== 1) throw new GuestbookError(400, 'invalid');
    const raw = form.get('reply') || '';
    const reply = raw.trim() ? cleanText(raw, 2000, true) : '';
    // Replying never implicitly publishes a pending message.
    statement = env.GUESTBOOK_DB.prepare("UPDATE guestbook_messages SET reply = ?, replied_at = CASE WHEN ? = '' THEN NULL ELSE unixepoch() END WHERE id = ?").bind(reply, reply, id);
  } else if (action === 'delete') {
    statement = env.GUESTBOOK_DB.prepare('DELETE FROM guestbook_messages WHERE id = ?').bind(id);
  } else throw new GuestbookError(400, 'invalid');
  const result = await statement.run();
  if (!result.meta.changes) throw new GuestbookError(404, 'missing');
}
