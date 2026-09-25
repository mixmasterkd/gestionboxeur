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

test('boxing timeline respects legacy rounds while prescribed zones change height',async()=>{
  const session={sport:'boxing',blocks:[step('shadow',{rounds:3,work_seconds:180,rest_seconds:60}),step('bag',{duration_seconds:240,zone:7})]};
  const chart=sessionChartData(session);
  assert.equal(chart.running,false);assert.equal(chart.total,900);
  assert.deepEqual(chart.bars.map(bar=>bar.type),['shadow','rest','shadow','rest','shadow','bag']);
  assert.match(chart.bars[2].label,/round 2/);
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const figure=renderSessionChart(session,{compact:false});
    assert.ok(new Set([...figure.querySelectorAll('rect')].map(rect=>rect.getAttribute('height'))).size > 1);
    assert.match(figure.querySelector('svg').getAttribute('aria-label'),/effort demandé/);
    assert.match(figure.querySelector('.session-chart-legend').textContent,/Effort non précisé.*Repos.*Z7/);
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
    assert.ok(distance.querySelector('svg'));assert.match(distance.querySelector('svg').getAttribute('aria-label'),/Largeur : distance/);assert.match(distance.textContent,/5 km/);
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

test('effort ranges render exactly their two endpoints, never stacked sums or intermediate zones',async()=>{
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const session={sport:'boxing',blocks:[step('bag',{duration_seconds:180,effort:{kind:'zone',min:2,max:4}})]};
    const chart=sessionChartData(session),bar=chart.bars[0];
    assert.equal(bar.lowHeight,2/7);assert.equal(bar.highHeight,4/7);assert.equal(bar.range,true);
    const figure=renderSessionChart(session,{compact:false}),rects=[...figure.querySelectorAll('rect')];
    assert.equal(rects.length,2);assert.deepEqual(rects.map(rect=>rect.dataset.bound),['upper','lower']);
    assert.ok(Math.abs(Number(rects[0].getAttribute('height'))-50*4/7)<1e-9);assert.ok(Math.abs(Number(rects[1].getAttribute('height'))-50*2/7)<1e-9);
    assert.equal(rects[0].getAttribute('width'),rects[1].getAttribute('width'));
    assert.equal(Number(rects[0].getAttribute('y'))+Number(rects[0].getAttribute('height')),60);
    assert.equal(Number(rects[1].getAttribute('y'))+Number(rects[1].getAttribute('height')),60);
    assert.match(figure.textContent,/Z2-Z4/);assert.doesNotMatch(figure.textContent,/Z3/);
    assert.ok(Number(rects[0].getAttribute('fill-opacity'))<Number(rects[1].getAttribute('fill-opacity')));
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('color and RPE targets have progressively higher heights and distinct colors for boxing too',()=>{
  for(const [kind,max] of [['color',3],['rpe',10]]){
    const session={sport:'boxing',blocks:Array.from({length:max},(_,index)=>step('bag',{duration_seconds:60,effort:{kind,min:index+1,max:index+1}}))};
    const chart=sessionChartData(session);
    assert.equal(new Set(chart.bars.map(bar=>bar.color)).size,max);
    for(let i=1;i<chart.bars.length;i++)assert.ok(chart.bars[i].lowHeight>chart.bars[i-1].lowHeight);
  }
  const range=sessionChartData({sport:'boxing',blocks:[step('bag',{duration_seconds:60,effort:{kind:'color',min:1,max:3}})]}).bars[0];
  assert.equal(range.name,'Vert-Rouge');assert.notEqual(range.color,range.highColor);
});

test('absolute heart-rate/pace ranges and custom effort remain labelled and neutral without athlete references',async()=>{
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const session={sport:'running',blocks:[
      step('run',{duration_seconds:300,effort:{kind:'bpm',min:120,max:150}}),
      step('run',{duration_seconds:300,effort:{kind:'pace',min:330,max:390}}),
      step('run',{duration_seconds:300,effort:{kind:'custom',label:'Souple'}}),
      step('run',{duration_seconds:300}),
    ]};
    const chart=sessionChartData(session);
    assert.equal(new Set(chart.bars.map(bar=>bar.lowHeight)).size,1);
    assert.equal(new Set(chart.bars.map(bar=>bar.color)).size,1);
    assert.ok(chart.bars.every(bar=>!bar.range&&!bar.scaled));
    const figure=renderSessionChart(session,{compact:false});
    assert.match(figure.textContent,/120-150 bpm/);assert.match(figure.textContent,/5:30-6:30\/km/);assert.match(figure.textContent,/sans estimation de leur difficulté/);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('selecting a graph step by click or keyboard returns its source id and exposes its instruction',async()=>{
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const selected=[],block=step('bag',{duration_seconds:180,description:'Jab puis déplacement',effort:{kind:'rpe',min:6,max:6}});
    const figure=renderSessionChart({sport:'boxing',blocks:[repeat(3,[block])]},{compact:false,onSelect:id=>selected.push(id)});
    const groups=figure.querySelectorAll('[role="button"]');assert.equal(groups.length,3);
    assert.match(groups[0].getAttribute('aria-label'),/Sac.*RPE 6\/10.*Jab puis déplacement/);
    groups[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
    groups[2].dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    assert.deepEqual(selected,[block.id,block.id]);
    assert.match(figure.querySelector('output').textContent,/Jab puis déplacement/);
    assert.equal(figure.querySelectorAll('[data-selected]').length,1);
    assert.equal(groups[0].getAttribute('tabindex'),'0');
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('aggregation never edits an arbitrary source step and preserves total across mixed effort ranges',async()=>{
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const blocks=Array.from({length:4},(_,index)=>step('bag',{duration_seconds:60,effort:{kind:'rpe',min:index+1,max:index+2}}));
    const chart=sessionChartData({sport:'boxing',blocks},{maxBars:2});assert.equal(chart.total,240);assert.equal(chart.bars.length,2);assert.equal(chart.aggregated,true);
    assert.equal(chart.bars.reduce((total,bar)=>total+bar.value,0),240);assert.ok(chart.bars.every(bar=>!bar.blockId));
    const selected=[],figure=renderSessionChart({sport:'boxing',blocks},{compact:false,maxBars:2,onSelect:id=>selected.push(id)});
    figure.querySelector('[role="button"]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));assert.deepEqual(selected,[]);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('text-only sessions keep an empty plan and parser warnings mark known steps as partial',async()=>{
  const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
  try{
    const empty=renderSessionChart({sport:'boxing',blocks:[]},{compact:false});assert.match(empty.textContent,/Aucune étape structurée/);
    const partial=renderSessionChart({sport:'boxing',blocks:[step('bag',{duration_seconds:120})]},{partial:true});assert.match(partial.textContent,/Profil partiel/);
    const distance=sessionChartData({sport:'running',blocks:[step('run',{distance_m:400}),step('run',{distance_m:800})]});
    assert.equal(distance.axis,'distance');assert.equal(distance.total,1200);assert.equal(distance.partial,false);assert.ok(distance.bars.every(bar=>bar.seconds===0));
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;await window.happyDOM.abort();}
});

test('series use effort colours and one indicative slot without invented time or count expansion',async()=>{
 const session={blocks:[step('strength',{title:'Abdos',repetitions:10,effort:{kind:'rpe',min:2,max:3}}),step('burpees',{repetitions:100,zone:5})]};
 const chart=sessionChartData(session);assert.equal(chart.axis,'series');assert.equal(chart.bars.length,2);assert.equal(chart.total,2);assert.equal(chart.bars[0].value,chart.bars[1].value);assert.equal(chart.bars[0].seconds,0);assert.notEqual(chart.bars[0].color,chart.bars[1].color);assert.ok(chart.bars[1].lowHeight>chart.bars[0].lowHeight);
 const mixed=sessionChartData({blocks:[step('run',{distance_m:400}),...session.blocks]});assert.equal(mixed.axis,'distance');assert.equal(mixed.total,400);assert.equal(mixed.bars.length,3);
 const window=new Window(),previous=globalThis.document;globalThis.document=window.document;
 try {const node=renderSessionChart(session,{compact:false});assert.match(node.textContent,/largeurs indicatives/);assert.match(node.querySelector('svg').getAttribute('aria-label'),/2 séries/);assert.match(node.querySelector('[role=button]').getAttribute('aria-label'),/10 mouvements/);assert.equal(node.querySelectorAll('.session-chart-segment').length,2);}
 finally{globalThis.document=previous;await window.happyDOM.abort();}
});
