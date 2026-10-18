import type { APIRoute } from 'astro';
import { sameOrigin } from '../../../server/admin-auth';
import { JournalError, getEntry, storeImage } from '../../../server/journal';
import { importDocument, uploadedFile } from '../../../server/journal-import';
import { json } from '../../../server/guestbook';
export const prerender = false;
export const POST: APIRoute = async ({locals,request,url}) => {
  if (!locals.adminSession) return json({message:'登录已失效，请重新登录。'},401);
  if (!sameOrigin(request)) return json({message:'请求来源无效。'},403);
  try {
    const {file,entryId} = await uploadedFile(request);
    const entry = await getEntry(locals.runtime.env,entryId);
    if (!entry || entry.status==='trash') throw new JournalError(404,'missing','请先保存草稿，再导入文件。');
    if (url.searchParams.get('type') === 'image') {
      return json({url:await storeImage(locals.runtime.env,entryId,new Uint8Array(await file.arrayBuffer()))});
    }
    return json(await importDocument(locals.runtime.env,entryId,file));
  } catch(error) { return error instanceof JournalError ? json({code:error.code,message:error.message},error.status) : json({message:'导入服务暂时不可用，原草稿未被替换。'},503); }
};
export const ALL: APIRoute = () => new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
