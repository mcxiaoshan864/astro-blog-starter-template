import type { APIRoute } from 'astro';
import { boundedText } from '../../../server/guestbook';
import { mutateEntry } from '../../../server/journal';
import { purgeTrashEntries } from '../../../server/journal-trash';
import { sameOrigin } from '../../../server/admin-auth';
export const prerender=false;
export const POST:APIRoute=async({locals,request,redirect})=>{
  if(!locals.adminSession)return redirect('/admin/login/',303);
  let deleting=false;
  try {
    if(!sameOrigin(request))throw new Error();
    const form=new URLSearchParams(await boundedText(request,2000000));
    deleting=form.get('operation')==='purge';
    if(deleting){
      if(form.getAll('operation').length!==1||form.getAll('targets').length!==1)throw new Error();
      const result=await purgeTrashEntries(locals.runtime.env,JSON.parse(form.get('targets')||'null'));
      return redirect(`/admin/journal/?filter=trash&deleted=${result.deleted}&changed=${result.changed}`,303);
    }
    if(['id','revision','operation'].some(key=>form.getAll(key).length!==1) || !['restore','trash','unpublish'].includes(form.get('operation')||''))throw new Error();
    await mutateEntry(locals.runtime.env,{id:form.get('id'),revision:Number(form.get('revision')),operation:form.get('operation')});
    return redirect('/admin/journal/?saved=1',303);
  } catch { return redirect('/admin/journal/?'+(deleting?'filter=trash&':'')+'error=1',303); }
};
export const ALL:APIRoute=()=>new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
