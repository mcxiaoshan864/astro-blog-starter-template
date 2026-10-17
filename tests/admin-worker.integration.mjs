import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
const deployment=JSON.parse(await readFile(new URL('../wrangler.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../dist/_worker.js/',import.meta.url)).replace(/\/$/,'');
async function modulesAt(dir){
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=dir+'/'+entry.name;
    if(entry.isDirectory())result.push(...await modulesAt(path));
    else if(/\.(mjs|js)$/.test(entry.name))result.push({type:'ESModule',path,contents:await readFile(path,'utf8')});
  }
  return result;
}
const modules=await modulesAt(root);
// Miniflare starts from the first module. Preserve the actual built entrypoint.
modules.sort((a,b)=>Number(b.path===root+'/index.js')-Number(a.path===root+'/index.js'));
const password='Disposable-test-only-password!'+randomBytes(8).toString('hex');
const salt=randomBytes(16);
const secret=JSON.stringify({version:1,salt:salt.toString('base64url'),digest:pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url'),sessionKey:randomBytes(32).toString('base64url')});
const origin='https://mcxiaoshan.test';
function worker(configured=true){return new Miniflare({modules,modulesRoot:root,compatibilityDate:deployment.compatibility_date,compatibilityFlags:deployment.compatibility_flags,log:new Log(LogLevel.ERROR),bindings:configured?{ADMIN_AUTH:secret}:{},ratelimits:{ADMIN_LOGIN_LIMITER:{simple:{limit:5,period:60}}},serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})}});}
const post=(path,fields={},extra={})=>({method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded','CF-Connecting-IP':'192.0.2.7',...extra},body:new URLSearchParams(fields),redirect:'manual'});
function security(response){assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);}
test('built Worker blocks unauthenticated admin, renders setup safely and never emits a default credential',async()=>{
  const mf=worker(false);
  try{
    const blocked=await mf.dispatchFetch(origin+'/admin/',{redirect:'manual'});assert.equal(blocked.status,303);assert.equal(new URL(blocked.headers.get('location'),origin).pathname,'/admin/login/');security(blocked);
    const login=await mf.dispatchFetch(origin+'/admin/login/');assert.equal(login.status,200);security(login);const html=await login.text();assert.match(html,/欢迎回来/);assert.match(html,/管理员账户尚未启用/);assert.match(html,/name="password"[^>]*disabled/);assert.doesNotMatch(html,/Test-only|Disposable-test/);
    const setup=await mf.dispatchFetch(origin+'/admin/setup/');assert.equal(setup.status,200);security(setup);const setupHtml=await setup.text();assert.match(setupHtml,/ADMIN_AUTH/);assert.match(setupHtml,/nonce="[A-Za-z0-9_-]+"/);assert.equal(setupHtml.includes(secret),false);
    const refused=await mf.dispatchFetch(origin+'/admin/login/',post('/admin/login/',{username:'admin',password}));assert.equal(refused.status,503);
  }finally{await mf.dispose();}
});
test('built Worker performs login, guards direct requests, exits with cookie deletion and rejects CSRF',async()=>{
  const mf=worker();
  try{
    const form=await mf.dispatchFetch(origin+'/admin/login/');const html=await form.text();assert.equal(form.status,200);assert.doesNotMatch(html,/name="password"[^>]*disabled/);assert.equal(html.includes(secret),false);
    const forged=await mf.dispatchFetch(origin+'/admin/',{headers:{cookie:'__Host-admin_session=forged'},redirect:'manual'});assert.equal(forged.status,303);
    const cross=await mf.dispatchFetch(origin+'/admin/login/',post('',{username:'admin',password},{origin:'https://evil.test'}));assert.equal(cross.status,403); // Astro may reject cross-origin form posts before middleware.
    const signed=await mf.dispatchFetch(origin+'/admin/login/',post('',{username:'admin',password}));assert.equal(signed.status,303);assert.equal(new URL(signed.headers.get('location'),origin).pathname,'/admin/');security(signed);
    const cookie=signed.headers.get('set-cookie');assert.match(cookie,/^__Host-admin_session=/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Strict/i);assert.match(cookie,/Path=\//);assert.doesNotMatch(cookie,/Domain=/i);
    const cookieHeader=cookie.split(';')[0];
    const admin=await mf.dispatchFetch(origin+'/admin/',{headers:{cookie:cookieHeader}});assert.equal(admin.status,200);security(admin);const dashboard=await admin.text();assert.match(dashboard,/你好，站长/);assert.match(dashboard,/唯一管理员/);assert.equal(dashboard.includes(secret),false);
    const other=await mf.dispatchFetch('https://another.test/admin/',{headers:{cookie:cookieHeader},redirect:'manual'});assert.equal(other.status,303);
    const setup=await mf.dispatchFetch(origin+'/admin/setup/',{redirect:'manual'});assert.equal(setup.status,303);
    const badLogout=await mf.dispatchFetch(origin+'/admin/logout/',post('',{}, {cookie:cookieHeader,origin:'https://evil.test'}));assert.equal(badLogout.status,403);
    const getLogout=await mf.dispatchFetch(origin+'/admin/logout/',{headers:{cookie:cookieHeader},redirect:'manual'});assert.equal(getLogout.status,405);
    const exit=await mf.dispatchFetch(origin+'/admin/logout/',post('',{},{cookie:cookieHeader}));assert.equal(exit.status,303);security(exit);assert.match(exit.headers.get('set-cookie'),/Max-Age=0/i);
    const again=await mf.dispatchFetch(origin+'/admin/',{redirect:'manual'});assert.equal(again.status,303);
  }finally{await mf.dispose();}
});
test('built Worker enforces rate limiting on repeated incorrect passwords',async()=>{
  const mf=worker();
  try{
    for(let i=0;i<5;i++){
      const response=await mf.dispatchFetch(origin+'/admin/login/',post('',{username:'admin',password:'incorrect'}));assert.equal(response.status,401);
    }
    const limited=await mf.dispatchFetch(origin+'/admin/login/',post('',{username:'admin',password}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');security(limited);
  }finally{await mf.dispose();}
});
