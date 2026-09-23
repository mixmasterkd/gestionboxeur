import test from 'node:test';
import assert from 'node:assert/strict';
import {datesForView,shiftPeriod,orderedSessions,positionBetween,eventOnDate} from '../js/calendar.js';

test('week and month ranges include neighboring months without UTC date shifts',()=>{
  assert.deepEqual(datesForView('2026-09-21','week'),['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-27']);
  assert.equal(datesForView('2026-02-15','month').length,42);
  assert.equal(datesForView('2026-02-15','month')[0],'2026-01-26');
  assert.deepEqual(datesForView('2026-09-21','today'),['2026-09-21']);
  assert.equal(shiftPeriod('2026-01-31','month',1),'2026-02-01');
  assert.equal(shiftPeriod('2026-01-01','month',-1),'2025-12-01');
  assert.equal(shiftPeriod('2026-03-08','week',1),'2026-03-15');
});
test('fractional ordering moves one session without rewriting other coach sessions',()=>{
  const a={id:'a',date:'2026-09-21',sort_order:1024,created_by:'coach-a'},b={id:'b',date:'2026-09-21',sort_order:2048,created_by:'coach-b'};
  const original=structuredClone([a,b]);
  const c={id:'c',date:a.date,sort_order:positionBetween(a,b)};
  assert.deepEqual(orderedSessions([b,c,a]).map(s=>s.id),['a','c','b']);
  assert.deepEqual([a,b],original);
  assert.equal(positionBetween(null,a),0);assert.equal(positionBetween(b,null),3072);assert.equal(positionBetween(null,null),1024);
  assert.throws(()=>positionBetween(a,{...b,sort_order:1024}),/positions/);
});
test('personal events include both endpoints and do not spread beyond their date',()=>{
  const event={date:'2026-09-21',end_date:'2026-09-23'};
  assert.equal(eventOnDate(event,'2026-09-20'),false);assert.equal(eventOnDate(event,'2026-09-21'),true);
  assert.equal(eventOnDate(event,'2026-09-23'),true);assert.equal(eventOnDate(event,'2026-09-24'),false);
  assert.equal(eventOnDate({date:'2026-09-21',end_date:null},'2026-09-22'),false);
});
