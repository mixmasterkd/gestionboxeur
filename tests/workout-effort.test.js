import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEffort, formatEffort } from '../js/workout-effort.js';

test('targets accept explicit zones, RPE, colours and physiological units without conflating them', () => {
  const examples = [
    ['@ z3', 'zone', 3, 3], ['Z2-Z4', 'zone', 2, 4], ['RPE 6/10', 'rpe', 6, 6], ['rpe4-6', 'rpe', 4, 6],
    ['vert-JAUNE', 'color', 1, 2], ['120 – 150 bpm', 'bpm', 120, 150], ['5:30-6:30/km', 'pace', 330, 390], ['6:30-5:30 / km', 'pace', 330, 390],
  ];
  for (const [text, kind, min, max] of examples) {
    const effort = parseEffort(text); assert.deepEqual([effort.kind, effort.min, effort.max], [kind, min, max], text);
    assert.deepEqual(parseEffort(formatEffort(effort)), effort, text);
  }
  assert.deepEqual(parseEffort('Repos actif'), { kind: 'recovery', label: 'Repos actif' });
  assert.deepEqual(parseEffort('À mon rythme'), { kind: 'custom', label: 'À mon rythme' });
  assert.equal(parseEffort('Non précisée'), null);
});

test('malformed numeric targets are warnings, never downgraded to custom targets', () => {
  for (const text of ['Z0', 'Z8', 'Z2.5', 'Z4-Z2', 'Z8 FC', 'Z4-Z2 Allure', 'Z3 FC Allure', 'RPE11', 'RPE6/5', 'RPE 6 sur 5', '0bpm', '301bpm', '150-120bpm', '5:65/km', '0:00/km', '150', 'RPEfoo']) assert.throws(() => parseEffort(text), undefined, text);
});

test('zone references remain explicit through source and graph formatting',()=>{
 for(const [text,basis,min,max,formatted] of [
  ['@ Z3 FC','hr',3,3,'Z3 FC'],['zone 2-zone 4 fc','hr',2,4,'Z2-Z4 FC'],
  ['z3 allure','pace',3,3,'Z3 Allure'],['@ Z2-Z4 ALLURE','pace',2,4,'Z2-Z4 Allure'],
 ]) {
  const effort={kind:'zone',min,max,basis};assert.deepEqual(parseEffort(text),effort);assert.equal(formatEffort(effort),formatted);
  assert.deepEqual(parseEffort(formatEffort(effort)),effort);
 }
 assert.deepEqual(parseEffort('Z3'),{kind:'zone',min:3,max:3});
});

test('RPE denominators accept readable forms and retain the same requested effort',()=>{
 for(const text of ['RPE 6','RPE6/10','@ rpe 6 / 10','RPE 6 sur 10','rPe 6 SUR 10']) {
  const effort=parseEffort(text);assert.deepEqual(effort,{kind:'rpe',min:6,max:6,basis:'10'});assert.equal(formatEffort(effort),'RPE 6/10');
 }
 assert.equal(formatEffort(parseEffort('RPE 4-6 sur 10')),'RPE 4-6/10');
});
