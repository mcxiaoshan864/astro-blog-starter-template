import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const cryptoURL = dataURL(compile(await readFile(new URL('../src/server/admin-crypto.ts',import.meta.url),'utf8')));
const authURL = dataURL(compile(await readFile(new URL('../src/server/admin-auth.ts',import.meta.url),'utf8')).replaceAll('"./admin-crypto"',JSON.stringify(cryptoURL)));
export const primitives = await import(cryptoURL);
export const auth = await import(authURL);
const password = 'Test-only! n0t a real credential';
const config = await primitives.createAuthConfig(password);
const origin = 'https://example.test';
const env = { ADMIN_AUTH: JSON.stringify(config), ADMIN_LOGIN_LIMITER: {limit:async()=>({success:true})} };
const request = (body = new URLSearchParams({username:'admin',password}), headers = {}) => new Request(origin+'/admin/login/', {method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',...headers},body});
test('configuration rejects malformed records and passwords shorter than 16 characters',async()=>{
  assert.equal(auth.readAuthConfig({}),null);
  for(const bad of ['{}','not json',JSON.stringify({...config,sessionKey:'short'}),JSON.stringify({...config,version:2})])assert.equal(auth.readAuthConfig({ADMIN_AUTH:bad}),null);
  await assert.rejects(primitives.createAuthConfig('too short'));
  assert.equal(await auth.verifyPassword(password,config),true);
  assert.equal(await auth.verifyPassword(password+'!',config),false);
});
test('signed sessions reject tampering, other hosts, expiry, future claims, and credential rotation',async()=>{
  const token=await auth.createSession(config,origin,1000);
  assert.equal((await auth.verifySession(token,config,origin,1001)).sub,'admin');
  assert.equal(await auth.verifySession(token,config,'https://other.test',1001),null);
  assert.equal(await auth.verifySession(token,config,origin,1000+primitives.SESSION_SECONDS),null);
  assert.equal(await auth.verifySession(token,config,origin,900),null);
  assert.equal(await auth.verifySession('forged.'+token.split('.')[1],config,origin,1001),null);
  assert.equal(await auth.verifySession(token,{...config,sessionKey:primitives.randomToken()},origin,1001),null);
  assert.equal(await auth.verifySession(token,{...config,salt:primitives.randomToken(16)},origin,1001),null);
  for(const malformed of ['',token+'.extra','x'.repeat(2048),'a.b'])assert.equal(await auth.verifySession(malformed,config,origin,1001),null);
});
test('login requires a matching HTTPS origin and fails closed without configuration or rate limiter',async()=>{
  assert.equal((await auth.authenticate(request(),{})).status,503);
  assert.equal((await auth.authenticate(request(),{ADMIN_AUTH:env.ADMIN_AUTH})).status,503);
  assert.equal((await auth.authenticate(request(undefined,{origin:'https://other.test'}),env)).status,403);
  assert.equal((await auth.authenticate(request(undefined,{'sec-fetch-site':'cross-site'}),env)).status,403);
  const missing=request();missing.headers.delete('origin');assert.equal((await auth.authenticate(missing,env)).status,403);
  const down={...env,ADMIN_LOGIN_LIMITER:{limit:async()=>{throw new Error('offline')}}};
  assert.equal((await auth.authenticate(request(),down)).status,503);
});
test('rate limiting runs before password verification; invalid or oversized forms cannot authenticate',async()=>{
  const denied={...env,ADMIN_LOGIN_LIMITER:{limit:async()=>({success:false})}};
  assert.equal((await auth.authenticate(request(),denied)).status,429);
  assert.equal((await auth.authenticate(request('password='+ 'x'.repeat(5000)),env)).status,400);
  assert.equal((await auth.authenticate(request(new URLSearchParams({username:'admin',password:'x'.repeat(257)})),env)).status,400);
  assert.equal((await auth.authenticate(request('username=admin&password=one&password=two'),env)).status,400);
  assert.equal((await auth.authenticate(request('{}',{'content-type':'application/json'}),env)).status,400);
  assert.equal((await auth.authenticate(request(new URLSearchParams({username:'someone-else',password})),env)).status,401);
  assert.equal((await auth.authenticate(request(new URLSearchParams({username:'admin',password:'wrong password'})),env)).status,401);
});
test('correct credentials issue only an admin session with secure cookie settings',async()=>{
  const result=await auth.authenticate(request(),env);assert.equal(result.ok,true);
  assert.equal((await auth.verifySession(result.token,config,origin)).sub,'admin');
  assert.deepEqual(auth.sessionCookieOptions,{path:'/',secure:true,httpOnly:true,sameSite:'strict',maxAge:28800});
});
