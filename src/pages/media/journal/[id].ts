import type { APIRoute } from 'astro';
import { database, validId } from '../../../server/journal';
import { readAuthConfig, SESSION_COOKIE, verifySession } from '../../../server/admin-auth';
export const prerender = false;
export const GET: APIRoute = async ({params,locals,cookies,url}) => {
  if (!params.id || !validId(params.id)) return new Response('Not found',{status:404});
  try {
    const row = await database(locals.runtime.env).prepare('SELECT a.mime,a.bytes,e.status,e.published FROM journal_assets a JOIN journal_entries e ON e.id = a.entry_id WHERE a.id = ?').bind(params.id).first<{mime:string;bytes:ArrayBuffer|number[];status:string;published:string|null}>();
    if (!row) return new Response('Not found',{status:404});
    const publicImage = row.status==='published' && row.published?.includes(`/media/journal/${params.id}`);
    if (!publicImage && !await verifySession(cookies.get(SESSION_COOKIE)?.value,readAuthConfig(locals.runtime.env),url.origin)) return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
    const bytes=Array.isArray(row.bytes)?new Uint8Array(row.bytes):row.bytes;
    return new Response(bytes,{headers:{'Content-Type':row.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  } catch { return new Response('Unavailable',{status:503,headers:{'Cache-Control':'no-store'}}); }
};
export const ALL: APIRoute = () => new Response('Method not allowed',{status:405,headers:{Allow:'GET'}});
