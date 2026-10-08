import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileSessionTimer, configureSessionIntervals } from '../js/session-timer-program.js';
import { SessionTimer } from '../js/session-timer-engine.js';
import { mountSessionTimer } from '../js/session-timer.js';
import { makeBlock, ZONE_COLORS } from '../js/domain.js';
import { chooseMonthPreviews } from '../js/month-previews.js';
const session = text => ({ id:'workout', title:'Entraînement QA', sport:'boxing', workout_document:{text} });
const mixed = '2 rounds\n- Push-up 10x\n- Repos 60s\n\n- Course 400mtr\n- Sac 30s @ Z4 - Garder les mains hautes';

test('session playback follows source text and preserves timed/manual doses, rounds, colors and instructions',()=>{
  const source={...session(mixed),blocks:[{...makeBlock('run'),duration_seconds:999}]},before=structuredClone(source);
  const program=compileSessionTimer(source);
  assert.equal(program.phases.length,6);assert.equal(program.timedSeconds,150);assert.equal(program.manualSteps,3);
  assert.deepEqual(program.phases.map(p=>p.seconds),[null,60,null,60,null,30]);
  assert.equal(program.phases[0].name,'Push-up');assert.equal(program.phases[0].objective,'10 répétitions');
  assert.equal(program.phases[2].repetition,'Round 2/2');assert.equal(program.phases[4].objective,'400 m');
  assert.equal(program.phases[5].color,ZONE_COLORS[4]);assert.equal(program.phases[5].instruction,'Garder les mains hautes');
  assert.deepEqual(source,before);
});
test('legacy compact rounds retain only their actual rests without copying movement doses into rest',()=>{
  const source={title:'Ancienne séance',blocks:[{...makeBlock('bag'),rounds:3,work_seconds:60,rest_seconds:20,duration_seconds:999,repetitions:10,description:'Jab'}]};
  const program=compileSessionTimer(source);
  assert.deepEqual(program.phases.map(p=>p.seconds),[60,20,60,20,60]);assert.equal(program.timedSeconds,220);
  assert.equal(program.phases[1].name,'Repos');assert.equal(program.phases[1].objective,'');assert.equal(program.phases[1].instruction,'');
});
test('free prose gets a manual chronometer and stale saved blocks never reappear',()=>{
  const program=compileSessionTimer({...session('Technique libre\nPrévoir les gants.'),blocks:[{...makeBlock('bag'),duration_seconds:90}]});
  assert.equal(program.phases.length,1);assert.equal(program.manualSteps,1);assert.equal(program.timedSeconds,0);
  assert.equal(program.phases[0].instruction,'Technique libre\nPrévoir les gants.');
  assert.equal(compileSessionTimer({title:'Libre',notes:'Respirer calmement.'}).phases[0].instruction,'Respirer calmement.');
});
test('invalid programming blocks playback rather than silently dropping an exercise',()=>{
  assert.throws(()=>compileSessionTimer(session('- Sac -30s')),/Corrige/);
  assert.throws(()=>compileSessionTimer(session('2 rounds\n\n- Sac 30s')),/Corrige/);
  assert.throws(()=>compileSessionTimer({blocks:[{...makeBlock(),duration_seconds:Infinity}]}),/invalide/);
  assert.throws(()=>compileSessionTimer({workout_document:{text:null}}),/invalide/);
});
test('unknown/custom efforts and explicit duration plus repetitions do not invent conversions',()=>{
  const p=compileSessionTimer({blocks:[{...makeBlock(),title:'Push-up',repetitions:10,duration_seconds:45,effort:{kind:'custom',label:'Technique'}},{...makeBlock('run'),distance_m:400}]});
  assert.equal(p.phases[0].seconds,45);assert.equal(p.phases[0].objective,'10 répétitions');assert.equal(p.phases[1].seconds,null);
  assert.equal(p.phases[0].label,'Technique');
});
test('chosen intervals preserve structured order, repetitions and colors without altering the workout',()=>{
  const source=session('3 rounds\n- Push-up 10x @ Z4\n- Course 400mtr'),before=structuredClone(source);
  const original=compileSessionTimer(source),saved=structuredClone(original);
  const configured=configureSessionIntervals(original,{workSeconds:45,restSeconds:15,rounds:99});
  assert.equal(original.freeform,false);assert.equal(configured.phases.length,11);assert.equal(configured.timedSeconds,345);assert.equal(configured.manualSteps,0);
  assert.deepEqual(configured.phases.filter(p=>p.kind==='work').map(p=>[p.name,p.repetition]),original.phases.map(p=>[p.name,p.repetition]));
  assert.equal(configured.phases[0].color,ZONE_COLORS[4]);assert.equal(configured.phases.at(-1).kind,'work');
  assert.ok(configured.phases.every(p=>p.seconds===(p.kind==='work'?45:15)&&!p.manual));
  assert.deepEqual(original,saved);assert.deepEqual(source,before);
});
test('explicit untimed rests keep their place without doubling, and zero rest retains every effort',()=>{
  const original=compileSessionTimer({blocks:[{...makeBlock('repeat'),repeat_count:2,children:[{...makeBlock('strength'),title:'Push-up',repetitions:10},{...makeBlock('recovery'),title:'Repos'}]}]});
  const configured=configureSessionIntervals(original,{workSeconds:30,restSeconds:10});
  assert.deepEqual(configured.phases.map(p=>[p.kind,p.seconds]),[['work',30],['rest',10],['work',30],['rest',10]]);
  const continuous=configureSessionIntervals(original,{workSeconds:30,restSeconds:0});
  assert.deepEqual(continuous.phases.map(p=>p.kind),['work','work']);assert.equal(continuous.timedSeconds,60);assert.equal(original.phases.length,4);
});
test('legacy rounds without work duration retain their count and any prescribed recovery',()=>{
  const block={...makeBlock('bag'),rounds:3,repetitions:10};
  const original=compileSessionTimer({blocks:[block]});
  assert.equal(original.phases.length,3);assert.equal(original.timedSeconds,0);assert.equal(original.phases.at(-1).repetition,'Round 3/3');
  const configured=configureSessionIntervals(original,{workSeconds:45,restSeconds:15});
  assert.deepEqual(configured.phases.map(p=>p.seconds),[45,15,45,15,45]);
  const recovery=compileSessionTimer({blocks:[{...block,rest_seconds:20}]});
  assert.deepEqual(recovery.phases.map(p=>p.seconds),[null,20,null,20,null]);
  assert.throws(()=>configureSessionIntervals(recovery,{workSeconds:45,restSeconds:15}),/sans durée/);
});
test('free prose uses the chosen interval count and adds no final rest',()=>{
  const original=compileSessionTimer(session('Technique libre.'));
  assert.equal(original.freeform,true);
  const configured=configureSessionIntervals(original,{workSeconds:30,restSeconds:10,rounds:3});
  assert.deepEqual(configured.phases.map(p=>p.seconds),[30,10,30,10,30]);assert.equal(configured.timedSeconds,110);
  assert.equal(configured.phases.at(-1).repetition,'Intervalle 3/3');assert.equal(original.phases[0].manual,true);
  assert.equal(configureSessionIntervals(original,{workSeconds:30,restSeconds:0,rounds:1}).phases.length,1);
});
test('interval configuration rejects invalid values, oversized plans and any existing timed prescription',()=>{
  const free=compileSessionTimer(session('Technique libre.')),valid={workSeconds:45,restSeconds:15,rounds:3};
  for(const workSeconds of [0,-1,NaN,Infinity,1.5,3601,'45'])assert.throws(()=>configureSessionIntervals(free,{...valid,workSeconds}));
  for(const restSeconds of [-1,NaN,Infinity,0.5,3601,'15'])assert.throws(()=>configureSessionIntervals(free,{...valid,restSeconds}));
  for(const rounds of [0,-1,NaN,Infinity,1.5,101])assert.throws(()=>configureSessionIntervals(free,{...valid,rounds}));
  assert.throws(()=>configureSessionIntervals(compileSessionTimer(session(mixed)),valid),/sans durée/);
  const full={...free,freeform:false,phases:Array.from({length:10000},()=>({...free.phases[0]}))};
  assert.throws(()=>configureSessionIntervals(full,valid),/trop d’étapes/);
  const rests=compileSessionTimer({blocks:[{...makeBlock('recovery'),title:'Repos'}]});
  assert.throws(()=>configureSessionIntervals(rests,{...valid,restSeconds:0}),/repos supérieure/);
});
function engine(text){let time=0;const timer=new SessionTimer(compileSessionTimer(session(text)).phases,()=>time);return {timer,advance(ms){time+=ms;return timer.snapshot();}};}
test('throttled timer catches up through timed phases and stops at the first manual phase',()=>{
  const a=engine('- Sac 2s\n- Repos 1s\n- Push-up 10x\n- Sac 4s');a.timer.start();
  const s=a.advance(13000);assert.equal(s.index,2);assert.equal(s.phaseElapsed,10000);assert.equal(s.elapsed,13000);
  assert.equal(s.remaining,null);assert.equal(a.advance(3600000).index,2);
  a.timer.advance();assert.equal(a.timer.snapshot().index,3);assert.equal(a.timer.snapshot().remaining,4000);
});
test('pause/resume excludes paused time and manual advance requires running state',()=>{
  const a=engine('- Push-up 10x\n- Repos 3s');a.timer.start();a.advance(1250);a.timer.pause();a.advance(60000);
  a.timer.advance();assert.equal(a.timer.snapshot().index,0);assert.equal(a.timer.snapshot().phaseElapsed,1250);
  a.timer.start();a.advance(750);a.timer.advance();assert.equal(a.timer.snapshot().elapsed,2000);
  a.timer.advance();assert.equal(a.timer.snapshot().index,1);assert.equal(a.timer.snapshot().remaining,3000);
  assert.equal(a.advance(3000).status,'done');assert.equal(a.advance(9000).elapsed,5000);
});
test('final manual step ends only on deliberate advance, and restart/reset return to the beginning',()=>{
  const a=engine('- Push-up 10x');a.timer.start();assert.equal(a.advance(7200000).status,'running');
  a.timer.advance();assert.equal(a.timer.snapshot().status,'done');assert.equal(a.timer.snapshot().elapsed,7200000);
  a.timer.start();assert.equal(a.timer.snapshot().phaseElapsed,0);a.advance(1500);a.timer.reset();
  assert.equal(a.timer.snapshot().status,'idle');assert.equal(a.timer.snapshot().elapsed,0);
});
test('timed-only playback finishes exactly and does not accumulate overshoot',()=>{
  const a=engine('3x\n- Sac 0,5s\n- Repos 0,5s');a.timer.start();
  assert.equal(a.advance(499).index,0);assert.equal(a.advance(1).index,1);
  const end=a.advance(999999);assert.equal(end.status,'done');assert.equal(end.elapsed,3000);
});
test('invalid timer phase lists are rejected',()=>{
  for(const phases of [[],[{seconds:0}],[{seconds:Infinity}],[{manual:true,seconds:30}]])assert.throws(()=>new SessionTimer(phases));
});
test('month preview reserves room for both sessions and notes, including spanning notes',()=>{
  const sessions=[{id:'s1'},{id:'s2'}],notes=[{id:'n1'},{id:'n2'}];
  assert.deepEqual(chooseMonthPreviews(sessions,notes).map(p=>p.item.id),['s1','n1']);
  assert.deepEqual(chooseMonthPreviews(sessions,notes,1).map(p=>p.item.id),['s1']);
  assert.deepEqual(chooseMonthPreviews([],notes,1).map(p=>p.item.id),['n1']);
  assert.deepEqual(chooseMonthPreviews(sessions,[],0).map(p=>p.item.id),['s1','s2']);
});
function uiFixture(text=mixed){
  const window=new Window({settings:{disableJavaScriptEvaluation:true,disableCSSFileLoading:true}}),doc=window.document;
  const dialog=doc.createElement('dialog');doc.body.append(dialog);let time=0;
  const cues=[],audio={unlock:async()=>true,play:cue=>cues.push(cue),stop(){},destroy(){}};
  window.localStorage.setItem('gestionboxeur:timer-program:v1:owner','unchanged');
  const ui=mountSessionTimer(dialog,session(text),{now:()=>time,autoTick:false,audioFactory:()=>audio});ui.open();
  const $=selector=>dialog.querySelector(selector);
  const pointer=(selector,type,id=1)=>$(selector).dispatchEvent(new window.PointerEvent(type,{pointerType:'touch',pointerId:id,bubbles:true}));
  return {window,doc,dialog,ui,$,pointer,cues,advance(ms){time+=ms;ui.tick();},async close(){ui.destroy();await window.happyDOM.abort();}};
}
test('untimed timer defaults to free mode; timed and mixed programs keep their existing playback',async()=>{
  const free=uiFixture('Technique libre.'),timed=uiFixture('- Sac 30s'),hybrid=uiFixture();
  try{
    assert.equal(free.$('[data-timer-mode="free"]').getAttribute('aria-pressed'),'true');assert.equal(free.$('#sessionTimerSettings').hidden,true);
    free.$('.session-timer-start').click();free.advance(5000);assert.equal(free.$('.timer-digits').textContent,'00:05');assert.equal(free.ui.snapshot().phase.manual,true);
    assert.equal(timed.$('.session-timer-setup'),null);assert.equal(hybrid.$('.session-timer-setup'),null);
  }finally{await free.close();await timed.close();await hybrid.close();}
});
test('invalid settings cannot launch an old plan, and switching to free mode restores manual steps',async()=>{
  const a=uiFixture('- Push-up 10x\n- Course 400mtr');
  try{
    a.$('[data-timer-mode="intervals"]').click();assert.equal(a.$('[name="rounds"]'),null);assert.equal(a.ui.snapshot().remaining,45000);
    const work=a.$('[name="workSeconds"]');work.value='';work.dispatchEvent(new a.window.Event('input',{bubbles:true}));
    assert.equal(a.$('.session-timer-start').disabled,true);assert.equal(a.$('#timerFocusOpen').disabled,true);assert.match(a.$('.session-timer-config-error').textContent,/Effort/);
    a.$('.session-timer-start').click();assert.equal(a.ui.snapshot().status,'idle');
    work.value='20';work.dispatchEvent(new a.window.Event('input',{bubbles:true}));assert.equal(a.$('.session-timer-start').disabled,false);assert.equal(a.ui.snapshot().remaining,20000);
    a.$('[data-timer-mode="free"]').click();assert.equal(a.ui.snapshot().remaining,null);assert.equal(a.ui.snapshot().phase.manual,true);assert.equal(a.$('.session-timer-summary').textContent,'2 étapes libres · passage manuel');
    a.$('[data-timer-mode="intervals"]').click();assert.equal(a.ui.snapshot().remaining,20000);
  }finally{await a.close();}
});
test('configured timer locks settings during playback, resumes on reopen, and can be reconfigured after reset',async()=>{
  const a=uiFixture('Technique libre.');
  try{
    a.$('[data-timer-mode="intervals"]').click();a.$('.session-timer-start').click();a.advance(2000);
    assert.equal(a.$('.session-timer-setup').disabled,true);assert.equal(a.ui.snapshot().remaining,43000);
    a.$('[data-timer-mode="free"]').dispatchEvent(new a.window.MouseEvent('click',{bubbles:true}));assert.equal(a.ui.snapshot().phase.manual,false);
    a.pointer('#timerSessionLock','pointerdown');a.advance(3000);a.pointer('#timerSessionLock','pointerup');
    a.$('.close-button').click();assert.equal(a.ui.snapshot().status,'paused');a.advance(60000);a.ui.open();assert.equal(a.ui.snapshot().remaining,40000);
    a.$('.session-timer-reset').click();assert.equal(a.$('.session-timer-setup').disabled,false);assert.equal(a.ui.snapshot().remaining,45000);
    a.$('[data-timer-mode="free"]').click();assert.equal(a.ui.snapshot().phase.manual,true);
    assert.equal(a.window.localStorage.getItem('gestionboxeur:timer-program:v1:owner'),'unchanged');
  }finally{await a.close();}
});
test('session timer starts fullscreen locked, keeps both reset buttons blocked and preserves free timer settings',async()=>{
  const a=uiFixture();try{
    a.$('.session-timer-start').click();assert.equal(a.$('.timer-board').dataset.sessionLocked,'true');assert.equal(a.$('.timer-board').classList.contains('is-session'),true);
    a.advance(1000);a.$('.session-timer-reset').click();a.$('#timerSessionReset').click();a.$('.close-button').click();a.$('.session-timer-start').click();
    assert.equal(a.ui.snapshot().status,'running');assert.equal(a.ui.snapshot().elapsed,1000);assert.equal(a.dialog.open,true);
    a.dialog.dispatchEvent(new a.window.Event('cancel',{cancelable:true}));assert.equal(a.dialog.open,true);
    assert.equal(a.window.localStorage.getItem('gestionboxeur:timer-program:v1:owner'),'unchanged');
  }finally{await a.close();}
});
test('short/released/cancelled holds never advance; a full hold advances one step while screen stays locked',async()=>{
  const a=uiFixture();try{
    a.$('.session-timer-start').click();
    a.$('.session-timer-advance').click();assert.equal(a.ui.snapshot().index,0);
    a.pointer('.session-timer-advance','pointerdown');a.advance(1999);a.pointer('.session-timer-advance','pointerup');a.advance(100);assert.equal(a.ui.snapshot().index,0);
    a.pointer('.session-timer-advance','pointerdown');a.advance(1000);a.pointer('.session-timer-advance','pointercancel');a.advance(2000);assert.equal(a.ui.snapshot().index,0);
    a.pointer('.session-timer-advance','pointerdown');a.advance(2000);assert.equal(a.ui.snapshot().index,1);assert.equal(a.$('.timer-board').dataset.sessionLocked,'true');
    a.pointer('.session-timer-advance','pointerup');a.$('.session-timer-advance').click();assert.equal(a.ui.snapshot().index,1);
    a.advance(60000);assert.equal(a.ui.snapshot().index,2);a.advance(3000);assert.equal(a.ui.snapshot().index,2);
  }finally{await a.close();}
});
test('keyboard holds advance once; unlock uses three seconds and pause/reset remain functional',async()=>{
  const a=uiFixture();try{
    a.$('.session-timer-start').click();
    a.$('.session-timer-advance').dispatchEvent(new a.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));a.advance(2000);
    assert.equal(a.ui.snapshot().index,1);a.$('.session-timer-advance').dispatchEvent(new a.window.KeyboardEvent('keyup',{key:'Enter',bubbles:true}));
    a.pointer('#timerSessionLock','pointerdown');a.advance(3000);a.pointer('#timerSessionLock','pointerup');assert.equal(a.$('.timer-board').dataset.sessionLocked,'false');
    a.$('#timerSessionToggle').click();assert.equal(a.ui.snapshot().status,'paused');
    a.$('#timerSessionReset').click();assert.equal(a.ui.snapshot().status,'idle');assert.equal(a.ui.snapshot().index,0);
    a.$('#timerSessionClose').click();assert.equal(a.$('.timer-board').classList.contains('is-session'),false);
  }finally{await a.close();}
});
test('hiding or leaving cancels manual holds; destroy removes the active timer and stops playback',async()=>{
  const a=uiFixture();try{
    a.$('.session-timer-start').click();a.pointer('.session-timer-advance','pointerdown');a.advance(1800);
    a.window.dispatchEvent(new a.window.Event('pagehide'));a.advance(2000);assert.equal(a.ui.snapshot().index,0);assert.equal(a.ui.snapshot().status,'paused');
    a.ui.destroy();assert.equal(a.doc.querySelector('#sessionTimerDialog'),null);assert.equal(a.doc.body.classList.contains('timer-session-open'),false);
  }finally{await a.close();}
});

test('release clicks retargeted onto another command after a long hold cannot pause or reset the timer',async()=>{
  const a=uiFixture();try{
    a.$('.session-timer-start').click();
    a.pointer('#timerSessionLock','pointerdown');a.advance(3000);a.pointer('#timerSessionLock','pointerup');
    a.$('#timerSessionToggle').dispatchEvent(new a.window.MouseEvent('click',{bubbles:true,detail:1,cancelable:true}));
    assert.equal(a.ui.snapshot().status,'running');assert.equal(a.$('.timer-board').dataset.sessionLocked,'false');
    a.pointer('.session-timer-advance','pointerdown');a.advance(2000);a.pointer('.session-timer-advance','pointerup');
    a.$('#timerSessionReset').dispatchEvent(new a.window.MouseEvent('click',{bubbles:true,detail:1,cancelable:true}));
    assert.equal(a.ui.snapshot().index,1);assert.equal(a.ui.snapshot().status,'running');
    a.pointer('#timerSessionToggle','pointerdown');a.pointer('#timerSessionToggle','pointerup');
    a.$('#timerSessionToggle').dispatchEvent(new a.window.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(a.ui.snapshot().status,'paused');
  }finally{await a.close();}
});
