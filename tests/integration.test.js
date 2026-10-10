import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';

test('runtime: authentication, mailbox isolation, internal delivery, drafts, incoming MIME, account revocation',async()=>{
 const built=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-10',d1Databases:['DB'],bindings:{MAIL_DOMAIN:'pegandekan.web.id',SETUP_TOKEN:'local-test-only'},host:'127.0.0.1',unsafeTriggerHandlers:true}));
 try{
  const db=await mf.getD1Database('DB');
  const sql=await readFile('migrations/0001_mail.sql','utf8');
  // D1 exec accepts one statement per line; full migration is parsed by SQLite.
  for(const statement of sql.split('\n').filter(Boolean)) await db.exec(statement);
  const request=async(path,method='GET',data,cookie='',origin='https://mail.test')=>{
   const r=await mf.dispatchFetch('https://mail.test/api/'+path,{method,headers:{origin,cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
   return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  assert.equal((await request('me')).status,401);
  assert.equal((await request('setup','POST',{token:'wrong',email:'admin',password:'admin-password'})).status,403);
  assert.equal((await request('setup','POST',{token:'local-test-only',email:'admin',name:'Admin',password:'admin-password'})).status,200);
  assert.equal((await request('setup','POST',{token:'local-test-only',email:'other',password:'admin-password'})).status,409);
  const admin=await request('login','POST',{email:'admin',password:'admin-password'});assert.equal(admin.status,200);
  assert.equal((await request('users','POST',{email:'alice',name:'Alice',password:'alice-password'},admin.cookie)).status,200);
  const alice=await request('login','POST',{email:'alice',password:'alice-password'});
  assert.equal((await request('users','GET',undefined,alice.cookie)).status,403);
  assert.equal((await request('messages','POST',{to:'alice',subject:'Hello',body:'Hello Alice',attachments:[{name:'hello.txt',data:btoa('hello')}]},admin.cookie,'https://evil.test')).status,403);
  assert.equal((await request('messages','POST',{to:'alice',subject:'Hello',body:'Hello Alice',attachments:[{name:'hello.txt',data:btoa('hello')}]},admin.cookie)).status,200);
  const inbox=await request('messages?folder=inbox','GET',undefined,alice.cookie);assert.equal(inbox.data.messages.length,1);
  const id=inbox.data.messages[0].id;
  assert.equal((await request('messages/'+id,'GET',undefined,admin.cookie)).status,404);
  assert.equal((await request('messages/'+id,'DELETE',undefined,admin.cookie)).status,404);
  const msg=await request('messages/'+id,'GET',undefined,alice.cookie);assert.equal(msg.data.attachments[0].data,btoa('hello'));
  assert.equal((await request('messages','POST',{to:'test@gmail.com',subject:'External',body:'No'},alice.cookie)).status,422);
  assert.equal((await request('messages','POST',{to:'unknown',subject:'Missing',body:'No'},alice.cookie)).status,404);
  assert.equal((await request('messages','POST',{draft:true,to:'admin',subject:'Draft',body:'draft'},alice.cookie)).status,200);
  const drafts=await request('messages?folder=drafts','GET',undefined,alice.cookie);
  assert.equal((await request('messages','POST',{id:drafts.data.messages[0].id,to:'admin',subject:'Draft',body:'Sent draft'},alice.cookie)).status,200);
  assert.equal((await request('messages?folder=drafts','GET',undefined,alice.cookie)).data.messages.length,0);
  const email=await mf.dispatchFetch('https://mail.test/cdn-cgi/local/email?from=sender%40example.com&to=alice%40pegandekan.web.id',{method:'POST',body:'Message-ID: <integration-1@example.com>\r\nFrom: Sender <sender@example.com>\r\nTo: alice@pegandekan.web.id\r\nSubject: Incoming MIME\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello from outside'});
  assert.equal(email.status,200,await email.text());
  assert.equal((await request('messages?folder=inbox','GET',undefined,alice.cookie)).data.messages.length,2);
  assert.equal((await request('messages/'+id,'PATCH',{folder:'trash'},alice.cookie)).status,200);
  assert.equal((await request('messages/'+id,'DELETE',undefined,alice.cookie)).status,200);
  const aliceId=alice.data.id;
  assert.equal((await request('users/'+aliceId,'PATCH',{active:false},admin.cookie)).status,200);
  assert.equal((await request('me','GET',undefined,alice.cookie)).status,401);
  assert.equal((await request('messages','POST',{to:'alice',subject:'Disabled',body:'No'},admin.cookie)).status,404);
  assert.equal((await request('password','POST',{current:'admin-password',password:'new-admin-password'},admin.cookie)).status,200);
  assert.equal((await request('me','GET',undefined,admin.cookie)).status,401);
 }finally{await mf.dispose();}
});
