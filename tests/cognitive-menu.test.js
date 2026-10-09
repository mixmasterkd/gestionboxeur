import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountCognitiveMenu } from '../js/cognitive-menu.js';
import { mountCognitiveGames } from '../js/cognitive-games.js';
import { createDemoCognitiveRecordStore } from '../js/cognitive-records.js';
test('the game host starts empty, selects directly and keeps exit guards and the reaction clock independent', async () => {
  const window = new Window(), host = window.document.createElement('div'); window.document.body.append(host);
  let received, ticks = 0, released = 0, allow = true;
  const child = () => ({ tick() { ticks++; }, canLeave() { return allow; }, destroy() { released++; } });
  const menu = mountCognitiveMenu(host, { autoTick: true,
    loadCognitive: async () => ({ mountCognitiveGames(_, options) { received = options; return child(); } }),
    loadReaction: async () => ({ mountReactionGame(_, options) { received = options; return child(); } }),
  });
  try {
    assert.equal(host.childElementCount, 0); assert.equal(menu.getSelection(), null); assert.equal(menu.back, undefined);
    await menu.select('bag'); assert.equal(received.initialVariant, 'bag'); menu.tick(); assert.equal(ticks, 1);
    assert.equal(host.querySelector('.cognitive-game-back'), null); assert.equal(host.querySelector('.cognitive-menu'), null);
    allow = false; assert.equal(await menu.select('reaction'), false); assert.equal(released, 0); assert.equal(menu.getSelection(), 'bag');
    allow = true; assert.equal(await menu.select('reaction'), true); assert.equal(released, 1);
    assert.equal(received.autoTick, true); menu.tick(); assert.equal(ticks, 1, 'parent loop does not measure reaction');
  } finally { menu.destroy(); await window.happyDOM.abort(); }
});
test('a late game import cannot replace a different game or mount after teardown', async () => {
  const window = new Window(), host = window.document.createElement('div'); let resolve, mounts = 0;
  const loading = new Promise(done => { resolve = done; });
  const menu = mountCognitiveMenu(host, { loadCognitive: () => loading, loadReaction: async () => ({ mountReactionGame(target) { target.textContent = 'Reaction'; return { destroy() {} }; } }) });
  try {
    const pending = menu.select('tiles'); await menu.select('reaction'); resolve({ mountCognitiveGames() { mounts++; } }); await pending;
    assert.equal(mounts, 0); assert.match(host.textContent, /Reaction/); menu.destroy(); assert.equal(host.childElementCount, 0);
  } finally { await window.happyDOM.abort(); }
});
test('Tuiles and Sac open directly without intermediate cards or return controls', async () => {
  const window = new Window(), host = window.document.createElement('div'); window.document.body.append(host);
  window.WebGL2RenderingContext = undefined;
  window.localStorage.setItem('gestionboxeur:cognitive:v1:owner', JSON.stringify({ variant: 'bag', count: 8, mode: 'targets', sound: false }));
  const menu = mountCognitiveMenu(host, { ownerId: 'owner', storage: window.localStorage, now: () => 0, autoTick: false, cognitiveStore: createDemoCognitiveRecordStore(), loadCognitive: async () => ({ mountCognitiveGames }) });
  try {
    await menu.select('tiles');
    assert.equal(host.querySelector('#cognitiveGameTitle').textContent, 'Tuiles'); assert.equal(host.querySelectorAll('.cognitive-tile').length, 8);
    assert.equal(host.querySelector('[data-variant] button[data-variant]'), null); assert.equal(host.querySelector('[role=tablist]'), null);
    assert.equal(host.querySelector('#cognitiveBagSettings').hidden, true);
    assert.equal(host.querySelector('.cognitive-game-back'), null); assert.equal(host.querySelector('.cognitive-game-card'), null);
    await menu.select('bag'); assert.equal(host.querySelector('#cognitiveGameTitle').textContent, 'Sac');
    assert.equal(host.querySelectorAll('.cognitive-fallback-zone').length, 6); assert.equal(host.querySelector('#cognitiveTileSettings').hidden, true);
    assert.equal(host.querySelector('button[data-mode=targets]').getAttribute('aria-pressed'), 'true'); assert.equal(host.querySelector('[role=tablist]'), null);
    assert.equal(host.querySelector('.cognitive-game-back'), null); assert.equal(host.querySelector('.cognitive-game-card'), null);
  } finally { menu.destroy(); await window.happyDOM.abort(); }
});

test('mental games receive a direct mode with no legacy back callback', async () => {
  const window=new Window(),host=window.document.createElement('div'),modes=[],selections=[];
  const menu=mountCognitiveMenu(host,{onSelection:id=>selections.push(id),loadMental:async()=>({mountMentalGame(target,options){modes.push(options);target.textContent=options.mode;return {destroy(){target.replaceChildren();}};}})});
  try {
    await menu.select('visual-memory');await menu.select('dual-task');
    assert.deepEqual(modes.map(options=>options.mode),['visual-memory','dual-task']);
    assert.equal(modes.some(options=>'onBack' in options),false);
    assert.deepEqual(selections,['visual-memory','dual-task']);
    assert.equal(host.querySelector('button'),null);
    assert.equal(await menu.select('unknown'),false);assert.equal(menu.getSelection(),'dual-task');
  }finally{menu.destroy();await window.happyDOM.abort();}
});

test('a failed import offers a local retry without emitting another selection or restarting the same game', async () => {
  const window=new Window(),host=window.document.createElement('div');window.document.body.append(host);
  let attempts=0,mounts=0;const selections=[];
  const menu=mountCognitiveMenu(host,{onSelection:id=>selections.push(id),loadCognitive:async()=>{attempts++;if(attempts===1)throw new Error('Hors ligne');return {mountCognitiveGames(target){mounts++;target.textContent='Tuiles prêtes';return {destroy(){}};}};}});
  try {
    assert.equal(await menu.select('tiles'),true);assert.match(host.querySelector('[role=alert]').textContent,/Réessaie/);
    assert.equal(host.querySelector('.cognitive-game-card'),null);
    assert.equal(await menu.select('tiles'),true);assert.equal(attempts,1);
    const retry=host.querySelector('button');assert.equal(retry.textContent,'Réessayer');retry.click();retry.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(attempts,2);assert.equal(mounts,1);assert.equal(host.textContent,'Tuiles prêtes');assert.deepEqual(selections,['tiles']);
    await menu.select('tiles');assert.equal(mounts,1);
  }finally{menu.destroy();await window.happyDOM.abort();}
});

test('a stale retry cannot leave a newer active game or mount anything after teardown', async () => {
  const window=new Window(),host=window.document.createElement('div');window.document.body.append(host);
  let attempts=0,released=0;
  const menu=mountCognitiveMenu(host,{loadCognitive:async()=>{attempts++;throw new Error('Hors ligne');},loadReaction:async()=>({mountReactionGame(target){target.textContent='Réaction active';return {canLeave:()=>false,destroy(){released++;}};}})});
  try {
    await menu.select('tiles');const retry=host.querySelector('button');await menu.select('reaction');
    retry.click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(attempts,1);assert.equal(released,0);assert.equal(menu.getSelection(),'reaction');assert.equal(host.textContent,'Réaction active');
    assert.equal(await menu.select('bag'),false);assert.equal(released,0);
    menu.destroy();retry.click();assert.equal(attempts,1);assert.equal(released,1);assert.equal(host.childElementCount,0);
    assert.equal(await menu.select('tiles'),false);
  }finally{menu.destroy();await window.happyDOM.abort();}
});

test('late activity and late imports are ignored after switching or destroying the game host', async () => {
  const window=new Window(),host=window.document.createElement('div');
  const activity=[];let oldActivity,ticks=0,resolveMental,mounted=0;
  const menu=mountCognitiveMenu(host,{autoTick:false,onActivity:active=>activity.push(active),loadCognitive:async()=>({mountCognitiveGames(_target,options){oldActivity=options.onActivity;return {tick(){ticks++;},destroy(){}};}}),loadMental:()=>new Promise(resolve=>{resolveMental=resolve;})});
  try {
    await menu.select('tiles');menu.tick();assert.equal(ticks,1);
    const pending=menu.select('dual-task');const count=activity.length;oldActivity(true);assert.equal(activity.length,count);
    menu.destroy();menu.tick();assert.equal(ticks,1);
    resolveMental({mountMentalGame(){mounted++;}});assert.equal(await pending,false);assert.equal(mounted,0);assert.equal(host.childElementCount,0);
    assert.equal(menu.canLeave(),true);
  }finally{menu.destroy();await window.happyDOM.abort();}
});
