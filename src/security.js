const enc = new TextEncoder();
export const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(s){ return hex(await crypto.subtle.digest('SHA-256',enc.encode(s))); }
export async function hashPassword(password,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 return `${salt}:${hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256))}`;
}
export async function verifyPassword(password,stored){
 const candidate=await hashPassword(password,stored.split(':')[0]);
 let diff=candidate.length^stored.length; for(let i=0;i<stored.length;i++) diff|=stored.charCodeAt(i)^(candidate.charCodeAt(i)||0); return diff===0;
}
export function address(value,domain){ const local=String(value||'').trim().toLowerCase().replace(new RegExp('@'+domain.replaceAll('.','\\.')+'$'),''); if(!/^[a-z0-9][a-z0-9._-]{0,47}$/.test(local)) throw new Error('Nama email tidak valid.'); return local+'@'+domain; }
export function validatePassword(p){if(typeof p!=='string'||p.length<12||p.length>128) throw new Error('Password harus 12–128 karakter.');}
export function attachments(value=[]){
 if(!Array.isArray(value)||value.length>3) throw new Error('Maksimal 3 lampiran.');
 let total=0; const out=value.map(a=>{if(typeof a.name!=='string'||typeof a.data!=='string'||! /^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) throw new Error('Lampiran tidak valid.'); const size=atob(a.data).length; total+=size; return {name:a.name.slice(0,120),type:'application/octet-stream',data:a.data,size};});
 if(total>65536) throw new Error('Total lampiran maksimal 64 KB.'); return out;
}
