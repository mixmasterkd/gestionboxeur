import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBlock, summarizeBlocks } from '../js/domain.js';
import { parseTrainingText, serializeTrainingDocument, serializeTrainingBlocks, reconcileTrainingBlocks } from '../js/workout-document.js';

const step = values => ({ ...makeBlock('bag'), title: 'Sac', ...values });
const repeat = (count, children, values = {}) => ({ ...makeBlock('repeat'), repeat_count: count, children, ...values });
function parse(text, options) { const result = parseTrainingText(text, options); assert.deepEqual(result.errors, [], JSON.stringify(result.errors)); return result; }

test('free text and titles remain at their offsets and never establish an inherited activity', () => {
  const text = 'Travail technique\r\nCourse\r\n- 3min @Z3 - Garder les mains hautes\r\n\r\nUne remarque finale.';
  const result = parse(text, { sport: 'boxing' });
  assert.equal(result.blocks.length, 1); assert.equal(result.blocks[0].type, 'other'); assert.equal(result.blocks[0].title, 'Boxe');
  assert.equal(result.blocks[0].duration_seconds, 180); assert.equal(result.blocks[0].zone, 3);
  assert.deepEqual(result.lines.map(line => line.kind), ['text', 'text', 'step', 'blank', 'text']);
  for (const line of result.lines) assert.equal(text.slice(line.start, line.end), text.split('\r\n')[line.line - 1]);
  assert.equal(parse('Texte entièrement libre.').blocks.length, 0);
});

test('boxing activities, custom activities, recovery and optional step instructions are explicit', () => {
  const result = parse('- Corde 3min\n- Double end bag 2min @RPE6/10 - Jab\n- Marche 30s\n- Repos actif 1min\n- Combinaison 1-2 90s @Vert-Jaune\n- Sac - Consigne libre');
  assert.deepEqual(result.blocks.map(block => block.type), ['jump_rope', 'double_end_bag', 'walk', 'active_recovery', 'other', 'bag']);
  assert.equal(result.blocks[4].title, 'Combinaison 1-2'); assert.equal(result.blocks[5].duration_seconds, null);
  assert.equal(result.blocks[2].effort.label, 'Marche'); assert.equal(result.blocks[1].description, 'Jab');
});

test('units accept spacing, typographic primes and combined durations without treating m as metres', () => {
  const result = parse('- Jog 1m30\n- Jog 1 min 30 sec\n- Sac 1’30″\n- Sac 1\'30"\n- Jog 400mtr\n- Jog 1,5km\n- Jog 2min + 400 mètres\n- Jog 1h2min3s');
  assert.deepEqual(result.blocks.slice(0, 4).map(block => block.duration_seconds), [90, 90, 90, 90]);
  assert.deepEqual(result.blocks.slice(4, 6).map(block => block.distance_m), [400, 1500]);
  assert.equal(result.blocks[6].duration_seconds, 120); assert.equal(result.blocks[6].distance_m, 400); assert.equal(result.blocks[7].duration_seconds, 3723);
  assert.equal(parse('- Jog 400m').blocks[0].duration_seconds, 24000);
});

test('one-level repeat groups end only at a blank line and include their final recovery', () => {
  const text = '3rounds\nUne consigne pour les rounds\n- Sac 2min\n- Repos 1min\n\n- Marche 1min';
  const result = parse(text);
  assert.equal(result.blocks.length, 2); assert.equal(result.blocks[0].repeat_unit, 'rounds');
  assert.equal(result.blocks[0].children.length, 2); assert.equal(summarizeBlocks(result.blocks).duration_seconds, 600);
  assert.equal(parse('2 x\n- Shadow 1min').blocks[0].repeat_count, 2);
  assert.ok(parseTrainingText('2x\n- Sac 1min\n3x\n- Shadow 1min').errors.length);
  assert.ok(parseTrainingText('2x\nUne note').errors.length);
});

test('invalid structured lines do not block later valid steps or reuse a stale graph', () => {
  const result = parseTrainingText('- Sac 1min\n- Jog 2min @Z9\n- Shadow 3min\n- Jog -5min');
  assert.deepEqual(result.errors.map(error => error.line), [2, 4]);
  assert.deepEqual(result.blocks.map(block => block.duration_seconds), [60, 180]);
  assert.ok(!result.lines[1].blockId); assert.ok(result.lines[2].blockId);
  assert.equal(parseTrainingText('x'.repeat(20001)).blocks.length, 0);
  assert.ok(parseTrainingText('x'.repeat(20001)).errors.length);
});

test('legacy rounds expand without their final rest; nested repeats preserve segment order', () => {
  const old = [step({ rounds: 3, work_seconds: 120, rest_seconds: 60, notes: 'Gants légers', future: { keep: true } }), repeat(2, [step({ duration_seconds: 20 }), repeat(3, [step({ duration_seconds: 10 }), step({ duration_seconds: 5 })])])];
  const document = serializeTrainingDocument(old), restored = parse(document.text);
  assert.doesNotMatch(document.text, /\|\s*\{/);
  assert.deepEqual(summarizeBlocks(restored.blocks).segments.map(block => block.duration_seconds), summarizeBlocks(old).segments.map(block => block.duration_seconds));
  assert.equal(document.blocks[0].future.keep, true); assert.equal(document.blocks[0].notes, 'Gants légers');
  assert.equal(new Set(document.lines.filter(line => line.blockId).map(line => line.blockId)).size, document.lines.filter(line => line.blockId).length);
  assert.equal(serializeTrainingBlocks(old), document.text);
});

test('reconciliation preserves unknown fields and stable IDs when prose or other steps are edited', () => {
  const original = [step({ duration_seconds: 60, notes: 'Conserver', future: { target: 42 }, description: 'Jab' }), step({ duration_seconds: 120 })];
  const document = serializeTrainingDocument(original);
  const result = parse(`Nouveau titre\n${document.text.replace('Sac 2min', 'Sac 3min')}`);
  const next = reconcileTrainingBlocks(result, document.blocks, document.text);
  assert.equal(next.blocks[0].id, original[0].id); assert.deepEqual(next.blocks[0].future, { target: 42 }); assert.equal(next.blocks[0].notes, 'Conserver');
  assert.equal(next.blocks[1].duration_seconds, 180); assert.notEqual(next.blocks[1].id, original[1].id);
  assert.equal(next.lines[1].blockId, original[0].id); assert.equal(original[1].duration_seconds, 120);
});

test('partial results remain bounded by block, group and expanded-segment limits', () => {
  const result = parseTrainingText(Array.from({ length: 105 }, () => '- Sac 1s').join('\n'));
  assert.equal(result.blocks.length, 100); assert.equal(result.errors.length, 5);
  assert.deepEqual(summarizeBlocks(result.blocks).errors, []);
  assert.throws(() => serializeTrainingBlocks([repeat(100, [repeat(100, [step({ duration_seconds: 1 }), step({ duration_seconds: 2 })])])]), /volumineux/);
});

test('legacy syntax-looking notes and names never create extra steps or change activities during conversion', () => {
  for (const block of [
    step({ duration_seconds: 60, notes: '- Jog 10min' }),
    { ...makeBlock('other'), title: 'Course', duration_seconds: 30 },
    { ...makeBlock('other'), title: 'Atelier 3min', duration_seconds: 30 },
  ]) assert.throws(() => serializeTrainingDocument([block]), /structure originale/);
});

test('spaced effort ranges consume both bounds before an optional instruction or trailing dash', () => {
  const examples = [
    ['Z2 - Z4', 'zone', 2, 4], ['RPE4 - 6', 'rpe', 4, 6], ['120 - 150 bpm', 'bpm', 120, 150],
    ['5:30 - 6:30/km', 'pace', 330, 390], ['Vert - Jaune', 'color', 1, 2],
  ];
  for (const [effort, kind, min, max] of examples) {
    for (const suffix of ['', ' -', ' - Jab']) {
      const block = parse(`- Sac 3min @ ${effort}${suffix}`).blocks[0];
      assert.deepEqual([block.effort.kind, block.effort.min, block.effort.max], [kind, min, max]);
      assert.equal(block.description, suffix.includes('Jab') ? 'Jab' : '');
    }
  }
  assert.equal(parse('- Sac 3min @ Z3 -').blocks[0].zone, 3);
  assert.equal(parse('- Sac 3min @ Z3 - 3 coups rapides').blocks[0].description, '3 coups rapides');
  assert.ok(parseTrainingText('- Sac 3min @ Z2 - Z9').errors.length);
  assert.ok(parseTrainingText('- Sac 3min @ RPE4 - 11 - Jab').errors.length);
});
