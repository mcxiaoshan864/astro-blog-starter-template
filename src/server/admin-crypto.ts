// Shared primitives. This module never reads runtime secrets.
export const PASSWORD_ITERATIONS = 100_000; // Workerd's PBKDF2 ceiling.
export const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
export const utf8 = (value: string) => encoder.encode(value);
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error("Non-canonical encoding");
  return bytes;
}
export function randomToken(size = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}
export async function passwordDigest(password: string, salt: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: decode64(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  return new Uint8Array(bits);
}
export interface AuthConfig {
  version: 1;
  salt: string;
  digest: string;
  sessionKey: string;
}
export async function createAuthConfig(password: string): Promise<AuthConfig> {
  if ([...password].length < 16 || utf8(password).length > 256) throw new Error("密码需至少 16 个字符，且不能超过 256 字节。");
  const salt = randomToken(16);
  return { version: 1, salt, digest: base64url(await passwordDigest(password, salt)), sessionKey: randomToken() };
}
