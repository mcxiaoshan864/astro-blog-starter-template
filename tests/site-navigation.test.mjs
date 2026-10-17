import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const themeURL = dataURL(compile(await readFile(new URL('../src/scripts/theme-toggle.ts',import.meta.url),'utf8')));
const code = compile(await readFile(new URL('../src/scripts/site.ts',import.meta.url),'utf8')).replace('"./theme-toggle"', JSON.stringify(themeURL));
const { initSite, navigationIndex } = await import(dataURL(code));
class Element {
 constructor(text='',dataset={}) { this.textContent=text;this.dataset=dataset;this.attributes=new Map();this.properties=new Map();this.classes=new Set();this.style={setProperty:(key,value)=>this.properties.set(key,value)};this.classList={contains:key=>this.classes.has(key),toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)}; }
 setAttribute(key,value){this.attributes.set(key,value)}
 removeAttribute(key){this.attributes.delete(key)}
}
function page(saved='zh-TW') {
 const doc=new EventTarget(),win=new EventTarget();const store=new Map([['site-lang',saved]]);let writes=0;
 const root=new Element(),select=new Element(),nav=new Element(),meta=new Element();
 const links=['home','blog','about'].map(nav=>new Element('',{nav}));
 Object.assign(win,{Node:Element,location:{pathname:'/'},matchMedia:()=>({matches:false}),localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>{writes++;store.set(key,value)}}});
 Object.assign(doc,{defaultView:win,documentElement:root,content:[new Element('原文',{en:'English',tw:'廣東話'})],getElementById:()=>select,querySelector:selector=>selector==='.site-header nav'?nav:selector.includes('theme-color')?meta:null,querySelectorAll:selector=>selector==='[data-en]'?doc.content:links});
 return {doc,win,root,select,nav,meta,links,store,writes:()=>writes};
}
test('navigation indexes match page sections without matching unrelated prefixes',()=>{
 for(const [path,index] of [['/',0],['/blog',1],['/blog/',1],['/blog/post/',1],['/about/',2],['/about',2],['/blogger/',0],['/aboutness/',0]])assert.equal(navigationIndex(path),index);
});
test('changing pages keeps the same header, active link and saved Cantonese language',()=>{
 const h=page();initSite(h.doc);
 assert.equal(h.root.lang,'zh-HK');assert.equal(h.doc.content[0].textContent,'廣東話');
 h.win.location.pathname='/about/';h.doc.content=[new Element('新頁',{en:'New page',tw:'新一頁'})];h.doc.dispatchEvent(new Event('astro:after-swap'));
 assert.equal(h.nav.properties.get('--nav-index'),'2');assert.equal(h.links[2].attributes.get('aria-current'),'page');assert.equal(h.links[0].attributes.has('aria-current'),false);assert.equal(h.select.value,'zh-TW');assert.equal(h.doc.content[0].textContent,'新一頁');
 h.win.location.pathname='/';h.doc.dispatchEvent(new Event('astro:after-swap'));assert.equal(h.links[0].attributes.get('aria-current'),'page');
});
test('incoming document is dark and translated before swap, without translating original text twice',()=>{
 const h=page();h.root.classList.toggle('dark',true);initSite(h.doc);const next=page('zh-CN');
 const event=new Event('astro:before-swap');event.newDocument=next.doc;h.doc.dispatchEvent(event);
 assert.equal(next.root.classList.contains('dark'),true);assert.equal(next.root.lang,'zh-HK');assert.equal(next.meta.attributes.get('content'),'#0e2035');assert.equal(next.doc.content[0].textContent,'廣東話');
 h.doc.content=next.doc.content;h.select.value='zh-CN';h.select.id='language';const change=new Event('change');Object.defineProperty(change,'target',{value:h.select});h.doc.dispatchEvent(change);
 assert.equal(h.doc.content[0].textContent,'原文');assert.equal(h.store.get('site-lang'),'zh-CN');
});
test('site initialization is idempotent and language controls stay usable after page-load',()=>{
 const h=page('en');initSite(h.doc);initSite(h.doc);h.doc.dispatchEvent(new Event('astro:page-load'));
 assert.equal(h.doc.content[0].textContent,'English');h.select.value='zh-TW';h.select.id='language';const change=new Event('change');Object.defineProperty(change,'target',{value:h.select});h.doc.dispatchEvent(change);
 assert.equal(h.doc.content[0].textContent,'廣東話');assert.equal(h.writes(),1);
});
