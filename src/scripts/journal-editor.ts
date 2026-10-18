export {};
type Draft = {title:string;description:string;author:string;date:string;content:string};
type Entry = {id:string;slug:string;draft:string;revision:number;status:string;first_published_at:number|null};
class EditorError extends Error { constructor(message:string,public code=''){super(message);} }
const form=document.querySelector<HTMLFormElement>('[data-journal-editor]');
if(form)setup(form);
function setup(form:HTMLFormElement){
  const id=form.dataset.id!;
  let revision=Number(form.dataset.revision),state=form.dataset.status || 'draft';
  const fieldset=form.querySelector('fieldset')!;
  if(fieldset.disabled)return;
  const fields=Object.fromEntries(['title','description','author','date','content','slug'].map(key=>[key,form.elements.namedItem(key)])) as Record<string,HTMLInputElement|HTMLTextAreaElement>;
  const content=fields.content as HTMLTextAreaElement;
  const status=document.querySelector<HTMLElement>('[data-save-status]')!;
  const stateText=document.querySelector<HTMLElement>('[data-document-state]')!;
  const wordCount=document.querySelector<HTMLElement>('[data-word-count]')!;
  const recovery=document.querySelector<HTMLElement>('[data-recovery]')!;
  const importResult=form.querySelector<HTMLElement>('[data-import-result]')!;
  const publish=form.querySelector<HTMLButtonElement>('[data-publish]')!;
  const unpublish=form.querySelector<HTMLButtonElement>('[data-unpublish]')!;
  const fileInput=form.querySelector<HTMLInputElement>('[data-document-file]')!;
  const imageInput=form.querySelector<HTMLInputElement>('[data-image-file]')!;
  const storageKey=`mcxiaoshan-journal-draft:${id}`;
  const read=()=>({slug:fields.slug.value,draft:Object.fromEntries(['title','description','author','date','content'].map(key=>[key,fields[key].value])) as Draft});
  const fingerprint=(value:ReturnType<typeof read>)=>JSON.stringify(value);
  let saved=fingerprint(read());
  let timer:ReturnType<typeof setTimeout>|undefined,saving:Promise<void>|undefined,busy=false,conflicted=false,navigating=false;
  const dirty=()=>fingerprint(read())!==saved;
  const tell=(message:string,error=false)=>{status.textContent=message;status.style.color=error?'var(--accent)':'';};
  const localSave=()=>{try{localStorage.setItem(storageKey,JSON.stringify({value:read(),updatedAt:Date.now()}));}catch{}};
  const localClear=()=>{try{localStorage.removeItem(storageKey);}catch{}};
  const counter=()=>{wordCount.textContent=`${[...content.value].length.toLocaleString()} 字`;};
  const syncState=(entry:Entry)=>{
    revision=entry.revision;state=entry.status;form.dataset.revision=String(revision);
    stateText.textContent=state==='published'?'已发布 · 修改会先保存为草稿':'私密草稿';
    publish.textContent=state==='published'?'发布更新':'发布文章';unpublish.hidden=state!=='published';
    if(entry.first_published_at)fields.slug.readOnly=true;
  };
  const request=async<T>(path:string,body:Record<string,unknown>|FormData):Promise<T>=>{
    let response:Response;
    try{response=await fetch(path,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});}
    catch{throw new EditorError('网络暂时不可用，内容已保留在本页和本机草稿中。');}
    if(response.redirected || !response.headers.get('content-type')?.includes('application/json'))throw new EditorError('登录可能已失效，请先导出草稿，再重新登录。','auth');
    const result=await response.json() as T & {message?:string;code?:string};
    if(!response.ok)throw new EditorError(result.message || '操作未完成，请稍后重试。',result.code || '');
    return result;
  };
  const flush=async():Promise<void>=>{
    if(timer)clearTimeout(timer);
    if(conflicted)throw new EditorError('文章已在其他页面更新。请先导出草稿，再刷新核对。','conflict');
    if(saving){await saving;if(dirty())return flush();return;}
    if(!dirty()&&revision>0)return;
    if(!form.reportValidity())throw new EditorError('请检查日期和文章地址。');
    const snapshot=read();localSave();tell('正在保存草稿…');
    saving=(async()=>{
      try{
        const result=await request<{entry:Entry}>('/admin/journal/api',{id,revision,operation:'save',...snapshot});
        syncState(result.entry);saved=fingerprint(snapshot);
        if(!dirty())localClear();
        tell('草稿已保存 · '+new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()));
      }catch(error){
        if(error instanceof EditorError && error.code==='conflict')conflicted=true;
        tell(error instanceof Error?error.message:'保存失败，内容仍保留在本页。',true);throw error;
      }
    })();
    try{await saving;}finally{saving=undefined;}
    if(dirty())return flush();
  };
  const changed=()=>{
    counter();localSave();
    if(timer)clearTimeout(timer);
    if(!busy&&!conflicted){tell('有未保存的修改…');timer=setTimeout(()=>{void flush().catch(()=>{});},1400);}
  };
  form.addEventListener('input',event=>{if((event.target as Element)?.matches('input[name],textarea[name]'))changed();});
  form.addEventListener('submit',event=>event.preventDefault());
  const act=async(operation:string)=>{
    if(busy)return;
    if(!form.reportValidity())return;
    if(operation==='publish'&&(!fields.title.value.trim()||!content.value.trim())){tell('发布前请填写标题和正文。',true);return;}
    if(operation==='trash'&&!window.confirm('把这篇文章移入回收站？公开文章将下线，之后可以恢复为草稿。'))return;
    if(operation==='unpublish'&&!window.confirm('撤回后访客将无法访问这篇文章。内容会保留为草稿，确认撤回吗？'))return;
    busy=true;fieldset.disabled=true;
    try{
      await flush();
      if(operation==='save'){tell('草稿已保存。');return;}
      if(operation==='preview'){navigating=true;window.location.assign(`/admin/journal/preview/${id}/`);return;}
      tell(operation==='publish'?'正在发布…':'正在处理…');
      const result=await request<{entry:Entry}>('/admin/journal/api',{id,revision,operation});syncState(result.entry);
      if(operation==='publish'){
        const canonical=JSON.parse(result.entry.draft) as Draft;
        for(const key of Object.keys(canonical))fields[key].value=canonical[key as keyof Draft];
        saved=fingerprint(read());localClear();counter();tell('已发布，访客现在可以在日志页看到这一版。');
      }else if(operation==='unpublish'){tell('已撤回，文章保留为私密草稿。');}
      else if(operation==='trash'){localClear();navigating=true;window.location.assign('/admin/journal/?filter=trash');}
    }catch(error){tell(error instanceof Error?error.message:'操作未完成，请稍后重试。',true);}
    finally{busy=false;fieldset.disabled=false;}
  };
  for(const key of ['save','preview','publish','unpublish','trash'])form.querySelector(`[data-${key}]`)?.addEventListener('click',()=>{void act(key);});
  function insert(before:string,after='',placeholder='文字'){
    const start=content.selectionStart,end=content.selectionEnd;
    const selected=content.value.slice(start,end)||placeholder;
    content.setRangeText(before+selected+after,start,end,'select');content.focus();changed();
  }
  form.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button=>button.addEventListener('click',()=>{
    switch(button.dataset.format){case'bold':insert('**','**');break;case'italic':insert('*','*');break;case'heading':insert('\n## ','\n','小标题');break;case'list':insert('\n- ','\n','列表项目');break;case'quote':insert('\n> ','\n','引用的文字');break;case'link':insert('[','](https://example.com)','链接文字');break;case'code':insert('\n```\n','\n```\n','代码');break;}
  }));
  form.querySelector('[data-import]')?.addEventListener('click',()=>fileInput.click());
  form.querySelector('[data-image]')?.addEventListener('click',()=>imageInput.click());
  const compress=async(file:File):Promise<File>=>{
    if(file.size<=750000||file.type==='image/gif')return file;
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context){bitmap.close();return file;}
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    let blob:Blob|null=null;
    for(const quality of [.82,.65,.45]){blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob&&blob.size<=750000)break;}
    return blob?new File([blob],file.name+'.webp',{type:blob.type}):file;
  };
  const upload=async(file:File,image:boolean)=>{
    if(busy)return;
    if(!image&&content.value.trim()&&!window.confirm('导入文件会替换当前正文。建议先导出当前草稿，确认继续导入吗？'))return;
    busy=true;fieldset.disabled=true;localSave();
    try{
      await flush();tell(image?'正在处理图片…':'正在转换文件…');
      const data=new FormData();data.set('id',id);data.set('file',image?await compress(file):file);
      const result=await request<{url:string;content:string;title:string;warnings:string[]}>('/admin/journal/import'+(image?'?type=image':''),data);
      if(image){insert(`\n![图片](${result.url})\n`,'','');}
      else{
        content.value=result.content;if(!fields.title.value.trim())fields.title.value=result.title;
        importResult.hidden=false;importResult.textContent=['已导入 '+file.name+'，请预览后再发布。',...(result.warnings||[])].join(' ');changed();
      }
      await flush();tell(image?'图片已插入，草稿已保存。':'导入完成，草稿已保存。');
    }catch(error){tell(error instanceof Error?error.message:'导入失败，原草稿仍在。',true);}
    finally{busy=false;fieldset.disabled=false;fileInput.value='';imageInput.value='';}
  };
  fileInput.addEventListener('change',()=>{if(fileInput.files?.[0])void upload(fileInput.files[0],false);});
  imageInput.addEventListener('change',()=>{if(imageInput.files?.[0])void upload(imageInput.files[0],true);});
  form.querySelector('[data-export]')?.addEventListener('click',()=>{
    const {draft}=read();
    const metadata=['---',`title: ${JSON.stringify(draft.title)}`,`description: ${JSON.stringify(draft.description)}`,`author: ${JSON.stringify(draft.author)}`,`pubDate: ${JSON.stringify(draft.date)}`,'---',''];
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([metadata.join('\n')+'\n'+draft.content],{type:'text/markdown;charset=utf-8'}));
    link.href=url;link.download=(draft.title||'未命名草稿').replace(/[\\/:*?"<>|]/g,'-')+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  try{
    const local=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(local?.value?.draft&&fingerprint(local.value)!==fingerprint(read())){
      recovery.hidden=false;
      recovery.querySelector('[data-restore-local]')?.addEventListener('click',()=>{
        const value=local.value;
        for(const key of ['title','description','author','date','content'])if(typeof value.draft[key]==='string')fields[key].value=value.draft[key];
        if(!fields.slug.readOnly&&typeof value.slug==='string')fields.slug.value=value.slug;
        recovery.hidden=true;changed();
      });
      recovery.querySelector('[data-discard-local]')?.addEventListener('click',()=>{localClear();recovery.hidden=true;});
    }
  }catch{}
  window.addEventListener('beforeunload',event=>{if(!navigating&&dirty()){localSave();event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{if(dirty())localSave();});
  counter();
}
