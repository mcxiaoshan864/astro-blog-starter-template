import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {zipSync,strToU8} from 'fflate';
import iconv from 'iconv-lite';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const config=JSON.parse(await readFile(new URL('../wrangler.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../dist/_worker.js/',import.meta.url)).replace(/\/$/,'');
async function modulesAt(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())result.push(...await modulesAt(path));else if(/\.(mjs|js)$/.test(path))result.push({type:'ESModule',path,contents:await readFile(path,'utf8')});}return result;}
const modules=await modulesAt(root);modules.sort((a,b)=>Number(b.path===root+'/index.js')-Number(a.path===root+'/index.js'));
const schema=await readFile(new URL('../migrations/0002_journal.sql',import.meta.url),'utf8');
const origin='https://journal.test';
const editorCode=ts.transpileModule(await readFile(new URL('../src/scripts/journal-editor.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/export\s*\{\s*\};?/g,'');
const password='Disposable-journal-test-'+randomBytes(16).toString('hex');const salt=randomBytes(16);
const auth=JSON.stringify({version:1,salt:salt.toString('base64url'),digest:pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url'),sessionKey:randomBytes(32).toString('base64url')});
async function worker(){
 const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,log:new Log(LogLevel.ERROR),bindings:{ADMIN_AUTH:auth},d1Databases:['GUESTBOOK_DB'],ratelimits:{ADMIN_LOGIN_LIMITER:{simple:{limit:5,period:60}}},serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})}});
 const db=await mf.getD1Database('GUESTBOOK_DB');await db.batch(schema.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
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
 const calls=[];
 dom.window.fetch=async(path,options)=>{const payload=JSON.parse(options.body);calls.push(payload);if(beforeFetch)await beforeFetch(payload,calls.length);return mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,origin,cookie},redirect:'manual'});};
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
