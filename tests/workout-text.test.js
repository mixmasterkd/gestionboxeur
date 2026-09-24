import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBlock, summarizeBlocks, WORKOUT_LIMITS } from '../js/domain.js';
import { parseWorkoutText, serializeWorkoutText, syntaxHelp, advancedSyntaxHelp } from '../js/workout-text.js';

const step = values => ({ ...makeBlock('run'), ...values });
const repeat = (count, children, values = {}) => ({ ...makeBlock('repeat'), repeat_count: count, children, ...values });
const semantics = blocks => blocks.map(({ id, children, ...block }) => ({ ...block, children: semantics(children) }));
function parse(text, options) {
  const parsed = parseWorkoutText(text, options);
  assert.deepEqual(parsed.errors, [], JSON.stringify(parsed.errors));
  return parsed.blocks;
}
function roundTrip(blocks) {
  const before = structuredClone(blocks), text = serializeWorkoutText(blocks), restored = parse(text);
  assert.deepEqual(semantics(restored), semantics(blocks), text);
  assert.deepEqual(blocks, before, 'Serialization must not mutate the program');
  return text;
}

test('headers choose type and title; dash supplies instructions, including compact rounds', () => {
  const blocks = parse('Course\n1m @ Z2 - Marche\nShadow\n3rounds 1m/1m -faire du 8/16\nSac\n3 rounds 1m30/30s - Relâche les épaules\nAbdos\nLibre - Gainage\nCorde\n2m');
  assert.deepEqual(blocks.map(block => [block.type, block.title]), [['run', 'Course'], ['shadow', 'Shadow'], ['bag', 'Sac'], ['strength', 'Abdos'], ['cardio', 'Corde']]);
  assert.equal(blocks[0].description, 'Marche'); assert.equal(blocks[0].zone, 2);
  assert.equal(blocks[1].description, 'faire du 8/16');
  assert.equal(blocks[1].rounds, 3); assert.equal(blocks[1].work_seconds, 60); assert.equal(blocks[1].rest_seconds, 60);
  assert.equal(summarizeBlocks([blocks[1]]).duration_seconds, 300, 'No recovery after the final round');
  assert.equal(blocks[2].work_seconds, 90); assert.equal(blocks[2].rest_seconds, 30);
  assert.equal(blocks[3].description, 'Gainage');
});

test('repeat indentation preserves child order, nested groups, and inherited section', () => {
  const blocks = parse('Course\n2x - Garder une allure régulière\n  1m30s @ Z4 - Effort\n  30s @ Z1 - Récupération\n  3x : Accélérations\n    10s @ Z5\n    20s @ Z1\nShadow\n1m');
  assert.equal(blocks.length, 2); assert.equal(blocks[0].repeat_count, 2);
  assert.equal(blocks[0].description, 'Garder une allure régulière');
  assert.deepEqual(blocks[0].children.slice(0, 2).map(block => block.type), ['run', 'run']);
  assert.equal(blocks[0].children[2].title, 'Accélérations');
  const summary = summarizeBlocks(blocks);
  assert.equal(summary.duration_seconds, 480);
  assert.equal(summary.segments.length, 17);
});

test('durations distinguish minute shorthand, seconds and explicit distance units', () => {
  const blocks = parse('1m30s\n1m30\n30s\n1,5m\n1h2m3s\n400 mètres\n400mtr\n1.5km\n5m + 1km', { sport: 'running' });
  assert.deepEqual(blocks.slice(0, 5).map(block => block.duration_seconds), [90, 90, 30, 90, 3723]);
  assert.deepEqual(blocks.slice(5, 8).map(block => block.distance_m), [400, 400, 1500]);
  assert.equal(blocks[8].duration_seconds, 300); assert.equal(blocks[8].distance_m, 1000);
  assert.ok(blocks.every(block => block.type === 'run' && block.title === 'Course'));
});

test('arbitrary titles and free instructions use explicit syntax without reinterpreting invalid doses', () => {
  const blocks = parse('Sac : Puissance et précision\nLibre - 8 coups puissants, 1 push-up\nTechnique du mardi:\n- Répéter tranquillement\nCourse : Jog léger\n20m');
  assert.equal(blocks[0].title, 'Puissance et précision'); assert.equal(blocks[0].type, 'bag');
  assert.equal(blocks[1].title, 'Technique du mardi'); assert.equal(blocks[1].type, 'bag');
  assert.equal(blocks[1].description, 'Répéter tranquillement');
  assert.equal(blocks[2].title, 'Jog léger');
  for (const invalid of ['3 raunds 1m/1m', '1mxx', '10', '-1m', '1m @ RPE7', '1m @ Z8', 'Course\n1m\nTexte non structuré']) assert.ok(parseWorkoutText(invalid).errors.length, invalid);
});

test('regular programs serialize to readable sections, instructions and repetitions without JSON', () => {
  const blocks = parse('Course\n10m @ Z2 - Échauffement\n6x\n  2m @ Z4 - Effort\n  1m @ Z1 - Récupération\n5m @ Z1 - Retour au calme');
  const text = roundTrip(blocks);
  assert.match(text, /Course\n10m @ Z2 - Échauffement/);
  assert.match(text, /6x\n  2m @ Z4 - Effort/);
  assert.doesNotMatch(text, /\|/);
});

test('all advanced fields, mixed quantities and nested repetitions survive round trip', () => {
  const blocks = [
    step({ title: '', description: 'Première consigne\nDeuxième consigne', notes: 'Une note\nAvec "guillemets" et | caractères', duration_seconds: 90.125, distance_m: 333.3, intensity: 'moderate', repetitions: 8, zone: 4, future_option: { unit: 'watts', target: [200, 210], supported: true, id: 'semantic-not-a-block-id' } }),
    repeat(3, [
      { ...makeBlock('bag'), title: 'Travail du mardi', description: 'Faire du 8/16', rounds: 3, work_seconds: 60, rest_seconds: 30, duration_seconds: 555, distance_m: 100, repetitions: 5, intensity: 'hard', notes: 'Gants 16 oz' },
      repeat(2, [step({ title: ' Fractionné ', duration_seconds: 1e-8, zone: 2 })], { title: ' Circuit avancé ', notes: 'Notes de répétition', description: 'Séquence\nà respecter', type: 'future-repeat-type', zone: 3, repeat_future: [1, 'deux'] }),
    ], { title: 'Tour complet', description: 'Respire entre les blocs', duration_seconds: 50, rounds: 2, work_seconds: 10, rest_seconds: 5, intensity: 'easy', repetitions: 2 }),
    { ...makeBlock('future-block-type'), title: 'Libellé\nmultiligne', description: '  Espaces intentionnels  ', notes: 'Conserver', repeat_count: 9, duration_seconds: '', distance_m: 0, rest_seconds: 10 },
  ];
  const text = roundTrip(blocks);
  assert.match(text, /\| \{/); assert.match(text, /future_option/); assert.match(text, /\\n/);
  assert.doesNotMatch(text, new RegExp(blocks[0].id));
});

test('alias headings, titles containing syntax, empty titles and null options are not lost', () => {
  const blocks = [
    { ...makeBlock('cardio'), title: 'Corde', duration_seconds: 120 },
    { ...makeBlock('strength'), title: 'Abdos', description: 'Contracter 2s', repetitions: 12 },
    step({ title: 'Course : objectif - tenir @ Z2', description: 'Une option | {"ne pas lire":"comme JSON"}', duration_seconds: 60 }),
    repeat(1, [step({ title: null, description: null, notes: null, duration_seconds: 0 })], { title: 'Répéter - calmement' }),
  ];
  const text = roundTrip(blocks);
  assert.match(text, /^Corde\n2m/m); assert.match(text, /^Abdos\nLibre/m);
});

test('section scope does not leak from nested repeats into following siblings', () => {
  const blocks = parse('Course\n1m\n2x\n  Sac\n  30s\n1m');
  assert.equal(blocks[1].children[0].type, 'bag');
  assert.equal(blocks[2].type, 'run');
  roundTrip(blocks);
});

test('syntax-looking titles and instructions round trip without becoming annotations or targets', () => {
  const strings = ['Au rythme @ Z2', 'Course : 3x', 'Bloc - consigne', 'Une barre | {"zone":7}', 'Une ligne\nPuis deux', '', ' Espaces ', 'Texte\tavec tabulation', '<script>alert(1)</script>'];
  for (const title of strings) {
    roundTrip([step({ title, description: title, notes: title, duration_seconds: 90 })]);
    roundTrip([repeat(2, [step({ duration_seconds: 30 })], { title, description: title, notes: title })]);
  }
});

test('line errors point to incorrect input and preserve the original text contract', () => {
  const text = 'Course\n1m\n  30s\n0x\n  1m\nShadow\n';
  const result = parseWorkoutText(text);
  assert.ok(result.errors.some(error => error.line === 3 && /indentée/.test(error.message)));
  assert.ok(result.errors.some(error => error.line === 4 && /répétitions/.test(error.message)));
  assert.ok(result.errors.some(error => error.line === 6 && /en-tête/.test(error.message)));
  for (const invalid of ['2x', '2x\n  ', 'Course\nSac\n1m', '2x\n   1m', '2x\n\t1m', '2x\n    1m']) assert.ok(parseWorkoutText(invalid).errors.length, invalid);
});

test('bounds on doses, zones, rounds, repetition counts and expansion are enforced', () => {
  for (const invalid of [
    '101x\n  1m', '10001 rounds 1m/1m', '1m @ Z0', '1000001s', '1001km',
    '1m | {"intensity":"extreme"}', '1m | {"repetitions":0}',
    '100x\n  100x\n    1s\n    1s',
    '2x\n  2x\n    2x\n      2x\n        1s',
  ]) assert.ok(parseWorkoutText(invalid).errors.length, invalid);
  assert.equal(parse('100x\n  100x\n    1s')[0].repeat_count, 100);
  assert.ok(parseWorkoutText(Array.from({ length: WORKOUT_LIMITS.siblings + 1 }, () => '1s').join('\n')).errors.some(error => /100 blocs/.test(error.message)));
  const manyChildren = '2x\n' + Array.from({ length: 100 }, () => '  1s').join('\n');
  assert.ok(parseWorkoutText(`${manyChildren}\n${manyChildren}`).errors.some(error => /200 blocs/.test(error.message)));
});

test('annotations preserve future JSON data but reject malformed or structural overrides', () => {
  const [block] = parse('Course\n1m | {"future":{"pace":"4:30","flags":[true,null]},"title":"","notes":"Matériel"}');
  assert.equal(block.title, ''); assert.equal(block.notes, 'Matériel');
  assert.deepEqual(block.future, { pace: '4:30', flags: [true, null] });
  for (const suffix of ['{oops}', '[]', 'null', '{"children":[]}', '{"kind":"repeat"}', '{"id":"duplicate"}', '{"__proto__":{"polluted":true}}']) {
    const result = parseWorkoutText(`1m | ${suffix}`);
    assert.equal(result.errors[0].line, 1); assert.equal(result.blocks.length, 0);
  }
  assert.equal({}.polluted, undefined);
});

test('unsafe or invalid existing data cannot be silently serialized with missing fields', () => {
  assert.throws(() => serializeWorkoutText([step({ duration_seconds: -1 })]), /Impossible/);
  assert.throws(() => serializeWorkoutText([step({ future: undefined })]), /non JSON/);
  assert.throws(() => serializeWorkoutText([step({ future: new Date() })]), /non JSON/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => serializeWorkoutText([step({ future: cyclic })]), /circulaire/);
  const invalid = repeat(2, []); invalid.children.push(invalid);
  assert.throws(() => serializeWorkoutText([invalid]), /Impossible/);
});

test('empty text, CRLF, decimal comma and malformed input are handled without throwing', () => {
  assert.deepEqual(parseWorkoutText(' \n\n'), { blocks: [], errors: [] });
  assert.equal(parse('Course\r\n1,25m\r\n')[0].duration_seconds, 75);
  for (const input of [null, undefined, 42, {}, '9'.repeat(5000) + 'm', '1m | ' + '{'.repeat(5000), '\n'.repeat(5001)]) assert.doesNotThrow(() => { const result = parseWorkoutText(input); assert.ok(Array.isArray(result.errors)); assert.ok(result.errors.length); });
  assert.ok(syntaxHelp.includes('1m30')); assert.ok(advancedSyntaxHelp.includes('JSON'));
});
