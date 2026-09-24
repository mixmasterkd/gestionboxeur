import test from 'node:test';
import assert from 'node:assert/strict';
import { getStarterTemplates } from '../js/starter-templates.js';
import { summarizeBlocks, validateBlocks } from '../js/domain.js';

test('starter kit has 11 adjustable time-only jogs from 10 through 60 minutes', () => {
  const kit = getStarterTemplates(), jogs = kit.filter(item => item.sport === 'running');
  assert.equal(kit.length, 13);
  assert.equal(jogs.length, 11);
  jogs.forEach((template, index) => {
    const minutes = 10 + index * 5;
    assert.equal(template.title, `Jog ${minutes} min`);
    assert.equal(template.kind, 'session');
    assert.equal(template.source, 'starter');
    assert.equal(template.blocks.length, 1);
    assert.equal(template.blocks[0].type, 'run');
    assert.equal(template.blocks[0].duration_seconds, minutes * 60);
    assert.equal(template.blocks[0].distance_m, null);
    assert.equal(template.blocks[0].rounds, null);
    assert.equal(template.blocks[0].zone, null);
    assert.deepEqual(validateBlocks(template.blocks), []);
    assert.equal(summarizeBlocks(template.blocks).duration_seconds, minutes * 60);
  });
});

test('boxing starter has four two-minute rounds per skill with rest only between rounds', () => {
  const template = getStarterTemplates().find(item => item.sport === 'boxing');
  assert.equal(template.title, 'Boxe fondamentale');
  assert.deepEqual(template.blocks.map(block => [block.title, block.type]), [['Corde', 'cardio'], ['Shadow', 'shadow'], ['Sac', 'bag'], ['Abdos', 'strength']]);
  assert.equal(template.blocks[0].duration_seconds, 300);
  assert.equal(template.blocks[3].duration_seconds, 300);
  for (const block of template.blocks.slice(1, 3)) {
    assert.equal(block.rounds, 4); assert.equal(block.work_seconds, 120); assert.equal(block.rest_seconds, 60);
  }
  const summary = summarizeBlocks(template.blocks);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.duration_seconds, 32 * 60);
  assert.equal(summary.segments.filter(segment => segment.phase === 'rest').length, 6);
});

test('every kit request produces independent editable blocks while keeping stable template identities', () => {
  const first = getStarterTemplates(), second = getStarterTemplates();
  assert.deepEqual(first.map(item => item.id), second.map(item => item.id));
  assert.equal(new Set(first.map(item => item.id)).size, first.length);
  const firstIds = new Set(first.flatMap(item => item.blocks.map(block => block.id)));
  assert.ok(second.every(item => item.blocks.every(block => !firstIds.has(block.id))));
  first[0].blocks[0].duration_seconds = 15;
  first.at(-1).blocks[1].rounds = 12;
  assert.equal(second[0].blocks[0].duration_seconds, 600);
  assert.equal(second.at(-1).blocks[1].rounds, 4);
  assert.ok(first.every(item => !('coach_id' in item) && !('athlete_id' in item)));
});
