import { base64url, decode64, passwordDigest, randomToken, SESSION_SECONDS, utf8, type AuthConfig } from "./admin-crypto";
export { SESSION_SECONDS } from "./admin-crypto";
export const SESSION_COOKIE = "__Host-admin_session";
export interface AuthEnvironment {
  ADMIN_AUTH?: string;
  ADMIN_LOGIN_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
export interface AdminSession {
  v: 1;
  sub: "admin";
  iss: string;
  iat: number;
  exp: number;
  jti: string;
}
export function readAuthConfig(env: AuthEnvironment): AuthConfig | null {
  try {
    if (!env.ADMIN_AUTH || env.ADMIN_AUTH.length > 1024) return null;
    const c = JSON.parse(env.ADMIN_AUTH);
    if (c.version !== 1 || typeof c.salt !== "string" || typeof c.digest !== "string" || typeof c.sessionKey !== "string") return null;
    if (decode64(c.salt).length !== 16 || decode64(c.digest).length !== 32 || decode64(c.sessionKey).length !== 32) return null;
    return { version: 1, salt: c.salt, digest: c.digest, sessionKey: c.sessionKey };
  } catch { return null; }
}
async function signingKey(config: AuthConfig): Promise<CryptoKey> {
  // Including the password record invalidates sessions when either secret changes.
  return crypto.subtle.importKey("raw", utf8(`${config.sessionKey}.${config.salt}.${config.digest}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function verifyPassword(password: string, config: AuthConfig): Promise<boolean> {
  const actual = await passwordDigest(password, config.salt);
  const expected = decode64(config.digest);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
export async function createSession(config: AuthConfig, origin: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const claims: AdminSession = { v: 1, sub: "admin", iss: origin, iat: now, exp: now + SESSION_SECONDS, jti: randomToken(16) };
  const payload = base64url(utf8(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(config), utf8(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}
export async function verifySession(token: string | undefined, config: AuthConfig | null, origin: string, now = Math.floor(Date.now() / 1000)): Promise<AdminSession | null> {
  try {
    if (!config || !token || token.length > 1024) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || decode64(parts[1]).length !== 32) return null;
    if (!await crypto.subtle.verify("HMAC", await signingKey(config), decode64(parts[1]), utf8(parts[0]))) return null;
    const c = JSON.parse(new TextDecoder().decode(decode64(parts[0])));
    if (c.v !== 1 || c.sub !== "admin" || c.iss !== origin || !Number.isInteger(c.iat) || !Number.isInteger(c.exp)) return null;
    if (c.iat > now + 30 || c.exp <= now || c.exp - c.iat !== SESSION_SECONDS || typeof c.jti !== "string" || decode64(c.jti).length !== 16) return null;
    return c;
  } catch { return null; }
}
export function sameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" && request.headers.get("origin") === url.origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
export type LoginResult = { ok: true; token: string } | { ok: false; status: number; message: string };
async function readForm(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) throw new Error("Unsupported form");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing form");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 4096) { await reader.cancel(); throw new Error("Form too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export async function authenticate(request: Request, env: AuthEnvironment): Promise<LoginResult> {
  const fail = (status: number, message: string): LoginResult => ({ ok: false, status, message });
  if (!sameOrigin(request)) return fail(403, "请求来源无效，请刷新页面后重试。");
  const config = readAuthConfig(env);
  if (!config || !env.ADMIN_LOGIN_LIMITER) return fail(503, "管理员登录尚未启用，请先完成配置。");
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.ADMIN_LOGIN_LIMITER.limit({ key: `mcxiaoshan:admin-login:${ip}` });
    if (!success) return fail(429, "尝试次数较多，请等一分钟再试。");
  } catch { return fail(503, "登录服务暂时不可用，请稍后重试。"); }
  let form: URLSearchParams;
  try { form = await readForm(request); }
  catch { return fail(400, "无法读取登录信息，请重新输入。"); }
  const password = form.get("password");
  if (form.getAll("username").length !== 1 || form.getAll("password").length !== 1 || !password || utf8(password).length > 256) return fail(400, "请输入有效的账号和密码。");
  try {
    const valid = await verifyPassword(password, config);
    if (!valid || form.get("username") !== "admin") return fail(401, "账号或密码不正确。");
    return { ok: true, token: await createSession(config, new URL(request.url).origin) };
  } catch { return fail(503, "登录服务暂时不可用，请稍后重试。"); }
}
export const sessionCookieOptions = {
  path: "/", secure: true, httpOnly: true, sameSite: "strict" as const, maxAge: SESSION_SECONDS,
};
