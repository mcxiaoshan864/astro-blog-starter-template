import type { APIRoute } from 'astro';
import { boundedText } from '../../../server/guestbook';
import { mutateEntry } from '../../../server/journal';
export const prerender=false;
export const POST:APIRoute=async({locals,request,redirect})=>{
  if(!locals.adminSession)return redirect('/admin/login/',303);
  try {
    const form=new URLSearchParams(await boundedText(request,4096));
    if(['id','revision','operation'].some(key=>form.getAll(key).length!==1) || !['restore','trash','unpublish'].includes(form.get('operation')||''))throw new Error();
    await mutateEntry(locals.runtime.env,{id:form.get('id'),revision:Number(form.get('revision')),operation:form.get('operation')});
    return redirect('/admin/journal/?saved=1',303);
  } catch { return redirect('/admin/journal/?error=1',303); }
};
export const ALL:APIRoute=()=>new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
