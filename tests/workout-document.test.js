import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBlock, summarizeBlocks } from '../js/domain.js';
import { parseTrainingText, serializeTrainingDocument, serializeTrainingBlocks, reconcileTrainingBlocks } from '../js/workout-document.js';
import { sessionChartData } from '../js/session-chart.js';

const step = values => ({ ...makeBlock('bag'), title: 'Sac', ...values });
const repeat = (count, children, values = {}) => ({ ...makeBlock('repeat'), repeat_count: count, children, ...values });
function parse(text, options) { const result = parseTrainingText(text, options); assert.deepEqual(result.errors, [], JSON.stringify(result.errors)); return result; }

test('free text and titles remain at their offsets without inheriting activity outside a contextual group', () => {
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

test('SC is an explicit seconds alias while unitless free text keeps its meaning', () => {
  for(const value of ['2M 30SC','2 min 30 sc',"2'30\"",'2′30″'])assert.equal(parse(`- Shadow ${value}`).blocks[0].duration_seconds,150);
  assert.equal(parse('- Sac 30SC').blocks[0].duration_seconds,30);
  assert.equal(parse('- 10').blocks[0].duration_seconds,null);
  assert.equal(parse('- 10').blocks[0].title,'10');
  assert.ok(parseTrainingText('- Sac 30SCxyz').errors.length);
});

test('round headers accept an activity before or after the count, including the Shadow Boxing alias', () => {
  for (const heading of ['Shadow Boxing 3 rounds', '3 rounds de Shadow', '3rounds de SHADOW BOXING', 'shadow  boxing 3ROUNDS']) {
    const text = `${heading}\r\n- 2min - Jab et déplacements\r\n- 1min @ repos\r\n\r\nFin de séance`;
    const result = parse(text, { sport: 'running' }), group = result.blocks[0];
    assert.equal(result.blocks.length, 1); assert.equal(group.repeat_count, 3); assert.equal(group.repeat_unit, 'rounds');
    assert.deepEqual(group.children.map(block => [block.type, block.duration_seconds]), [['shadow', 120], ['shadow', 60]]);
    assert.equal(group.children[0].description, 'Jab et déplacements'); assert.equal(group.children[1].effort.label, 'Repos');
    assert.equal(summarizeBlocks(result.blocks).duration_seconds, 540);
    assert.equal(result.lines[0].blockId, group.id); assert.equal(result.lines[0].kind, 'repeat');
    assert.equal(text.slice(result.lines[1].start, result.lines[1].end), '- 2min - Jab et déplacements');
  }
  assert.equal(parse('- Shadow Boxing 2min').blocks[0].type, 'shadow');
});

test('Jog repetitions inherit their activity and timed steps without a target stay neutral on the graph', () => {
  for (const heading of ['Jog 3x', '3x de Jog', 'Jog 3 x', '3 x de Jog', '3× de Jog']) {
    const result = parse(`${heading}\n- 2min\n- 30s`, { sport: 'boxing' });
    const group = result.blocks[0]; assert.equal(group.repeat_count, 3); assert.notEqual(group.repeat_unit, 'rounds');
    assert.ok(group.children.every(block => block.type === 'jog' && block.effort === null && block.zone === null));
    const chart = sessionChartData({ sport: 'running', blocks: result.blocks });
    assert.equal(chart.total, 450); assert.equal(chart.bars.length, 6); assert.equal(chart.partial, false);
    assert.ok(chart.bars.every(bar => bar.name === 'Effort non précisé' && !bar.scaled && !bar.conventional && bar.lowHeight === bar.highHeight));
  }
});

test('explicit activities override inheritance for one line and blank lines end the inherited scope', () => {
  const result = parse('Shadow Boxing 3 rounds\n- 2min\nBurpees\n- Burpees 30s - Mains au sol\n- 1min @ repos\n\nShadow Boxing\n- 45s', { sport: 'running' });
  assert.deepEqual(result.blocks[0].children.map(block => block.type), ['shadow', 'burpees', 'shadow']);
  assert.equal(result.blocks[0].children[1].description, 'Mains au sol'); assert.equal(result.blocks[1].type, 'run');
  assert.equal(result.lines[2].kind, 'text'); assert.equal(result.lines[6].kind, 'text');
  assert.equal(parse('Shadow Boxing\n- 2min', { sport: 'boxing' }).blocks[0].title, 'Boxe');
  assert.equal(parse('Mon circuit 2x\n- 1min').blocks[0].children[0].title, 'Mon circuit');
});

test('known activities may follow a duration or distance while instructions remain after a dash', () => {
  for (const [before, after, type, duration, distance] of [
    ['Shadow 30s', '30s Shadow', 'shadow', 30, null],
    ['Burpees 30 secondes', '30 secondes Burpees', 'burpees', 30, null],
    ['Shadow Boxing 1’30″', '1’30″ Shadow Boxing', 'shadow', 90, null],
    ['Repos 30 secondes', '30 secondes Repos', 'recovery', 30, null],
    ['Corde à danser 1min', '1min Corde à danser', 'jump_rope', 60, null],
    ['Jog 400mtr', '400mtr Jog', 'jog', null, 400],
    ['Jog 2min + 400mtr', '2min + 400mtr Jog', 'jog', 120, 400],
  ]) {
    const first = parse(`- ${before} - Consigne conservée`).blocks[0], second = parse(`- ${after} - Consigne conservée`).blocks[0];
    for (const block of [first, second]) {
      assert.deepEqual([block.type, block.duration_seconds, block.distance_m], [type, duration, distance]);
      assert.equal(block.description, 'Consigne conservée');
    }
    assert.deepEqual(second.effort, first.effort);
  }
  const block = parse('- 30s Shadow @ Z2 - Z4 - Garder les mains hautes').blocks[0];
  assert.equal(block.type, 'shadow'); assert.equal(block.effort.max, 4); assert.equal(block.description, 'Garder les mains hautes');
});

test('activities after the dose override a mixed group only on their own line', () => {
  const result = parse('3 rounds de Shadow\n- 2min\n- 30 secondes Burpees - Mains au sol\n- 30s Shadow Boxing\n- Repos 30 secondes\n- 1min @ repos\n\n- 30s Jog', { sport: 'boxing' });
  assert.deepEqual(result.blocks[0].children.map(block => block.type), ['shadow', 'burpees', 'shadow', 'recovery', 'shadow']);
  assert.equal(result.blocks[0].children[1].description, 'Mains au sol'); assert.equal(result.blocks[1].type, 'jog');
  assert.equal(summarizeBlocks(result.blocks).duration_seconds, 840);
  assert.equal(result.lines[2].kind, 'step'); assert.equal(result.lines[2].blockId, result.blocks[0].children[1].id);
});

test('unknown trailing prose is never made into a custom activity or an implicit instruction', () => {
  for (const source of ['- 30s garder les mains hautes', '- 30s Mon exercice', '- 30s Autre', '- Sac 30s Burpees']) {
    const result = parseTrainingText(source);
    assert.equal(result.blocks.length, 0, source); assert.equal(result.errors.length, 1, source);
  }
  const custom = parse('- Mon exercice 30s - Garder les mains hautes').blocks[0];
  assert.equal(custom.type, 'other'); assert.equal(custom.title, 'Mon exercice'); assert.equal(custom.description, 'Garder les mains hautes');
  assert.equal(parse('- 30s - Garder les mains hautes', { sport: 'running' }).blocks[0].type, 'run');
});

test('changing the order of an explicit activity and its measurement keeps matching IDs and extra fields', () => {
  const previousText = '3 rounds de Shadow\n- Burpees 30 secondes - Mains au sol\n- 1min';
  const previous = parse(previousText).blocks; previous[0].children[0].future = { keep: true };
  const source = previousText.replace('Burpees 30 secondes', '30 secondes Burpees');
  const result = reconcileTrainingBlocks(parse(source), previous, previousText);
  assert.equal(result.blocks[0].children[0].id, previous[0].children[0].id);
  assert.deepEqual(result.blocks[0].children[0].future, { keep: true });
  assert.deepEqual(result.blocks[0].children.map(block => block.type), ['burpees', 'shadow']);
});

test('contextual groups keep the existing single-level and count limits', () => {
  assert.ok(parseTrainingText('Shadow Boxing 101 rounds\n- 1min').errors.some(error => error.line === 1));
  assert.ok(parseTrainingText('3 rounds de Shadow\n- 1min\nJog 2x\n- 30s').errors.some(error => /imbriqués/.test(error.message)));
  assert.ok(parseTrainingText('Shadow Boxing 3 rounds\nUne consigne libre').errors.some(error => /au moins une étape/.test(error.message)));
});

test('changing a group activity updates inherited steps without restoring the previous type or losing IDs', () => {
  const previousText = 'Shadow Boxing 3 rounds\n- 2min\n- Burpees 30s\n- 1min @ repos';
  const original = parse(previousText).blocks;
  original[0].children[0].future = { preserve: true }; original[0].children[0].notes = 'Conserver';
  const result = reconcileTrainingBlocks(parse(previousText.replace('Shadow Boxing', 'Sac')), original, previousText);
  assert.deepEqual(result.blocks[0].children.map(block => block.type), ['bag', 'burpees', 'bag']);
  assert.equal(result.blocks[0].id, original[0].id);
  assert.deepEqual(result.blocks[0].children.map(block => block.id), original[0].children.map(block => block.id));
  assert.deepEqual(result.blocks[0].children[0].future, { preserve: true }); assert.equal(result.blocks[0].children[0].notes, 'Conserver');
  const source = 'Shadow Boxing 3 rounds\n- 2min\n- 1min', before = parse(source, { sport: 'running' }).blocks;
  const after = reconcileTrainingBlocks(parse(source.replace('\n- 1min', '\n\n- 1min'), { sport: 'running' }), before, source);
  assert.equal(after.blocks[0].children.length, 1); assert.equal(after.blocks[1].type, 'run'); assert.equal(after.blocks[1].id, before[0].children[1].id);
});

test('contextual groups serialize to explicit activities with the same durations, instructions and rest targets', () => {
  const result = parse('3 rounds de Shadow\n- 2min - Garder les mains hautes\n- Burpees 30s\n- 1min @ repos');
  const serialized = serializeTrainingDocument(result.blocks), restored = parse(serialized.text);
  const semantic = blocks => summarizeBlocks(blocks).segments.map(block => [block.type, block.duration_seconds, block.description, block.effort]);
  assert.deepEqual(semantic(restored.blocks), semantic(result.blocks));
  assert.ok(serialized.text.includes('- Shadow 2min')); assert.equal(serialized.lines[0].blockId, result.blocks[0].id);
  const reconciled = reconcileTrainingBlocks(parse(`Titre libre\n${serialized.text}`), serialized.blocks, serialized.text);
  assert.deepEqual(reconciled.blocks[0].children.map(block => block.id), result.blocks[0].children.map(block => block.id));
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


test('an exact activity title immediately above a neutral round header scopes untyped steps and includes the last rest', () => {
  const text = 'Shadow boxing\n3 rounds\n- 3 minutes @ RPE 4-6\n- Repos 1 minute';
  const result = parse(text, { sport: 'running' }), group = result.blocks[0];
  assert.equal(result.blocks.length, 1); assert.equal(group.repeat_count, 3); assert.equal(group.repeat_unit, 'rounds');
  assert.deepEqual(group.children.map(block => [block.type, block.duration_seconds]), [['shadow', 180], ['recovery', 60]]);
  assert.deepEqual([group.children[0].effort.kind, group.children[0].effort.min, group.children[0].effort.max], ['rpe', 4, 6]);
  assert.equal(group.children[1].effort.label, 'Repos'); assert.equal(summarizeBlocks(result.blocks).duration_seconds, 720);
  assert.deepEqual(summarizeBlocks(result.blocks).segments.map(block => block.duration_seconds), [180, 60, 180, 60, 180, 60]);
  assert.deepEqual(result.lines.map(line => line.kind), ['text', 'repeat', 'step', 'step']);
  assert.equal(text.slice(result.lines[0].start, result.lines[0].end), 'Shadow boxing');
  for (const heading of ['Shadow', 'SHADOW BOXING', '  shadow   boxing  ']) {
    const inherited = parse(`${heading}\r\n3rounds\r\n- 3min\r\n- Repos 1min`, { sport: 'running' });
    assert.equal(inherited.blocks[0].children[0].type, 'shadow');
  }
});

test('an adjacent Jog title scopes distance repetitions without inferring a duration or overriding explicit activities', () => {
  const result = parse('Jog\n5 x\n- 400mtr @ Z2-Z4\n- Marche 200 mètres\n- 100mtr Course\n- 50mtr', { sport: 'boxing' });
  const group = result.blocks[0]; assert.equal(group.repeat_count, 5); assert.equal(group.repeat_unit, undefined);
  assert.deepEqual(group.children.map(block => block.type), ['jog', 'walk', 'run', 'jog']);
  assert.deepEqual(group.children.map(block => block.distance_m), [400, 200, 100, 50]);
  assert.ok(group.children.every(block => block.duration_seconds === null));
  const summary = summarizeBlocks(result.blocks); assert.equal(summary.distance_m, 3750); assert.equal(summary.duration_seconds, 0);
  const explicit = parse('Shadow\n3 rounds\n- Shadow3min @ RPE 4-6\n- Repos 1min');
  assert.deepEqual(explicit.blocks[0].children.map(block => block.type), ['shadow', 'recovery']);
});

test('only adjacent known activity titles establish a group scope; prose and blank lines never do', () => {
  for (const title of ['Travail au sac', 'Échauffement technique', 'Shadow @ RPE 6', 'Autre']) {
    const result = parse(`${title}\n3 rounds\n- 1min`, { sport: 'running' });
    assert.equal(result.blocks[0].children[0].type, 'run', title);
  }
  for (const between of ['\n', '\nUne consigne\n', '\n   \n', '\n- Repos 30s\n']) {
    const result = parse(`Shadow\n${between}3 rounds\n- 1min`, { sport: 'running' });
    const group = result.blocks.find(block => block.kind === 'repeat'); assert.equal(group.children[0].type, 'run', between);
  }
  const result = parse('Shadow\n3 rounds\n- 1min\nCourse\n- 30s\n\n- 1min\n\n2x\n- 15s', { sport: 'running' });
  assert.deepEqual(result.blocks[0].children.map(block => block.type), ['shadow', 'shadow']);
  assert.equal(result.blocks[1].type, 'run'); assert.equal(result.blocks[2].children[0].type, 'run');
  assert.equal(parse('Shadow\n- 1min', { sport: 'running' }).blocks[0].type, 'run');
});

test('an explicit one-line group heading takes priority over the activity title above it', () => {
  for (const heading of ['Jog 3x', '3 rounds de Jog', '3 x de Jog']) {
    const result = parse(`Shadow\n${heading}\n- 1min`, { sport: 'boxing' });
    assert.equal(result.blocks[0].children[0].type, 'jog');
  }
});

test('editing an adjacent activity title updates inherited steps while keeping IDs, hidden fields and explicit overrides', () => {
  const previousText = 'Shadow boxing\n3 rounds\n- 3 minutes @ RPE 4-6\n- Repos 1 minute\n- 30s';
  const original = parse(previousText, { sport: 'boxing' }).blocks;
  original[0].children[0].future = { retain: true }; original[0].children[0].notes = 'Garder la note';
  const updatedText = previousText.replace('Shadow boxing', 'Sac');
  const result = reconcileTrainingBlocks(parse(updatedText, { sport: 'boxing' }), original, previousText);
  assert.equal(result.blocks[0].id, original[0].id);
  assert.deepEqual(result.blocks[0].children.map(block => block.id), original[0].children.map(block => block.id));
  assert.deepEqual(result.blocks[0].children.map(block => block.type), ['bag', 'recovery', 'bag']);
  assert.deepEqual(result.blocks[0].children[0].future, { retain: true }); assert.equal(result.blocks[0].children[0].notes, 'Garder la note');
  assert.deepEqual(result.blocks[0].children[0].effort, original[0].children[0].effort);
  assert.equal(summarizeBlocks(result.blocks).duration_seconds, summarizeBlocks(original).duration_seconds);
  const removedContext = reconcileTrainingBlocks(parse(previousText.replace('Shadow boxing\n', 'Shadow boxing\n\n'), { sport: 'running' }), original, previousText);
  assert.deepEqual(removedContext.blocks[0].children.map(block => block.type), ['run', 'recovery', 'run']);
  assert.deepEqual(removedContext.blocks[0].children.map(block => block.id), original[0].children.map(block => block.id));
  const ordinaryTitle = reconcileTrainingBlocks(parse(previousText.replace('Shadow boxing', 'Travail technique'), { sport: 'boxing' }), original, previousText);
  assert.deepEqual(ordinaryTitle.blocks[0].children.map(block => block.type), ['other', 'recovery', 'other']);
  assert.equal(ordinaryTitle.blocks[0].children[0].title, 'Boxe');
});
