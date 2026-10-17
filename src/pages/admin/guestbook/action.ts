import type { APIRoute } from 'astro';
import { GuestbookError, moderate } from '../../../server/guestbook';
export const prerender = false;
export const POST: APIRoute = async ({ locals, request, redirect }) => {
  if (!locals.adminSession) return redirect('/admin/login/', 303);
  try {
    await moderate(request, locals.runtime.env);
    return redirect('/admin/guestbook/?saved=1', 303);
  } catch (error) {
    const code = error instanceof GuestbookError ? error.code : 'unavailable';
    return redirect(`/admin/guestbook/?error=${encodeURIComponent(code)}`, 303);
  }
};
export const ALL: APIRoute = () => new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
