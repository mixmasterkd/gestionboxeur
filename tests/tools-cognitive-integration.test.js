import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { mountTools } from '../js/tools.js';
import { mountCognitiveGames } from '../js/cognitive-games.js';
import { createDemoCognitiveRecordStore } from '../js/cognitive-records.js';
const html=await readFile(new URL('../tools.html',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function fixture(options={}) {
  const window=new Window({url:'https://example.test/tools.html',settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  window.document.write(html); window.confirm = () => true;window.localStorage.setItem('gestionboxeur:cognitive:v1:owner-a',JSON.stringify({sound:false}));
  let time=0;const store=createDemoCognitiveRecordStore();
  const ui=mountTools(window.document.getElementById('toolsApp'),{now:()=>time,autoTick:false,ownerId:'owner-a',cognitiveStore:store,loadCognitive:async()=>({mountCognitiveGames:(host,settings)=>mountCognitiveGames(host,{...settings,random:()=>0})}),...options});
  return {window,ui,store,$:id=>window.document.getElementById(id),advance(ms){time+=ms;ui.tick();},async close(){ui.destroy();await window.happyDOM.abort();}};
}
test('games open from actual tools, save a personal best and leave existing boxing tools operational',async()=>{
  const f=fixture();try{
    await f.ui.navigate({tool:'cognitive',game:'tiles'});await settle();
    assert.equal(f.$('toolTitle').textContent,'Tuiles');assert.equal(f.$('cognitiveSound').checked,false);
    f.$('cognitiveStart').click();for(let i=0;i<16;i++)f.advance(100);
    f.window.document.querySelector('.cognitive-tile[data-index="0"]').click();
    for(let i=0;i<34;i++)f.advance(100);
    f.window.document.querySelector('.cognitive-tile[data-index="1"]').click();await settle();
    assert.deepEqual(await f.store.listRecords(),[{mode:'tiles-6',score:1}]);
    f.ui.navigate({tool:'steps'});assert.ok(f.$('stepTap'));
    f.ui.select('boxing');assert.ok(f.$('timerStart'));f.$('timerStart').click();f.advance(500);
    assert.equal(f.$('timerBoard').dataset.status,'running');f.$('timerReset').click();
    await f.ui.select('cognitive');await settle();assert.equal(f.$('cognitiveRecord').textContent,'1');
  }finally{await f.close();}
});
test('active game respects leave confirmation and releases its screen lock when stopped',async()=>{
  let requests=0,releases=0;const f=fixture();try{
    Object.defineProperty(f.window.navigator,'wakeLock',{value:{async request(){requests++;return {addEventListener(){},async release(){releases++;}};}}});
    await f.ui.select('cognitive');await settle();f.$('cognitiveStart').click();await settle();assert.equal(requests,1);
    f.window.confirm=()=>false;f.ui.navigate({tool:'steps'});assert.ok(f.$('cognitiveStart'));assert.equal(releases,0);
    f.window.confirm=()=>true;f.ui.navigate({tool:'steps'});await settle();assert.equal(releases,1);assert.equal(f.$('cognitiveStart'),null);
  }finally{await f.close();}
});
test('late game loading cannot replace a different tool or survive teardown',async()=>{
  const load=deferred();let mounts=0;const f=fixture({loadCognitive:()=>load.promise});
  try{f.ui.select('cognitive');f.ui.select('steps');load.resolve({mountCognitiveGames(){mounts++;}});await settle();assert.equal(mounts,0);assert.ok(f.$('stepTap'));}finally{await f.close();}
});
