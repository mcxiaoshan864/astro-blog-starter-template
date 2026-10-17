import { defineMiddleware } from "astro:middleware";
import { readAuthConfig, sameOrigin, SESSION_COOKIE, verifySession } from "./server/admin-auth";
import { randomToken } from "./server/admin-crypto";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/admin" && !path.startsWith("/admin/")) return next();
  const nonce = randomToken(18);
  context.locals.adminNonce = nonce;
  const env = context.locals.runtime?.env || {};
  const config = readAuthConfig(env);
  context.locals.adminConfigured = !!config;
  context.locals.adminSession = await verifySession(context.cookies.get(SESSION_COOKIE)?.value, config, context.url.origin);
  let response: Response;
  if (!["GET", "HEAD", "POST"].includes(context.request.method)) {
    response = new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  } else if (context.request.method === "POST" && !sameOrigin(context.request)) {
    response = new Response("请求来源无效，请返回网站后重试。", { status: 403 });
  } else if (!context.locals.adminSession && !["/admin/login", "/admin/setup", "/admin/logout"].includes(path)) {
    response = context.redirect("/admin/login/", 303);
  } else if (context.locals.adminSession && ["/admin/login", "/admin/setup"].includes(path)) {
    response = context.redirect("/admin/", 303);
  } else {
    response = await next();
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`);
  return response;
});
