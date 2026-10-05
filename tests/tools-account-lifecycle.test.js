import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
const source=await readFile(new URL('../js/tools-page.js',import.meta.url),'utf8');
const html=await readFile(new URL('../tools.html',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({pending=false}={}){
 const window=new Window({url:'https://example.test/tools.html',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});window.document.write(html);
 let authChange, resolveAccount, destroyed=0;const mounts=[];
 window.__client={auth:{getSession:async()=>({data:{session:{user:{id:'owner-a',email:'a@example.test'}}}}),onAuthStateChange(fn){authChange=fn;},signOut:async()=>({data:null})}};
 window.__loadAccount=async()=>pending?new Promise(resolve=>resolveAccount=resolve):{profile:{full_name:'A',account_type:'coach'},gym:null};
 window.__mount=(root,options)=>{mounts.push(options.ownerId);return{destroy(){destroyed++;root.replaceChildren();}};};
 window.eval(source.replace(/^import .*;\s*$/gm,'')
  .replace('const $ =','const client=window.__client,loadAccount=window.__loadAccount,result=async p=>(await p).data,isDemo=false,createToolStore=()=>({}),createDemoToolStore=()=>({}),createCognitiveRecordStore=()=>({}),createDemoCognitiveRecordStore=()=>({}),createReactionRecordStore=()=>({}),createDemoReactionRecordStore=()=>({}),mountNavigation=()=>{},mountTools=window.__mount;const $ ='));
 return{window,mounts,get destroyed(){return destroyed},event:(e,s)=>authChange(e,s),resolve:()=>resolveAccount?.({profile:{full_name:'A',account_type:'coach'},gym:null})};
}
test('same-account refresh keeps tools while a different account clears old UI and reloads a fresh page',async()=>{
 const f=fixture();try{await settle();assert.deepEqual(f.mounts,['owner-a']);f.event('SIGNED_IN',{user:{id:'owner-a'}});assert.equal(f.destroyed,0);
  f.event('SIGNED_IN',{user:{id:'owner-b'}});assert.equal(f.destroyed,1);assert.equal(f.window.document.getElementById('toolsApp').hidden,true);assert.equal(f.window.document.getElementById('accountName').textContent,'');assert.equal(f.window.location.pathname,'/tools.html');
 }finally{await f.window.happyDOM.abort();}
});
test('account switch invalidates an old account lookup before it can mount scores',async()=>{
 const f=fixture({pending:true});try{await settle();f.event('SIGNED_IN',{user:{id:'owner-b'}});f.resolve();await settle();assert.deepEqual(f.mounts,[]);}finally{await f.window.happyDOM.abort();}
});
test('sign-out destroys tools and clears account identity before returning to login',async()=>{
 const f=fixture();try{await settle();f.event('SIGNED_OUT',null);assert.equal(f.destroyed,1);assert.equal(f.window.location.pathname,'/login.html');assert.equal(f.window.document.getElementById('accountName').textContent,'');}finally{await f.window.happyDOM.abort();}
});
