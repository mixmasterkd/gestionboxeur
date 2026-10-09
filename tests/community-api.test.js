import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=(await readFile(new URL('../js/community-api.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function fixture(){
 let authChange, resolveRPC, delayed=false;
 const events=[],calls=[];
 const cache={accountRevision:0,invalidations:0,setAccount(){this.accountRevision++;},invalidate(){this.invalidations++;},load(){return[];}};
 const client={auth:{onAuthStateChange(fn){authChange=fn;},getSession:async()=>({data:{session:{user:{id:'coach'}}}})}};
 const rpc=async(name,args)=>{calls.push({name,args});if(delayed)return new Promise(resolve=>{resolveRPC=resolve;});return {id:'result'};};
 const window={dispatchEvent(event){events.push(event.detail);}};
 const CustomEvent=class{constructor(_name,{detail}){this.detail=detail;}};
 const command=new Function('client','rpc','createGroupListCache','window','CustomEvent',`${source}\nreturn command;`)(client,rpc,()=>cache,window,CustomEvent);
 return{command,cache,events,calls,delay(){delayed=true;},changeAccount(){authChange('SIGNED_IN',{user:{id:'another'}});},resolve(){resolveRPC({id:'result'});}};
}
test('candidate searches and join-link inspection never refresh the group list or emit mutation events',async()=>{
 const f=fixture();
 await f.command('invite_candidates',{group_id:'a',query:'Alex'});await f.command('inspect_join_link',{token:'private-token'});
 assert.equal(f.cache.invalidations,0);assert.deepEqual(f.events,[]);assert.equal(f.calls.length,2);
});
test('batch invitations and accepted join links invalidate membership menus once after success',async()=>{
 const f=fixture();await f.command('invite_members',{group_id:'a',user_ids:['one','two']});await f.command('accept_join_link',{token:'private-token'});
 assert.equal(f.cache.invalidations,2);assert.deepEqual(f.events.map(event=>event.action),['invite_members','accept_join_link']);
 assert.ok(f.events.every(event=>!JSON.stringify(event).includes('private-token')));
});
test('a mutation completing after an account change cannot refresh or notify the new account',async()=>{
 const f=fixture();f.delay();const pending=f.command('invite_members',{group_id:'a',user_ids:['one']});
 f.changeAccount();f.resolve();await assert.rejects(pending,/compte a changé/);assert.equal(f.cache.invalidations,0);assert.deepEqual(f.events,[]);
});
