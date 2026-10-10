import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,address,attachments} from '../src/security.js';
test('password hashing uses salt and rejects incorrect password',async()=>{const a=await hashPassword('correct-password');const b=await hashPassword('correct-password');assert.notEqual(a,b);assert.equal(await verifyPassword('correct-password',a),true);assert.equal(await verifyPassword('wrong-password',a),false);});
test('local and full email addresses are restricted to own domain',()=>{assert.equal(address('Andy','pegandekan.web.id'),'andy@pegandekan.web.id');assert.equal(address('andy@pegandekan.web.id','pegandekan.web.id'),'andy@pegandekan.web.id');assert.throws(()=>address('andy@gmail.com','pegandekan.web.id'));assert.throws(()=>address('a+b','pegandekan.web.id'));});
test('attachment limits reject malformed and oversized files',()=>{assert.equal(attachments([{name:'hello.txt',data:btoa('hello')}])[0].size,5);assert.throws(()=>attachments([{name:'bad',data:'!'}]));assert.throws(()=>attachments([{name:'large',data:btoa('x'.repeat(65537))}]));assert.throws(()=>attachments(Array(4).fill({name:'empty',data:''})));});
