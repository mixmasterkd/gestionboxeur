import test from 'node:test';
import assert from 'node:assert/strict';
import {getStarterTemplates} from '../js/starter-templates.js';
import {summarizeBlocks,validateBlocks} from '../js/domain.js';
import {parseTrainingText} from '../js/workout-document.js';
import {sessionChartData} from '../js/session-chart.js';

test('the eleven base jogs have valid authored documents and the Z1-Z2 effort range',()=>{
 const bases=getStarterTemplates(),jogs=bases.filter(t=>t.sport==='running');assert.equal(bases.length,13);assert.equal(jogs.length,11);
 jogs.forEach((t,i)=>{const minutes=10+i*5;assert.equal(t.workout_document.text,`- Jog ${minutes} MIN @ Z1-Z2`);assert.deepEqual(parseTrainingText(t.workout_document.text).errors,[]);assert.deepEqual(validateBlocks(t.blocks),[]);assert.equal(summarizeBlocks(t.blocks).duration_seconds,minutes*60);assert.equal(t.blocks[0].effort.min,1);assert.equal(t.blocks[0].effort.max,2);assert.equal(sessionChartData(t).bars[0].range,true);});
});

test('boxing base includes the final rests, three movement series and a continuous cooldown',()=>{
 const t=getStarterTemplates().find(t=>t.id==='starter-boxing-fundamentals'),summary=summarizeBlocks(t.blocks),chart=sessionChartData(t);
 assert.deepEqual(parseTrainingText(t.workout_document.text,{sport:'boxing'}).errors,[]);assert.equal(summary.duration_seconds,43*60);assert.equal(chart.bars.length,19);
 assert.equal(chart.bars.filter(b=>b.repetitions===30).length,3);assert.equal(summary.segments.filter(s=>s.effort?.label==='Repos').length,7);
 assert.equal(t.blocks.at(-1).duration_seconds,300);assert.equal(t.blocks.at(-1).type,'shadow');assert.equal(t.blocks.at(-1).description,'Libre');
 const sparring=getStarterTemplates().find(t=>t.id==='starter-sparring');assert.equal(sparring.sport,'boxing');assert.equal(summarizeBlocks(sparring.blocks).duration_seconds,9*60);assert.equal(sessionChartData(sparring).bars.length,6);
});

test('bases have stable identities and independent text documents and blocks on every request',()=>{
 const a=getStarterTemplates(),b=getStarterTemplates();assert.deepEqual(a.map(t=>t.id),b.map(t=>t.id));assert.notEqual(a[0].blocks[0].id,b[0].blocks[0].id);
 a[0].blocks[0].duration_seconds=1;a[0].workout_document.text='Changed';assert.equal(b[0].blocks[0].duration_seconds,600);assert.match(b[0].workout_document.text,/10 MIN/);assert.ok(a.every(t=>!t.coach_id&&!t.athlete_id));
});
