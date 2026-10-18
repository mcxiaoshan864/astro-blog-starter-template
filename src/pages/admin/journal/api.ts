import type { APIRoute } from 'astro';
import { JournalError, mutateEntry, readJournalJSON } from '../../../server/journal';
import { json } from '../../../server/guestbook';
export const prerender = false;
export const POST: APIRoute = async ({locals,request}) => {
  if (!locals.adminSession) return json({message:'登录已失效，请重新登录。'},401);
  try { const entry = await mutateEntry(locals.runtime.env, await readJournalJSON(request)); return json({entry}); }
  catch(error) { return error instanceof JournalError ? json({code:error.code,message:error.message},error.status) : json({message:'暂时无法保存，草稿仍保留在本页，请稍后重试。'},503); }
};
export const ALL: APIRoute = () => new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
