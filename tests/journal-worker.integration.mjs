import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {zipSync,strToU8} from 'fflate';
import iconv from 'iconv-lite';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const config=JSON.parse(await readFile(new URL('../wrangler.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../dist/_worker.js/',import.meta.url)).replace(/\/$/,'');
async function modulesAt(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())result.push(...await modulesAt(path));else if(/\.(mjs|js)$/.test(path))result.push({type:'ESModule',path,contents:await readFile(path,'utf8')});}return result;}
const modules=await modulesAt(root);modules.sort((a,b)=>Number(b.path===root+'/index.js')-Number(a.path===root+'/index.js'));
const schema=await readFile(new URL('../migrations/0002_journal.sql',import.meta.url),'utf8');
const trashMigration=await readFile(new URL('../migrations/0004_journal_trash.sql',import.meta.url),'utf8');
const origin='https://journal.test';
const editorBundle=await build({stdin:{contents:"import './src/scripts/journal-editor.ts'; import {EditorView} from '@codemirror/view'; window.testEditorView=EditorView;",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'});
const editorCode=editorBundle.outputFiles[0].text;
const password='Disposable-journal-test-'+randomBytes(16).toString('hex');const salt=randomBytes(16);
const auth=JSON.stringify({version:1,salt:salt.toString('base64url'),digest:pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url'),sessionKey:randomBytes(32).toString('base64url')});
async function worker(beforeTrashMigration){
 const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,unsafeTriggerHandlers:true,log:new Log(LogLevel.ERROR),bindings:{ADMIN_AUTH:auth},d1Databases:['GUESTBOOK_DB'],ratelimits:{ADMIN_LOGIN_LIMITER:{simple:{limit:5,period:60}}},serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})}});
 const db=await mf.getD1Database('GUESTBOOK_DB');await db.batch(schema.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 if(beforeTrashMigration)await beforeTrashMigration(db);
 await db.batch(trashMigration.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 const login=await mf.dispatchFetch(origin+'/admin/login/',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'admin',password}),redirect:'manual'});assert.equal(login.status,303);
 return {mf,db,cookie:login.headers.get('set-cookie').split(';')[0]};
}
const draft=(extra={})=>({title:'一篇测试日志',description:'这是摘要',author:'mcxiaoshan',date:'2026-10-18',content:'## 你好\n\n这是正文。',...extra});
async function api(mf,cookie,body,headers={}){return mf.dispatchFetch(origin+'/admin/journal/api',{method:'POST',headers:{origin,'content-type':'application/json',cookie,...headers},body:JSON.stringify(body),redirect:'manual'});}
async function save(mf,cookie,id,revision=0,value=draft(),slug='test-'+id.slice(0,8)){
 const response=await api(mf,cookie,{id,revision,operation:'save',draft:value,slug});assert.equal(response.status,200,await response.clone().text());return (await response.json()).entry;
}
async function action(mf,cookie,entry,operation){const response=await api(mf,cookie,{id:entry.id,revision:entry.revision,operation});assert.equal(response.status,200,await response.clone().text());return(await response.json()).entry;}
async function upload(mf,cookie,id,name,bytes,image=false){const body=new FormData();body.set('id',id);body.set('file',new File([bytes],name));const path=origin+'/admin/journal/import'+(image?'?type=image':'');const wire=new Request(path,{method:'POST',body});return mf.dispatchFetch(path,{method:'POST',headers:{origin,cookie,'content-type':wire.headers.get('content-type')},body:Buffer.from(await wire.arrayBuffer()),redirect:'manual'});}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');
// Original 2x2 red/blue, two-frame animations generated with Pillow, 120 ms/frame.
const animations=[
 ['gif','image/gif','R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBDAABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7'],
 ['webp','image/webp','UklGRsQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAEAAAEAAHgAAAJWUDggMgAAADABAJ0BKgIAAgABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkYAAAAAAAAAAAABAAABAAB4AAAAVlA4IC4AAAA0AQCdASoCAAIAAAAmJaAAA3AA/vtV4///S4P/+lwf/9Lg/9Lg//rV5Vesq6AA'],
 ['png','image/png','iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAMAGQAAjPSSSQAAABRJREFUeJxj/M/A8J+BgYGBiQEKAB8XAgJPlM6+AAAAGmZjVEwAAAABAAAAAgAAAAIAAAAAAAAAAAADABkAABeHeJ0AAAAYZmRBVAAAAAJ4nGNkYPj/n4GBgYGJAQoAHRkCAunm7jEAAAAASUVORK5CYII='],
].map(([extension,mime,data])=>({extension,mime,bytes:Buffer.from(data,'base64')}));
function docx(){
 const types='<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
 const document='<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>导入的小标题</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗文字</w:t></w:r></w:p><w:p><w:r><w:t>中文正文和图片。</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
 return zipSync({'[Content_Types].xml':strToU8(types),'_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),'word/document.xml':strToU8(document),'word/styles.xml':strToU8('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>'),'word/_rels/document.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'),'word/media/image1.png':png});
}
test('draft/published versions stay separate, stale writes fail, and trash/restore preserve content',async()=>{
 const {mf,cookie}=await worker();try{
  let entry=await save(mf,cookie,randomUUID());const url=origin+'/blog/'+entry.slug+'/';
  assert.equal((await mf.dispatchFetch(url)).status,404);
  const unauthorized=await mf.dispatchFetch(origin+`/admin/journal/preview/${entry.id}/`,{redirect:'manual'});assert.equal(unauthorized.status,303);
  const preview=await mf.dispatchFetch(origin+`/admin/journal/preview/${entry.id}/`,{headers:{cookie}});assert.equal(preview.status,200);assert.match(preview.headers.get('cache-control'),/no-store/);assert.match(await preview.text(),/私密草稿预览/);
  entry=await action(mf,cookie,entry,'publish');let page=await mf.dispatchFetch(url);assert.equal(page.status,200);assert.match(await page.text(),/Oct 18, 2026/);
  const publicBefore=entry;entry=await save(mf,cookie,entry.id,entry.revision,draft({title:'尚未发布的新标题',content:'秘密草稿正文'}),entry.slug);
  const old=await(await mf.dispatchFetch(url)).text();assert.match(old,/一篇测试日志/);assert.doesNotMatch(old,/秘密草稿正文/);
  const stale=await api(mf,cookie,{id:entry.id,revision:publicBefore.revision,operation:'publish'});assert.equal(stale.status,409);
  entry=await action(mf,cookie,entry,'publish');assert.match(await(await mf.dispatchFetch(url)).text(),/秘密草稿正文/);
  const rename=await api(mf,cookie,{id:entry.id,revision:entry.revision,operation:'save',draft:draft(),slug:'renamed-link'});assert.equal(rename.status,400);
  entry=await action(mf,cookie,entry,'unpublish');assert.equal((await mf.dispatchFetch(url)).status,404);
  entry=await action(mf,cookie,entry,'trash');assert.equal(entry.status,'trash');entry=await action(mf,cookie,entry,'restore');assert.equal(entry.status,'draft');assert.match(JSON.parse(entry.draft).content,/秘密草稿/);assert.equal((await mf.dispatchFetch(url)).status,404);
 }finally{await mf.dispose();}
});
test('TXT imports UTF-8, UTF-16 and GB18030 Chinese and never overwrites the saved draft implicitly',async()=>{
 const {mf,db,cookie}=await worker();try{
  const entry=await save(mf,cookie,randomUUID());
  for(const bytes of [Buffer.from('你好，世界\n第二段。'),iconv.encode('你好，世界\n第二段。','gb18030'),Buffer.concat([Buffer.from([255,254]),iconv.encode('你好，世界\n第二段。','utf16-le')])]){
   const response=await upload(mf,cookie,entry.id,'中文日志.txt',bytes);assert.equal(response.status,200,await response.clone().text());const result=await response.json();assert.equal(result.title,'中文日志');assert.match(result.content,/你好，世界/);assert.match(result.content,/第二段/);
  }
  const stored=await db.prepare('SELECT draft FROM journal_entries WHERE id=?').bind(entry.id).first();assert.equal(stored.draft,entry.draft);
 }finally{await mf.dispose();}
});
test('real legacy DOC buffer imports Unicode body in the built Cloudflare Worker',async()=>{
 const {mf,cookie}=await worker();try{
  const entry=await save(mf,cookie,randomUUID());const bytes=Buffer.from(await readFile(new URL('./fixtures/legacy-word-doc.base64',import.meta.url),'utf8'),'base64');
  const response=await upload(mf,cookie,entry.id,'旧文档.doc',bytes);assert.equal(response.status,200,await response.clone().text());const result=await response.json();assert.match(result.content,/A second test of reviewing/);assert.match(result.content,/😀/);assert.ok(result.warnings.some(w=>w.includes('正文')));
 }finally{await mf.dispose();}
});
test('DOCX imports headings, bold and embedded image; media stays private until referenced by a published version',async()=>{
 const {mf,cookie}=await worker();try{
  let entry=await save(mf,cookie,randomUUID());const response=await upload(mf,cookie,entry.id,'新文档.docx',docx());assert.equal(response.status,200,await response.clone().text());const result=await response.json();assert.match(result.content,/# 导入的小标题/);assert.match(result.content,/\*\*加粗文字\*\*/);
  const image=result.content.match(/\/media\/journal\/[0-9a-f-]{36}/)?.[0];assert.ok(image,result.content);assert.equal((await mf.dispatchFetch(origin+image)).status,404);
  const privateImage=await mf.dispatchFetch(origin+image,{headers:{cookie}});assert.equal(privateImage.status,200);assert.deepEqual(Buffer.from(await privateImage.arrayBuffer()),png);
  entry=await save(mf,cookie,entry.id,entry.revision,draft({content:result.content}),entry.slug);entry=await action(mf,cookie,entry,'publish');const imageResponse=await mf.dispatchFetch(origin+image);assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()),png);
  entry=await action(mf,cookie,entry,'unpublish');assert.equal((await mf.dispatchFetch(origin+image)).status,404);
 }finally{await mf.dispose();}
});
test('invalid files, zip bombs, SVG uploads, cross-site writes and stored HTML attacks are rejected',async()=>{
 const {mf,cookie}=await worker();try{
  let entry=await save(mf,cookie,randomUUID());
  for(const [name,bytes,status] of [['fake.doc',Buffer.from('not a word file'),400],['fake.docx',Buffer.from('not a zip'),422],['unknown.pdf',Buffer.from('x'),415]]){const response=await upload(mf,cookie,entry.id,name,bytes);assert.equal(response.status,status,await response.clone().text());}
  const bomb=zipSync({'word/document.xml':strToU8(' '.repeat(13*1024*1024))});assert.equal((await upload(mf,cookie,entry.id,'bomb.docx',bomb)).status,422);
  assert.equal((await upload(mf,cookie,entry.id,'evil.svg',Buffer.from('<svg onload="alert(1)"/>'),true)).status,415);
  assert.equal((await api(mf,cookie,{id:entry.id,revision:entry.revision,operation:'trash'},{origin:'https://evil.test'})).status,403);
  const anon=await api(mf,'',{id:entry.id,revision:entry.revision,operation:'trash'});assert.equal(anon.status,303);
  entry=await save(mf,cookie,entry.id,entry.revision,draft({content:'<script>alert("stored")</script>\n\n[坏链接](javascript:alert%281%29)\n\n<img src="https://evil.test/x" onerror="alert(2)">\n\n**保留正文**'}),entry.slug);entry=await action(mf,cookie,entry,'publish');const html=await(await mf.dispatchFetch(origin+'/blog/'+entry.slug+'/')).text();assert.doesNotMatch(html,/<script>alert\("stored"\)/);assert.doesNotMatch(html,/href="javascript:/);assert.doesNotMatch(html,/src="https:\/\/evil.test/);assert.match(html,/<strong>保留正文<\/strong>/);
 }finally{await mf.dispose();}
});
test('existing Markdown article migrates once without changing its URL or replacing database edits',async()=>{
 const {mf,db,cookie}=await worker();try{
  const migration=await readFile(new URL('../migrations/0003_import_existing_journal.sql',import.meta.url),'utf8');await db.prepare(migration).run();
  const page=await mf.dispatchFetch(origin+'/blog/a-glass-website-with-codex/');assert.equal(page.status,200);assert.match(await page.text(),/给小站换一层玻璃/);
  const list=await mf.dispatchFetch(origin+'/blog/');assert.equal(list.status,200);assert.match(await list.text(),/a-glass-website-with-codex/);
  const row=await db.prepare('SELECT * FROM journal_entries').first();const edited=await save(mf,cookie,row.id,row.revision,draft({title:'本地编辑保留'}),row.slug);await db.prepare(migration).run();const again=await db.prepare('SELECT draft FROM journal_entries WHERE id=?').bind(row.id).first();assert.equal(again.draft,edited.draft);
 }finally{await mf.dispose();}
});

async function editor(mf,cookie,entry,beforeFetch){
 const response=await mf.dispatchFetch(origin+`/admin/journal/edit/${entry.id}/`,{headers:{cookie}});assert.equal(response.status,200);
 const dom=new JSDOM(await response.text(),{url:origin+`/admin/journal/edit/${entry.id}/`,runScripts:'outside-only',pretendToBeVisual:true});
 // JSDOM has no layout engine; provide the geometry methods used by CodeMirror.
 dom.window.Range.prototype.getClientRects=()=>[];
 dom.window.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
 dom.window.Blob.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>{const reader=new dom.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(this);});};
 const close=dom.window.close.bind(dom.window);
 dom.window.close=()=>{const root=dom.window.document.querySelector('.cm-editor');if(root&&dom.window.testEditorView)dom.window.testEditorView.findFromDOM(root)?.destroy();close();};
 const calls=[];
 dom.window.fetch=async(path,options)=>{
  if(options.body instanceof dom.window.FormData){
   const data=new FormData();
   for(const [key,value] of options.body.entries()){
    if(typeof value==='string')data.set(key,value);
    else {const bytes=await new Promise((resolve,reject)=>{const reader=new dom.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(value);});data.set(key,new File([bytes],value.name,{type:value.type}));}
   }
   const wire=new Request(origin+path,{method:'POST',body:data});
   return mf.dispatchFetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':wire.headers.get('content-type')},body:Buffer.from(await wire.arrayBuffer()),redirect:'manual'});
  }
  const payload=JSON.parse(options.body);calls.push(payload);if(beforeFetch)await beforeFetch(payload,calls.length);return mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,origin,cookie},redirect:'manual'});
 };
 return {dom,calls,start:()=>dom.window.eval(editorCode)};
}
function change(dom,selector,value){const field=dom.window.document.querySelector(selector);field.value=value;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
function until(dom,predicate){
 if(predicate())return Promise.resolve();
 return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{observer.disconnect();reject(new Error('Editor state did not settle: '+dom.window.document.querySelector('[data-save-status]').textContent));},7000);const observer=new dom.window.MutationObserver(()=>{if(predicate()){clearTimeout(timeout);observer.disconnect();resolve();}});observer.observe(dom.window.document.body,{childList:true,subtree:true,characterData:true,attributes:true});});
}
test('editor autosave queues new typing during an in-flight save and does not change the published article',async()=>{
 const {mf,db,cookie}=await worker();let ui;try{
  let entry=await save(mf,cookie,randomUUID());entry=await action(mf,cookie,entry,'publish');
  let release,started;const gate=new Promise(resolve=>release=resolve),first=new Promise(resolve=>started=resolve);
  ui=await editor(mf,cookie,entry,async(_body,index)=>{if(index===1){started();await gate;}});ui.start();
  change(ui.dom,'[name=content]','第一轮输入');await first;change(ui.dom,'[name=content]','保存期间继续输入的新内容');release();
  await until(ui.dom,()=>ui.calls.length===2&&ui.dom.window.document.querySelector('[data-save-status]').textContent.includes('草稿已保存'));
  const stored=await db.prepare('SELECT * FROM journal_entries WHERE id=?').bind(entry.id).first();assert.equal(JSON.parse(stored.draft).content,'保存期间继续输入的新内容');assert.equal(JSON.parse(stored.published).content,JSON.parse(entry.published).content);assert.equal(ui.calls[1].revision,ui.calls[0].revision+1);assert.equal(ui.dom.window.localStorage.getItem('mcxiaoshan-journal-draft:'+entry.id),null);
 }finally{ui?.dom.window.close();await mf.dispose();}
});
test('editor offers local recovery, saves the recovered draft and retains local content on revision conflict',async()=>{
 const {mf,cookie}=await worker();let ui,conflict;try{
  let entry=await save(mf,cookie,randomUUID());ui=await editor(mf,cookie,entry);
  ui.dom.window.localStorage.setItem('mcxiaoshan-journal-draft:'+entry.id,JSON.stringify({value:{slug:entry.slug,draft:draft({title:'本机恢复稿',content:'尚未同步的正文'})},updatedAt:Date.now()}));ui.start();
  assert.equal(ui.dom.window.document.querySelector('[data-recovery]').hidden,false);ui.dom.window.document.querySelector('[data-restore-local]').click();assert.equal(ui.dom.window.document.querySelector('[name=title]').value,'本机恢复稿');ui.dom.window.document.querySelector('[data-save]').click();
  await until(ui.dom,()=>ui.dom.window.document.querySelector('[data-save-status]').textContent.includes('草稿已保存'));
  entry=(await(await api(mf,cookie,{id:entry.id,revision:entry.revision+1,operation:'save',draft:draft({content:'另一个页面的新版本'}),slug:entry.slug})).json()).entry;
  conflict=await editor(mf,cookie,{...entry,revision:entry.revision});conflict.start();
  // Advance the server after the editor loads, reproducing a second open tab.
  await save(mf,cookie,entry.id,entry.revision,draft({content:'服务器再次更新'}),entry.slug);
  change(conflict.dom,'[name=content]','当前页面不能丢失的修改');conflict.dom.window.document.querySelector('[data-save]').click();
  await until(conflict.dom,()=>conflict.dom.window.document.querySelector('[data-save-status]').textContent.includes('其他页面更新'));
  const local=JSON.parse(conflict.dom.window.localStorage.getItem('mcxiaoshan-journal-draft:'+entry.id));assert.equal(local.value.draft.content,'当前页面不能丢失的修改');assert.equal(conflict.calls.length,1);
 }finally{ui?.dom.window.close();conflict?.dom.window.close();await mf.dispose();}
});

test('inline editor shows real images, keeps code/external URLs as text, and switching modes preserves content and undo',async()=>{
 const {mf,db,cookie}=await worker();let ui;try{
  const image='/media/journal/'+randomUUID();
  const body=`前文\n\n![正文图片](${image})\n\n后文\n\n\`![行内代码](${image})\`\n\n\`\`\`\n![代码块](${image})\n\`\`\`\n\n![外站](https://evil.test/image.png)\n\n<img src="${image}" onerror="alert(1)">`;
  const entry=await save(mf,cookie,randomUUID(),0,draft({content:body}));ui=await editor(mf,cookie,entry);ui.start();
  const document=ui.dom.window.document,host=document.querySelector('[data-image-editor]'),textarea=document.querySelector('[name=content]');
  assert.equal(textarea.hidden,true);assert.equal(host.hidden,false);assert.equal(host.querySelectorAll('img').length,1);assert.equal(host.querySelector('img').getAttribute('src'),image);assert.equal(host.querySelector('img').hasAttribute('onerror'),false);
  const view=ui.dom.window.testEditorView.findFromDOM(host.querySelector('.cm-editor'));assert.ok(view);
  document.querySelector('[data-editor-mode=markdown]').click();assert.equal(host.querySelector('img'),null);assert.equal(textarea.value,body);assert.equal(ui.calls.length,0);
  document.querySelector('[data-editor-mode=images]').click();assert.equal(host.querySelectorAll('img').length,1);assert.equal(textarea.value,body);
  const from=body.indexOf('后文');view.dispatch({selection:{anchor:from,head:from+2}});document.querySelector('[data-format=bold]').click();assert.match(textarea.value,/\*\*后文\*\*/);
  view.contentDOM.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));assert.equal(textarea.value,body);
  view.dispatch({changes:{from:view.state.doc.length,insert:'\n\n新的文字'},userEvent:'input'});document.querySelector('[data-save]').click();
  assert.equal(view.contentDOM.getAttribute('contenteditable'),'false');
  await until(ui.dom,()=>document.querySelector('[data-save-status]').textContent.includes('草稿已保存')&&!document.querySelector('fieldset').disabled);
  assert.equal(view.contentDOM.getAttribute('contenteditable'),'true');
  const stored=await db.prepare('SELECT draft FROM journal_entries WHERE id=?').bind(entry.id).first();assert.equal(JSON.parse(stored.draft).content,body+'\n\n新的文字');assert.equal(host.querySelectorAll('img').length,1);
  host.querySelector('img').dispatchEvent(new ui.dom.window.Event('error'));assert.match(host.querySelector('figcaption').textContent,/暂时无法显示/);assert.equal(textarea.value,body+'\n\n新的文字');
 }finally{ui?.dom.window.close();await mf.dispose();}
});

test('image upload, DOCX import and local recovery immediately update pictures in the writing area',async()=>{
 const {mf,db,cookie}=await worker();let ui,recovered;try{
  const entry=await save(mf,cookie,randomUUID());ui=await editor(mf,cookie,entry);ui.start();
  const document=ui.dom.window.document,host=document.querySelector('[data-image-editor]');
  const view=ui.dom.window.testEditorView.findFromDOM(host.querySelector('.cm-editor'));assert.ok(view);
  view.dispatch({selection:{anchor:view.state.doc.length}});
  const imageInput=document.querySelector('[data-image-file]');Object.defineProperty(imageInput,'files',{value:[new ui.dom.window.File([png],'正文图.png',{type:'image/png'})]});imageInput.dispatchEvent(new ui.dom.window.Event('change'));
  await until(ui.dom,()=>document.querySelector('[data-save-status]').textContent.includes('图片已插入'));
  assert.equal(host.querySelectorAll('img').length,1);assert.match(document.querySelector('[name=content]').value,/这是正文。\n!\[图片\]/);
  ui.dom.window.confirm=()=>true;const fileInput=document.querySelector('[data-document-file]');Object.defineProperty(fileInput,'files',{value:[new ui.dom.window.File([docx()],'带图.docx')]});fileInput.dispatchEvent(new ui.dom.window.Event('change'));
  await until(ui.dom,()=>document.querySelector('[data-save-status]').textContent.includes('导入完成'));
  assert.equal(host.querySelectorAll('img').length,1);assert.match(document.querySelector('[name=content]').value,/# 导入的小标题/);
  const stored=await db.prepare('SELECT * FROM journal_entries WHERE id=?').bind(entry.id).first();const savedBody=JSON.parse(stored.draft).content;assert.equal(document.querySelector('[name=content]').value,savedBody);
  recovered=await editor(mf,cookie,stored);recovered.dom.window.localStorage.setItem('mcxiaoshan-journal-draft:'+entry.id,JSON.stringify({value:{slug:entry.slug,draft:draft({content:savedBody+'\n\n恢复的文字'})}}));recovered.start();recovered.dom.window.document.querySelector('[data-restore-local]').click();assert.equal(recovered.dom.window.document.querySelectorAll('[data-image-editor] img').length,1);assert.match(recovered.dom.window.document.querySelector('[name=content]').value,/恢复的文字/);
 }finally{ui?.dom.window.close();recovered?.dom.window.close();await mf.dispose();}
});

test('GIF, animated WebP and APNG keep every original byte from editor upload to public media, even with an incorrect MIME type',async()=>{
 const {mf,db,cookie}=await worker();let ui;try{
  const entry=await save(mf,cookie,randomUUID());ui=await editor(mf,cookie,entry);ui.start();
  const document=ui.dom.window.document,host=document.querySelector('[data-image-editor]'),input=document.querySelector('[data-image-file]');
  ui.dom.window.createImageBitmap=()=>{throw new Error('Animation must never enter static Canvas compression');};
  const uploaded=[];
  for(const [index,animation] of animations.entries()){
   const view=ui.dom.window.testEditorView.findFromDOM(host.querySelector('.cm-editor'));view.dispatch({selection:{anchor:view.state.doc.length}});
   Object.defineProperty(input,'files',{configurable:true,value:[new ui.dom.window.File([animation.bytes],'动图.'+animation.extension,{type:index===0?'image/png':''})]});input.dispatchEvent(new ui.dom.window.Event('change'));
   await until(ui.dom,()=>host.querySelectorAll('img').length===index+1&&!document.querySelector('fieldset').disabled);
   const path=host.querySelectorAll('img')[index].getAttribute('src');const response=await mf.dispatchFetch(origin+path,{headers:{cookie}});
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),animation.mime);assert.deepEqual(Buffer.from(await response.arrayBuffer()),animation.bytes);uploaded.push({path,...animation});
  }
  const firstImage=host.querySelector('img'),view=ui.dom.window.testEditorView.findFromDOM(host.querySelector('.cm-editor'));
  view.dispatch({changes:{from:view.state.doc.length,insert:'\n继续写作'}});assert.equal(host.querySelector('img'),firstImage,'typing must reuse the image DOM instead of restarting animation');
  document.querySelector('[data-save]').click();await until(ui.dom,()=>!document.querySelector('fieldset').disabled);
  const row=await db.prepare('SELECT * FROM journal_entries WHERE id=?').bind(entry.id).first();await action(mf,cookie,row,'publish');
  for(const animation of uploaded){const response=await mf.dispatchFetch(origin+animation.path);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),animation.bytes);}
  const count=await db.prepare('SELECT COUNT(*) AS count FROM journal_assets WHERE entry_id=?').bind(entry.id).first();
  for(const animation of animations){
   const oversized=Buffer.concat([animation.bytes,Buffer.alloc(1500001-animation.bytes.length)]);
   Object.defineProperty(input,'files',{configurable:true,value:[new ui.dom.window.File([oversized],'大动图.'+animation.extension,{type:'image/jpeg'})]});input.dispatchEvent(new ui.dom.window.Event('change'));
   await until(ui.dom,()=>document.querySelector('[data-save-status]').textContent.includes('这张动图超过 1.5 MB')&&!document.querySelector('fieldset').disabled);
   const feedback=document.querySelector('[data-upload-status]');assert.equal(feedback.hidden,false);assert.equal(feedback.getAttribute('role'),'alert');assert.match(feedback.textContent,/1\.5 MB/);
   assert.equal(host.querySelectorAll('img').length,3);
  }
  const after=await db.prepare('SELECT COUNT(*) AS count FROM journal_assets WHERE entry_id=?').bind(entry.id).first();assert.equal(after.count,count.count);
 }finally{ui?.dom.window.close();await mf.dispose();}
});

test('a GIF larger than the old 750 KB limit uploads into a completely blank new article with visible feedback and unchanged animation bytes',async()=>{
 const {mf,db,cookie}=await worker();let ui;try{
  // CI uses an original generated GIF with a valid comment extension. A local path
  // exercises the user's exact original file without adding their upload to git.
  const base=animations[0].bytes,comments=[base.subarray(0,-1),Buffer.from([0x21,0xfe])];
  for(let i=0;i<3608;i++)comments.push(Buffer.from([255]),Buffer.alloc(255,32));
  comments.push(Buffer.from([0,0x3b]));
  const bytes=process.env.JOURNAL_TEST_GIF?await readFile(process.env.JOURNAL_TEST_GIF):Buffer.concat(comments);
  assert.ok(bytes.length>750000&&bytes.length<=1500000);
  const id=randomUUID();ui=await editor(mf,cookie,{id});ui.start();
  const document=ui.dom.window.document,input=document.querySelector('[data-image-file]'),host=document.querySelector('[data-image-editor]'),feedback=document.querySelector('[data-upload-status]');
  assert.equal(document.querySelector('[name=content]').value,'');assert.equal(document.querySelector('[name=title]').value,'');assert.equal(document.querySelector('[data-journal-editor]').dataset.revision,'0');
  Object.defineProperty(input,'files',{configurable:true,value:[new ui.dom.window.File([bytes],'1952.gif',{type:'image/gif'})]});input.dispatchEvent(new ui.dom.window.Event('change'));
  assert.equal(feedback.hidden,false);assert.match(feedback.textContent,/正在读取图片/);
  await until(ui.dom,()=>feedback.textContent.includes('图片已插入，草稿已保存')&&!document.querySelector('fieldset').disabled);
  assert.equal(feedback.classList.contains('error'),false);assert.equal(host.querySelectorAll('img').length,1);
  const path=host.querySelector('img').getAttribute('src');
  const stored=await db.prepare('SELECT * FROM journal_entries WHERE id=?').bind(id).first();assert.ok(stored);assert.equal(stored.status,'draft');assert.ok(JSON.parse(stored.draft).content.includes(path));
  assert.equal((await mf.dispatchFetch(origin+path)).status,404);
  const privateImage=await mf.dispatchFetch(origin+path,{headers:{cookie}});assert.equal(privateImage.status,200);assert.equal(privateImage.headers.get('content-type'),'image/gif');assert.deepEqual(Buffer.from(await privateImage.arrayBuffer()),bytes);
  change(ui.dom,'[name=title]','动图验证');document.querySelector('[data-publish]').click();
  await until(ui.dom,()=>document.querySelector('[data-save-status]').textContent.includes('已发布，访客现在可以')&&!document.querySelector('fieldset').disabled);
  const publicImage=await mf.dispatchFetch(origin+path);assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('content-type'),'image/gif');assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),bytes);
  const excessive=Buffer.concat([base,Buffer.alloc(1500001-base.length)]);const rejected=await upload(mf,cookie,id,'too-large.gif',excessive,true);assert.equal(rejected.status,413);assert.match((await rejected.json()).message,/1\.5 MB/);
  // Server failures also have feedback beside the image button, not only at the top.
  const before=document.querySelector('[name=content]').value;
  ui.dom.window.fetch=async()=>new Response(JSON.stringify({message:'上传服务暂时不可用，请重试。'}),{status:503,headers:{'content-type':'application/json'}});
  Object.defineProperty(input,'files',{configurable:true,value:[new ui.dom.window.File([base],'retry.gif',{type:'image/gif'})]});input.dispatchEvent(new ui.dom.window.Event('change'));
  await until(ui.dom,()=>feedback.textContent.includes('上传服务暂时不可用')&&!document.querySelector('fieldset').disabled);
  assert.equal(feedback.hidden,false);assert.equal(feedback.getAttribute('role'),'alert');assert.equal(document.querySelector('[name=content]').value,before);assert.equal(host.querySelectorAll('img').length,1);
 }finally{ui?.dom.window.close();await mf.dispose();}
});

async function reviewDeletion(mf,cookie,query){
 const response=await mf.dispatchFetch(origin+'/admin/journal/delete/?'+query,{headers:{cookie},redirect:'manual'});assert.equal(response.status,200);
 const html=await response.text(),dom=new JSDOM(html);const value=dom.window.document.querySelector('[name=targets]')?.value;dom.window.close();
 return {html,targets:value?JSON.parse(value):[]};
}
async function purge(mf,cookie,targets,headers={}){
 return mf.dispatchFetch(origin+'/admin/journal/action',{method:'POST',headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams({operation:'purge',targets:JSON.stringify(targets)}),redirect:'manual'});
}
test('single deletion requires a POST, only removes the reviewed trash revision and cascades its images',async()=>{
 const {mf,db,cookie}=await worker();try{
  let entry=await save(mf,cookie,randomUUID(),0,draft({title:'<script>删除标题</script>'}));
  const imageResponse=await upload(mf,cookie,entry.id,'保留测试.png',png,true);const image=(await imageResponse.json()).url;
  const active=await save(mf,cookie,randomUUID());let published=await save(mf,cookie,randomUUID());published=await action(mf,cookie,published,'publish');
  entry=await action(mf,cookie,entry,'trash');assert.ok(entry.trashed_at>0);
  const review=await reviewDeletion(mf,cookie,'id='+entry.id);assert.equal(review.targets.length,1);assert.doesNotMatch(review.html,/<script>删除标题/);assert.match(review.html,/确认永久删除/);
  assert.equal((await mf.dispatchFetch(origin+'/admin/journal/action?operation=purge',{headers:{cookie}})).status,405);
  assert.ok(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(entry.id).first(),'GET confirmation must not delete');
  const list=await(await mf.dispatchFetch(origin+'/admin/journal/?filter=trash',{headers:{cookie}})).text();assert.match(list,/还剩 30 天/);assert.match(list,/清空回收站/);assert.match(list,/每小时自动清理/);
  assert.equal((await purge(mf,'',review.targets)).status,303);assert.equal((await purge(mf,cookie,review.targets,{origin:'https://evil.test'})).status,403);
  const forged=await purge(mf,cookie,[{id:active.id,revision:active.revision},{id:published.id,revision:published.revision}]);assert.match(forged.headers.get('location'),/deleted=0&changed=2/);
  const invalid=await purge(mf,cookie,[review.targets[0],{id:"' OR 1=1 --",revision:1}]);assert.match(invalid.headers.get('location'),/error=1/);assert.ok(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(entry.id).first());
  const deleted=await purge(mf,cookie,review.targets);assert.equal(deleted.status,303);assert.match(deleted.headers.get('location'),/filter=trash&deleted=1&changed=0/);
  assert.equal(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(entry.id).first(),null);assert.equal(await db.prepare('SELECT id FROM journal_assets WHERE entry_id=?').bind(entry.id).first(),null);assert.equal((await mf.dispatchFetch(origin+image,{headers:{cookie}})).status,404);
  assert.ok(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(active.id).first());assert.equal((await mf.dispatchFetch(origin+'/blog/'+published.slug+'/')).status,200);
 }finally{await mf.dispose();}
});
test('clear trash snapshots all pages and protects restored, re-trashed and newly trashed articles during confirmation',async()=>{
 const {mf,db,cookie}=await worker();try{
  let first=await action(mf,cookie,await save(mf,cookie,randomUUID()),'trash');
  const second=await action(mf,cookie,await save(mf,cookie,randomUUID()),'trash');
  const extra=Array.from({length:21},()=>randomUUID());await db.batch(extra.map(id=>db.prepare("INSERT INTO journal_entries(id,slug,draft,status,revision,trashed_at) VALUES(?,?,?,'trash',2,unixepoch())").bind(id,'bulk-'+id,JSON.stringify(draft()))));
  const review=await reviewDeletion(mf,cookie,'all=1');assert.equal(review.targets.length,23);assert.match(review.html,/全部 23 篇日志/);
  first=await action(mf,cookie,first,'restore');assert.equal(first.trashed_at,null);first=await action(mf,cookie,first,'trash');
  const fresh=await action(mf,cookie,await save(mf,cookie,randomUUID()),'trash');
  const result=await purge(mf,cookie,review.targets);assert.match(result.headers.get('location'),/deleted=22&changed=1/);
  assert.equal(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(second.id).first(),null);
  for(const item of [first,fresh])assert.ok(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(item.id).first());
  const again=await reviewDeletion(mf,cookie,'all=1');await purge(mf,cookie,again.targets);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE status='trash'").first()).n,0);
  const empty=await reviewDeletion(mf,cookie,'all=1');assert.equal(empty.targets.length,0);assert.match(empty.html,/回收站是空的/);
 }finally{await mf.dispose();}
});
test('scheduled cleanup enforces exactly 30 days, deletes related images and keeps drafts, published and recent trash',async()=>{
 const {mf,db,cookie}=await worker();try{
  const now=Math.floor(Date.now()/1000),retention=30*86400;
  const expired=await action(mf,cookie,await save(mf,cookie,randomUUID()),'trash');
  const imageId=randomUUID();await db.prepare('INSERT INTO journal_assets(id,entry_id,mime,bytes) VALUES(?,?,?,?)').bind(imageId,expired.id,'image/png',Array.from(png)).run();
  const recent=await action(mf,cookie,await save(mf,cookie,randomUUID()),'trash');
  const legacy=await action(mf,cookie,await save(mf,cookie,randomUUID()),'trash');await db.prepare('UPDATE journal_entries SET trashed_at=NULL WHERE id=?').bind(legacy.id).run();
  const active=await save(mf,cookie,randomUUID());let published=await save(mf,cookie,randomUUID());published=await action(mf,cookie,published,'publish');
  await db.prepare('UPDATE journal_entries SET trashed_at=? WHERE id IN (?,?,?)').bind(now-retention,expired.id,active.id,published.id).run();
  await db.prepare('UPDATE journal_entries SET trashed_at=? WHERE id=?').bind(now-retention+1,recent.id).run();
  const response=await mf.dispatchFetch(origin+'/cdn-cgi/handler/scheduled?time='+now*1000+'&cron='+encodeURIComponent(config.triggers.crons[0]));assert.equal(response.status,200,await response.clone().text());
  assert.equal(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(expired.id).first(),null);assert.equal(await db.prepare('SELECT id FROM journal_assets WHERE id=?').bind(imageId).first(),null);
  for(const item of [recent,active,published,legacy])assert.ok(await db.prepare('SELECT id FROM journal_entries WHERE id=?').bind(item.id).first());
  assert.equal((await db.prepare('SELECT trashed_at FROM journal_entries WHERE id=?').bind(legacy.id).first()).trashed_at,now);
  assert.equal((await mf.dispatchFetch(origin+'/blog/'+published.slug+'/')).status,200);
  const repeat=await mf.dispatchFetch(origin+'/cdn-cgi/handler/scheduled?time='+now*1000+'&cron='+encodeURIComponent(config.triggers.crons[0]));assert.equal(repeat.status,200);
 }finally{await mf.dispose();}
});
test('migration gives existing trash a full retention period and restore/re-trash starts a new clock',async()=>{
 const id=randomUUID(),original=JSON.stringify(draft({title:'保留旧回收站内容'}));
 const {mf,db,cookie}=await worker(async db=>{await db.prepare("INSERT INTO journal_entries(id,slug,draft,status,saved_at) VALUES(?,?,?,'trash',1)").bind(id,'legacy-trash',original).run();});try{
  let entry=await db.prepare('SELECT * FROM journal_entries WHERE id=?').bind(id).first();assert.equal(entry.draft,original);assert.ok(entry.trashed_at>=Math.floor(Date.now()/1000)-10);
  await db.prepare('UPDATE journal_entries SET trashed_at=1 WHERE id=?').bind(id).run();entry=await action(mf,cookie,entry,'restore');assert.equal(entry.trashed_at,null);entry=await action(mf,cookie,entry,'trash');assert.ok(entry.trashed_at>=Math.floor(Date.now()/1000)-10);
  const repeated=await api(mf,cookie,{id,revision:entry.revision,operation:'trash'});assert.equal(repeated.status,400,'repeated trash must not silently extend retention');
 }finally{await mf.dispose();}
});
