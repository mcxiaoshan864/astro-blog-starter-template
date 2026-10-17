import type { APIRoute } from 'astro';
import { GuestbookError, json, publicMessages, submitMessage } from '../../server/guestbook';
export const prerender = false;
const failure = (error: unknown) => error instanceof GuestbookError ? json({ error: error.code }, error.status) : json({ error: 'unavailable' }, 503);
export const GET: APIRoute = async ({ locals, url }) => {
  try { return json(await publicMessages(locals.runtime.env, url.searchParams.get('cursor'))); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ locals, request }) => {
  try { await submitMessage(request, locals.runtime.env); return json({ ok: true }, 202); }
  catch (error) { return failure(error); }
};
export const ALL: APIRoute = () => new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
