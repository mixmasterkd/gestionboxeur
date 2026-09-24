import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(responder) {
 const w=new Window({url:'https://example.test/roster.html'}),calls=[];let sheets=0;
 const ui=(await readFile(new URL('../js/ui.js',import.meta.url),'utf8')).replace(/^export /gm,'');
 const source=(await readFile(new URL('../js/roster-add.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replace(/^export /gm,'');
 w.__client={rpc:async(name,args)=>{calls.push([name,args]);return {data:await responder(name,args),error:null};}};
 w.__sheet=()=>{sheets++;};w.eval(`${ui}\n${source}\nwindow.__add=createAthleteAddUI({client:window.__client,getUserId:()=> 'coach',onCreateSheet:window.__sheet});`);
 const click=text=>{const b=[...w.document.querySelectorAll('button')].find(el=>el.textContent===text||el.getAttribute('aria-label')===text);assert.ok(b,text);b.click();};
 return {w,calls,click,sheets:()=>sheets,submit:()=>{w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}};
}
test('add athlete separates roster sheet from name search and explicit invitation',async()=>{
 const f=await fixture(async name=>name==='my_coaching_invitations'?[]:name==='search_athletes'?[{athlete_id:'a',display_name:'Alex <script>',connection_status:'available'},{athlete_id:'b',display_name:'Alex Autre',connection_status:'available'}]:'invitation');
 try{
  f.w.__add.open();f.click('Créer une fiche');assert.equal(f.sheets(),1);assert.equal(f.w.document.querySelector('dialog').open,false);
  f.w.__add.open();f.click('Inviter un athlète');f.w.document.querySelector('[name=athlete_search]').value='Alex';f.submit();await settle();
  assert.equal(f.w.document.querySelector('script'),null);assert.match(f.w.document.body.textContent,/Alex <script>/);
  assert.equal(f.calls.filter(c=>c[0]==='invite_athlete').length,0);
  f.click('Inviter Alex Autre');await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c=>c[0]==='invite_athlete')[1])),{p_athlete_id:'b'});
  assert.match(f.w.document.body.textContent,/après son acceptation/);assert.equal(f.sheets(),1);
 }finally{await f.w.happyDOM.abort();}
});
test('changing searched name or email invalidates the result and never sends the wrong invitation',async()=>{
 let release;const result=new Promise(r=>{release=r;});
 const f=await fixture(async name=>name==='my_coaching_invitations'?[]:result);
 try{
  f.w.__add.open();f.click('Inviter un athlète');const email=f.w.document.querySelector('[name=athlete_search]');email.value='first@example.test';f.submit();
  email.value='second@example.test';email.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  release([{display_name:'First',connection_status:'available'}]);await settle();
  assert.doesNotMatch(f.w.document.body.textContent,/First|Envoyer l’invitation/);assert.equal(f.calls.filter(c=>c[0]==='invite_athlete').length,0);
 }finally{await f.w.happyDOM.abort();}
});
