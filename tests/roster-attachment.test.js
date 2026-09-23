import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createRosterAttachmentUI } from '../js/roster-attachment.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const free=()=>({id:'free',userId:null,firstName:'Alex',lastName:'Martin',birthDate:'2001-04-12',sex:'M',weightKg:70,fights:5,wins:3,losses:2,note:'Note libre',updatedAt:'free-v1',relationUpdatedAt:'free-link-v1'});
const registered=()=>({id:'registered',userId:'athlete-user',firstName:'Alex',lastName:'Martin',birthDate:'2001-04-12',sex:'M',weightKg:72,fights:10,wins:6,losses:4,note:'Note du compte',updatedAt:'registered-v1',relationUpdatedAt:'registered-link-v1'});
function fixture({athletes=[free(),registered()],userId='coach',mode='modern',merge,refresh}={}){
  const window=new Window({url:'https://example.test/boxing/'}),doc=window.document;
  const context={userId,mode,athletes};
  const calls={merge:[],invite:[],refresh:0,toast:[]};
  const ui=createRosterAttachmentUI({document:doc,getContext:()=>context,
    store:{mergeAthletes:async(...args)=>{calls.merge.push(args);return merge?.(...args);}},
    onInvite:source=>calls.invite.push(source),onRefresh:async()=>{calls.refresh++;await refresh?.();},onToast:message=>calls.toast.push(message)});
  const change=(selector,value)=>{const control=doc.querySelector(selector);assert.ok(control,selector);if(control.type==='checkbox')control.checked=value;else control.value=value;control.dispatchEvent(new window.Event('change',{bubbles:true}));return control;};
  const submit=()=>doc.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const ready=()=>{change('#rosterLinkTarget','registered');change('[data-choice="weight"]','source');change('[data-choice="record"]','target');change('#rosterLinkConfirm',true);};
  return {window,doc,context,calls,ui,change,submit,ready,button:()=>doc.querySelector('button[type="submit"]'),dialog:()=>doc.querySelector('.roster-link-dialog'),close:async()=>{try{ui.invalidate();}finally{await window.happyDOM.abort();}}};
}

test('opening attachment is read-only and matching names never select or merge automatically',async()=>{
  const page=fixture();
  try{
    page.ui.open('free');
    assert.equal(page.dialog().open,true);assert.equal(page.doc.querySelector('#rosterLinkTarget').value,'');
    assert.equal(page.button().disabled,true);assert.equal(page.doc.querySelector('.roster-link-comparison'),null);
    assert.equal(page.doc.querySelectorAll('#rosterLinkTarget option').length,2);
    assert.equal(page.calls.merge.length,0);assert.equal(page.calls.invite.length,0);assert.equal(page.calls.refresh,0);
    page.submit();await tick();assert.equal(page.calls.merge.length,0);
    page.change('#rosterLinkTarget','registered');
    assert.equal(page.doc.querySelectorAll('.roster-link-comparison > section').length,2);
    assert.equal(page.calls.merge.length,0);assert.equal(page.calls.invite.length,0);
  }finally{await page.close();}
});

test('invitation occurs only through the explicit invitation button',async()=>{
  const page=fixture();
  try{
    page.ui.open('free');assert.equal(page.calls.invite.length,0);
    page.doc.querySelector('[data-action="invite"]').click();await tick();
    assert.equal(page.calls.invite.length,1);assert.equal(page.calls.invite[0].id,'free');
    assert.equal(page.calls.merge.length,0);assert.equal(page.calls.refresh,0);assert.equal(page.dialog(),null);
  }finally{await page.close();}
});

test('conflicting weight and record plus explicit identity confirmation are required before merging',async()=>{
  const page=fixture();
  try{
    page.ui.open('free');page.change('#rosterLinkTarget','registered');
    assert.equal(page.button().disabled,true);page.submit();await tick();assert.equal(page.calls.merge.length,0);
    page.change('[data-choice="weight"]','source');page.change('#rosterLinkConfirm',true);
    assert.equal(page.button().disabled,true);page.submit();await tick();assert.equal(page.calls.merge.length,0);
    page.change('[data-choice="record"]','target');page.change('#rosterLinkConfirm',false);
    assert.equal(page.button().disabled,true);page.submit();await tick();assert.equal(page.calls.merge.length,0);
    page.change('#rosterLinkConfirm',true);assert.equal(page.button().disabled,false);
    page.submit();await tick();
    assert.equal(page.calls.merge.length,1);assert.deepEqual(page.calls.merge[0][2],{weight:'source',record:'target'});
    assert.equal(page.calls.refresh,1);assert.match(page.calls.toast[0],/Fiche rattachée/);assert.equal(page.dialog(),null);
  }finally{await page.close();}
});

test('merge passes the versions displayed at opening even when live rows refresh later',async()=>{
  const page=fixture();
  try{
    page.ui.open('free');page.ready();
    Object.assign(page.context.athletes[0],{updatedAt:'free-v2',relationUpdatedAt:'free-link-v2',weightKg:80});
    Object.assign(page.context.athletes[1],{updatedAt:'registered-v2',relationUpdatedAt:'registered-link-v2',weightKg:90});
    page.submit();await tick();
    const [source,target]=page.calls.merge[0];
    assert.equal(source.updatedAt,'free-v1');assert.equal(source.relationUpdatedAt,'free-link-v1');assert.equal(source.weightKg,70);
    assert.equal(target.updatedAt,'registered-v1');assert.equal(target.relationUpdatedAt,'registered-link-v1');assert.equal(target.weightKg,72);
    assert.notEqual(source,page.context.athletes[0]);assert.notEqual(target,page.context.athletes[1]);
  }finally{await page.close();}
});

test('an in-flight merge disables its choices and rejects duplicate submissions',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const page=fixture({merge:()=>pending});
  try{
    page.ui.open('free');page.ready();page.submit();page.submit();await tick();
    assert.equal(page.calls.merge.length,1);assert.equal(page.button().disabled,true);
    assert.ok([...page.doc.querySelectorAll('form input, form select, [data-action="invite"]')].every(control=>control.disabled));
    assert.equal(page.calls.refresh,0);
    release();await tick();assert.equal(page.calls.refresh,1);assert.equal(page.calls.toast.length,1);
  }finally{release();await page.close();}
});

test('HTML-like athlete content is shown as text in the title, candidates and comparison',async()=>{
  const source={...free(),firstName:'<img src=x onerror=alert(1)>'};
  const target={...registered(),lastName:'<script>danger()</script>',birthDate:'<svg onload=alert(1)>'};
  const page=fixture({athletes:[source,target]});
  try{
    page.ui.open('free');page.change('#rosterLinkTarget','registered');
    assert.equal(page.doc.querySelector('img,script,svg'),null);
    assert.match(page.doc.querySelector('#rosterLinkTitle').textContent,/<img src=x/);
    assert.match(page.doc.querySelector('#rosterLinkTarget').textContent,/<script>danger/);
    assert.match(page.doc.querySelector('.roster-link-comparison').textContent,/<svg onload/);
  }finally{await page.close();}
});

test('a merge failure preserves the dialog, selections and retry controls',async()=>{
  const page=fixture({merge:async()=>{throw new Error('La fiche a changé. Recharge les données.');}});
  try{
    page.ui.open('free');page.ready();page.submit();await tick();
    assert.equal(page.dialog().open,true);assert.equal(page.doc.querySelector('[role="alert"]').hidden,false);
    assert.match(page.doc.querySelector('[role="alert"]').textContent,/fiche a changé/);
    assert.equal(page.doc.querySelector('[data-choice="weight"]').value,'source');assert.equal(page.doc.querySelector('[data-choice="record"]').value,'target');
    assert.equal(page.doc.querySelector('#rosterLinkConfirm').checked,true);assert.equal(page.button().disabled,false);
    assert.equal(page.calls.refresh,0);assert.equal(page.calls.toast.length,0);
  }finally{await page.close();}
});

test('successful mutation followed by failed refresh reports the saved attachment without offering another merge',async()=>{
  const page=fixture({refresh:async()=>{throw new Error('Hors ligne');}});
  try{
    page.ui.open('free');page.ready();page.submit();await tick();
    assert.equal(page.calls.merge.length,1);assert.equal(page.calls.refresh,1);assert.equal(page.dialog(),null);
    assert.match(page.calls.toast[0],/Rattachement enregistré.*Recharge/);
  }finally{await page.close();}
});

test('logout invalidation removes the dialog and ignores late success and late errors',async()=>{
  for(const fails of [false,true]){
    let resolve,reject;
    const pending=new Promise((done,failed)=>{resolve=done;reject=failed;});
    const page=fixture({merge:()=>pending});
    try{
      page.ui.open('free');page.ready();page.submit();assert.equal(page.calls.merge.length,1);
      page.context.userId=null;page.context.athletes=[];page.ui.invalidate();
      assert.equal(page.dialog(),null);
      if(fails)reject(new Error('Réponse tardive'));else resolve();
      await tick();assert.equal(page.calls.refresh,0);assert.equal(page.calls.toast.length,0);assert.equal(page.doc.querySelector('[role="alert"]'),null);
    }finally{resolve();await page.close();}
  }
});

test('a late saved merge refreshes the same coach table without closing or notifying a replacement dialog',async()=>{
  let release;
  const page=fixture({merge:()=>new Promise(resolve=>{release=resolve;})});
  try{
    page.ui.open('free');page.ready();page.submit();
    const previous=page.dialog();page.ui.open('free');
    assert.notEqual(page.dialog(),previous);assert.equal(previous.isConnected,false);
    release();await tick();
    assert.equal(page.dialog().open,true);assert.equal(page.calls.refresh,1);assert.equal(page.calls.toast.length,0);
    assert.equal(page.doc.querySelector('#rosterLinkTarget').value,'');
  }finally{release?.();await page.close();}
});

test('without linked candidates the coach-code guidance is available but confirmation stays disabled',async()=>{
  const page=fixture({athletes:[free()]});
  try{
    page.ui.open('free');assert.equal(page.doc.querySelector('#rosterLinkTarget').disabled,true);
    assert.equal(page.button().disabled,true);assert.match(page.dialog().textContent,/code coach/);
    assert.equal(page.doc.querySelector('a').href,'https://example.test/boxing/planning.html?coachs=1');
    page.change('#rosterLinkConfirm',true);page.submit();await tick();
    assert.equal(page.button().disabled,true);assert.equal(page.calls.merge.length,0);assert.equal(page.calls.invite.length,0);
  }finally{await page.close();}
});

test('identical values need no conflict choice, but still require selecting the account and confirming identity',async()=>{
  const page=fixture({athletes:[free(),{...registered(),weightKg:70,fights:5,wins:3,losses:2}]});
  try{
    page.ui.open('free');page.change('#rosterLinkTarget','registered');
    assert.equal(page.doc.querySelector('[data-choice]'),null);assert.equal(page.button().disabled,true);
    page.change('#rosterLinkConfirm',true);page.submit();await tick();
    assert.deepEqual(page.calls.merge[0][2],{weight:'target',record:'target'});
  }finally{await page.close();}
});

test('changing the chosen account resets confirmation and conflict resolutions',async()=>{
  const other={...registered(),id:'second',userId:'another-athlete',firstName:'Sam'};
  const page=fixture({athletes:[free(),registered(),other]});
  try{
    page.ui.open('free');page.ready();assert.equal(page.button().disabled,false);
    page.change('#rosterLinkTarget','second');
    assert.equal(page.doc.querySelector('#rosterLinkConfirm').checked,false);assert.equal(page.doc.querySelector('[data-choice="weight"]').value,'');
    assert.equal(page.button().disabled,true);page.submit();await tick();assert.equal(page.calls.merge.length,0);
  }finally{await page.close();}
});

test('removed or rebound athletes cannot be merged through an already open dialog',async()=>{
  const page=fixture();
  try{
    page.ui.open('free');page.ready();page.context.athletes[1].userId='a-different-account';page.submit();await tick();
    assert.equal(page.calls.merge.length,0);assert.match(page.doc.querySelector('[role="alert"]').textContent,/fiches ont changé/);assert.equal(page.dialog().open,true);
  }finally{await page.close();}
});

test('legacy, signed-out and registered-source contexts cannot open attachment',async()=>{
  for(const options of [{mode:'legacy'},{userId:null},{}]){
    const page=fixture(options);
    try{page.ui.open(Object.keys(options).length?'free':'registered');assert.equal(page.dialog(),null);assert.equal(page.calls.merge.length,0);assert.equal(page.calls.invite.length,0);}finally{await page.close();}
  }
});
