import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makeBlock } from '../js/domain.js';
import { sessionChartData, renderSessionChart, SESSION_CHART_LIMIT } from '../js/session-chart.js';

const step=(type,values={})=>({...makeBlock(type),...values});
const repeat=(count,children)=>({...makeBlock('repeat'),repeat_count:count,children});

test('running tile preserves the ordered time and supplied zones of nested intervals',()=>{
  const session={sport:'running',blocks:[step('warmup',{duration_seconds:600,zone:2}),repeat(6,[step('run',{duration_seconds:120,zone:4}),step('recovery',{duration_seconds:60,zone:1})])]};
  const chart=sessionChartData(session);
  assert.equal(chart.total,1680);assert.equal(chart.partial,false);assert.equal(chart.aggregated,false);
  assert.equal(chart.bars.length,13);assert.deepEqual(chart.bars.slice(0,3).map(bar=>[bar.seconds,bar.zone]),[[600,2],[120,4],[60,1]]);
  assert.equal(chart.bars.reduce((sum,bar)=>sum+bar.seconds,0),chart.total);
});

test('boxing timeline respects rounds and rest and never treats a type as an effort zone',async()=>{
  const session={sport:'boxing',blocks:[step('shadow',{rounds:3,work_seconds:180,rest_seconds:60}),step('bag',{duration_seconds:240,zone:7})]};
  const chart=sessionChartData(session);
  assert.equal(chart.running,false);assert.equal(chart.total,900);
  assert.deepEqual(chart.bars.map(bar=>bar.type),['shadow','rest','shadow','rest','shadow','bag']);
  assert.match(chart.bars[2].label,/round 2/);
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const figure=renderSessionChart(session,{compact:false});
    assert.equal(new Set([...figure.querySelectorAll('rect')].map(rect=>rect.getAttribute('height'))).size,1);
    assert.match(figure.querySelector('svg').getAttribute('aria-label'),/hauteur ne représente pas l’effort/);
    assert.match(figure.querySelector('.session-chart-legend').textContent,/Shadow.*Repos.*Sac/);
    assert.ok(Math.abs([...figure.querySelectorAll('rect')].reduce((sum,rect)=>sum+Number(rect.getAttribute('width')),0)-288)<1e-8);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('distance-only and free blocks never receive invented duration; partial profiles say so',async()=>{
  const session={sport:'running',blocks:[step('run',{distance_m:400,zone:4}),step('recovery',{duration_seconds:60,zone:1}),step('other',{description:'Technique libre'})]};
  const chart=sessionChartData(session);
  assert.equal(chart.total,60);assert.equal(chart.bars.length,1);assert.equal(chart.partial,true);
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const figure=renderSessionChart(session);
    assert.match(figure.textContent,/Profil partiel/);
    const distance=renderSessionChart({sport:'running',blocks:[step('run',{distance_m:5000})]});
    assert.equal(distance.querySelector('svg'),null);assert.match(distance.textContent,/Durées non renseignées/);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('ten thousand segments become a bounded distribution with exact duration',async()=>{
  const session={sport:'running',blocks:[repeat(100,[repeat(100,[step('run',{duration_seconds:1,zone:3})])])]};
  const chart=sessionChartData(session);
  assert.equal(chart.segments,10000);assert.equal(chart.total,10000);assert.equal(chart.aggregated,true);assert.equal(chart.bars.length,1);
  assert.equal(chart.bars[0].seconds,10000);
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const figure=renderSessionChart(session,{maxBars:999999});
    assert.ok(figure.querySelectorAll('rect').length<=SESSION_CHART_LIMIT);
    assert.match(figure.querySelector('svg').getAttribute('aria-label'),/sans ordre chronologique/);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('invalid blocks and hostile text remain safe and readable',async()=>{
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const figure=renderSessionChart({sport:'boxing',blocks:[step('other',{title:'<img src=x onerror=alert(1)>',duration_seconds:60})]});
    assert.equal(figure.querySelector('img'),null);assert.match(figure.textContent,/<img src=x/);
    const invalid=renderSessionChart({sport:'running',blocks:[step('run',{duration_seconds:-10})]});
    assert.equal(invalid.querySelector('svg'),null);assert.match(invalid.textContent,/Profil indisponible/);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});
