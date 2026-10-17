import type { APIRoute } from "astro";
import { sameOrigin, SESSION_COOKIE, sessionCookieOptions } from "../../server/admin-auth";
export const prerender = false;
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!sameOrigin(request)) return new Response("请求来源无效。", { status: 403 });
  cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0, expires: new Date(0) });
  return redirect("/admin/login/?loggedout=1", 303);
};
export const GET: APIRoute = () => new Response("请使用退出登录按钮。", { status: 405, headers: { Allow: "POST" } });
