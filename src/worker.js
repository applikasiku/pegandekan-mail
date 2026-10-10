import PostalMime from 'postal-mime';
import {digest,hashPassword,verifyPassword,address,validatePassword,attachments} from './security.js';
const MAX=100, MAXMAIL=131072;
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const now=()=>Math.floor(Date.now()/1000);
const cleanUser=u=>({id:u.id,email:u.email,name:u.name,role:u.role,active:u.active});
async function body(req){if(Number(req.headers.get('content-length'))>200000) fail('Permintaan terlalu besar.',413); const text=await req.text(); if(text.length>200000) fail('Permintaan terlalu besar.',413);try{return JSON.parse(text);}catch{fail('Data tidak valid.');}}
async function limited(env,key,limit){await env.DB.prepare('DELETE FROM attempts WHERE expires < ?').bind(now()).run(); const r=await env.DB.prepare('INSERT INTO attempts(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now()+900).first(); if(r.count>limit) fail('Terlalu banyak percobaan. Tunggu 15 menit.',429);}
async function session(req,env){const token=req.headers.get('cookie')?.match(/(?:^|;\s*)pm_session=([a-f0-9]+)/)?.[1];if(!token) fail('Silakan login.',401);const u=await env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1').bind(await digest(token),now()).first();if(!u) fail('Sesi berakhir. Silakan login.',401);return u;}
function cookie(req,token,age){return `pm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(req.url).protocol==='https:'?'; Secure':''}`;}
async function capacity(env,id,needed=1){const r=await env.DB.prepare('SELECT count(*) n FROM messages WHERE user_id=?').bind(id).first();if(r.n+needed>MAX) fail('Kotak surat penuh (100 email). Hapus email di sampah.',409);}
async function api(req,env){
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(!env.DB) fail('Database belum terhubung.',503);
 if(!['GET','HEAD'].includes(method)&&req.headers.get('origin')!==url.origin) fail('Origin tidak diizinkan.',403);
 if(path==='/api/status'&&method==='GET'){const u=await env.DB.prepare('SELECT id FROM users LIMIT 1').first();return json({setup:!u,domain:env.MAIL_DOMAIN,externalSending:false,maxAttachmentBytes:65536});}
 if(path==='/api/setup'&&method==='POST'){
  if(!env.SETUP_TOKEN) fail('Admin: tambahkan secret SETUP_TOKEN di Cloudflare.',503);
  await limited(env,'setup:'+ (req.headers.get('cf-connecting-ip')||'local'),5);
  const b=await body(req);if(typeof b.token!=='string'||await digest(b.token)!==await digest(env.SETUP_TOKEN)) fail('Token setup salah.',403);validatePassword(b.password);
  const r=await env.DB.prepare("INSERT INTO users(id,email,name,password,role,created) SELECT ?,?,?,?,'admin',? WHERE NOT EXISTS(SELECT 1 FROM users)").bind(crypto.randomUUID(),address(b.email,env.MAIL_DOMAIN),String(b.name||'Administrator').slice(0,80),await hashPassword(b.password),now()).run();if(!r.meta.changes) fail('Setup sudah selesai.',409);return json({ok:true});
 }
 if(path==='/api/login'&&method==='POST'){
  const b=await body(req);await limited(env,'login:'+ (req.headers.get('cf-connecting-ip')||'local'),20);let email;try{email=address(b.email,env.MAIL_DOMAIN);}catch{fail('Email atau password salah.',401);}
  const u=await env.DB.prepare('SELECT * FROM users WHERE email=? AND active=1').bind(email).first();if(typeof b.password!=='string'||b.password.length>128) fail('Email atau password salah.',401);
  const valid=await verifyPassword(b.password,u?.password||'00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000');if(!u||!valid) fail('Email atau password salah.',401);
  await env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now()).run();const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),u.id,now()+86400).run();return json(cleanUser(u),200,{'Set-Cookie':cookie(req,token,86400)});
 }
 const u=await session(req,env);
 if(path==='/api/me'&&method==='GET') return json(cleanUser(u));
 if(path==='/api/logout'&&method==='POST'){const token=req.headers.get('cookie')?.match(/pm_session=([a-f0-9]+)/)?.[1];await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(await digest(token||'')).run();return json({ok:true},200,{'Set-Cookie':cookie(req,'',0)});}
 if(path==='/api/password'&&method==='POST'){const b=await body(req);await limited(env,'password:'+u.id,10);if(!await verifyPassword(String(b.current||''),u.password)) fail('Password lama salah.');validatePassword(b.password);await env.DB.batch([env.DB.prepare('UPDATE users SET password=? WHERE id=?').bind(await hashPassword(b.password),u.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]);return json({ok:true},200,{'Set-Cookie':cookie(req,'',0)});}
 if(path==='/api/messages'&&method==='GET'){const folder=url.searchParams.get('folder')||'inbox',q=(url.searchParams.get('q')||'').slice(0,80);const rows=await env.DB.prepare('SELECT id,sender,recipient,subject,substr(body,1,140) preview,folder,unread,starred,created FROM messages WHERE user_id=? AND folder=? AND (subject LIKE ? OR sender LIKE ? OR body LIKE ?) ORDER BY created DESC LIMIT 200').bind(u.id,folder,'%'+q+'%','%'+q+'%','%'+q+'%').all();const counts=await env.DB.prepare('SELECT folder,count(*) total,sum(unread) unread FROM messages WHERE user_id=? GROUP BY folder').bind(u.id).all();return json({messages:rows.results,counts:counts.results});}
 if(path==='/api/messages'&&method==='POST'){
  await limited(env,'send:'+u.id,30);const b=await body(req),draft=b.draft===true,subject=String(b.subject||'').slice(0,200),text=String(b.body||'');if(text.length>40000) fail('Isi email maksimal 40.000 karakter.');const files=attachments(b.attachments);if(new TextEncoder().encode(text+JSON.stringify(files)).length>120000) fail('Isi email dan lampiran terlalu besar.',413);let recipient=String(b.to||'').trim().toLowerCase(),target;
  if(!draft){if(!subject||!recipient) fail('Penerima dan subjek wajib diisi.');if(recipient.includes('@')&&!recipient.endsWith('@'+env.MAIL_DOMAIN)) fail('Pengiriman ke luar domain belum tersedia pada versi gratis ini.',422);recipient=address(recipient,env.MAIL_DOMAIN);target=await env.DB.prepare('SELECT id FROM users WHERE email=? AND active=1').bind(recipient).first();if(!target) fail('Akun penerima belum ada atau tidak aktif.',404);}
  if(b.id){const existing=await env.DB.prepare("SELECT id FROM messages WHERE id=? AND user_id=? AND folder='drafts'").bind(b.id,u.id).first();if(!existing) fail('Draf tidak ditemukan.',404);}
  await capacity(env,u.id,(b.id?0:1)+(target?.id===u.id?1:0));if(target&&target.id!==u.id) await capacity(env,target.id);
  const statements=[];
  // Explicit columns avoid coupling to table ordering.
  const save=(id,folder,unread)=>env.DB.prepare('INSERT INTO messages(id,user_id,sender,recipient,subject,body,attachments,folder,unread,starred,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,u.email,recipient,subject,text,JSON.stringify(files),folder,unread,0,now());
  if(b.id) statements.push(env.DB.prepare("DELETE FROM messages WHERE id=? AND user_id=? AND folder='drafts'").bind(b.id,u.id));statements.push(save(u.id,draft?'drafts':'sent',0));if(target) statements.push(save(target.id,'inbox',1));await env.DB.batch(statements);return json({ok:true});
 }
 const match=path.match(/^\/api\/messages\/([a-zA-Z0-9-]+)$/);
 if(match){const m=await env.DB.prepare('SELECT * FROM messages WHERE id=? AND user_id=?').bind(match[1],u.id).first();if(!m) fail('Email tidak ditemukan.',404);
  if(method==='GET'){await env.DB.prepare('UPDATE messages SET unread=0 WHERE id=? AND user_id=?').bind(m.id,u.id).run();return json({...m,attachments:JSON.parse(m.attachments)});}
  if(method==='PATCH'){const b=await body(req);const folder=b.folder===undefined?m.folder:b.folder;if(![m.folder,'trash','inbox'].includes(folder)||folder==='inbox'&&m.folder!=='trash'&&m.folder!=='inbox') fail('Folder tidak valid.');await env.DB.prepare('UPDATE messages SET folder=?,starred=?,unread=? WHERE id=? AND user_id=?').bind(folder,b.starred===undefined?m.starred:Number(!!b.starred),b.unread===undefined?m.unread:Number(!!b.unread),m.id,u.id).run();return json({ok:true});}
  if(method==='DELETE'){if(m.folder!=='trash') fail('Pindahkan ke sampah dahulu.');await env.DB.prepare('DELETE FROM messages WHERE id=? AND user_id=?').bind(m.id,u.id).run();return json({ok:true});}
 }
 if(path==='/api/users'){if(u.role!=='admin') fail('Khusus admin.',403);
  if(method==='GET'){const r=await env.DB.prepare('SELECT id,email,name,role,active,created FROM users ORDER BY created').all();return json(r.results);}
  if(method==='POST'){const b=await body(req);validatePassword(b.password);const n=await env.DB.prepare('SELECT count(*) n FROM users').first();if(n.n>=20) fail('Versi awal dibatasi 20 akun.');const email=address(b.email,env.MAIL_DOMAIN);if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) fail('Alamat email sudah dipakai.',409);await env.DB.prepare("INSERT INTO users VALUES(?,?,?,?,'user',1,?)").bind(crypto.randomUUID(),email,String(b.name||email).slice(0,80),await hashPassword(b.password),now()).run();return json({ok:true});}
 }
 const um=path.match(/^\/api\/users\/([a-zA-Z0-9-]+)$/);if(um&&method==='PATCH'){if(u.role!=='admin') fail('Khusus admin.',403);if(um[1]===u.id) fail('Admin tidak dapat menonaktifkan dirinya.');const b=await body(req),target=await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(um[1]).first();if(!target) fail('Pengguna tidak ditemukan.',404);const sql=[];if(b.active!==undefined) sql.push(env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(Number(!!b.active),target.id));if(b.password!==undefined){validatePassword(b.password);sql.push(env.DB.prepare('UPDATE users SET password=? WHERE id=?').bind(await hashPassword(b.password),target.id));}sql.push(env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id));await env.DB.batch(sql);return json({ok:true});}
 fail('Halaman tidak ditemukan.',404);
}
export default {
 async fetch(req,env){let response;try{response=new URL(req.url).pathname.startsWith('/api/')?await api(req,env):await env.ASSETS.fetch(req);}catch(e){response=json({error:e.status?e.message:'Layanan bermasalah. Pastikan migrasi database sudah dijalankan.'},e.status||500);}
 const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");return new Response(response.body,{status:response.status,headers});
 },
 async email(message,env){
  const recipient=String(message.to).toLowerCase();const u=await env.DB.prepare('SELECT id FROM users WHERE email=? AND active=1').bind(recipient).first();if(!u){message.setReject('Mailbox unavailable');return;}if(message.rawSize>MAXMAIL){message.setReject('Message too large; maximum 128 KiB');return;}
  const n=await env.DB.prepare('SELECT count(*) n FROM messages WHERE user_id=?').bind(u.id).first();if(n.n>=MAX){message.setReject('Mailbox full');return;}
  const mail=await PostalMime.parse(message.raw);let files;try{files=attachments((mail.attachments||[]).map(a=>{let binary='';for(const byte of new Uint8Array(a.content)) binary+=String.fromCharCode(byte);return {name:a.filename||'lampiran',data:btoa(binary)};}));}catch{message.setReject('Attachments too large; maximum 64 KiB, 3 files');return;}
  const text=(mail.text||mail.html?.replace(/<[^>]*>/g,' ')||'').slice(0,40000);if(new TextEncoder().encode(text+JSON.stringify(files)).length>120000){message.setReject('Decoded email too large');return;}
  await env.DB.prepare('INSERT INTO messages(id,user_id,sender,recipient,subject,body,attachments,folder,unread,starred,created) VALUES(?,?,?,?,?,?,?,\'inbox\',1,0,?)').bind(crypto.randomUUID(),u.id,String(message.from).slice(0,254),recipient,String(mail.subject||'(Tanpa subjek)').slice(0,200),text,JSON.stringify(files),now()).run();
 }
};
