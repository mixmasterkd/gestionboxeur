import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBlock, ZONE_COLORS } from '../js/domain.js';
import { sessionChartData } from '../js/session-chart.js';
import { compileTimerText, timerTextFromSession, timerEffortAppearance } from '../js/timer-program.js';

const step = values => ({ ...makeBlock('other'), ...values });
const repeat = (count, children, values = {}) => ({ ...makeBlock('repeat'), repeat_count: count, children, ...values });

test('timer accepts the workout Help units and equivalent prime notation', () => {
  for (const value of ['1m30', '1 min 30 sec', "1'30\"", '1’30″', '1′30″', '90s', '90sec', '90 secondes', '90SC', '1,5min']) {
    const result = compileTimerText(`- ${value}`);
    assert.equal(result.totalSeconds, 90, value);
    assert.equal(result.commands, '- 1m30s');
    assert.equal(result.phases[0].kind, 'work');
  }
  assert.equal(compileTimerText('- 30\'').totalSeconds, 1800);
  assert.equal(compileTimerText('- 30"').totalSeconds, 30);
  assert.equal(compileTimerText('- 1h2m3s').totalSeconds, 3723);
});

test('two groups repeat their exact command sequence including explicitly written final rests', () => {
  const text = '3x\n-1m @ Z3\n-45" @ Z4\n-30s @ Repos\n\n4 rounds\n-1\' @ Z2\n-12" @ repos';
  const result = compileTimerText(text, { preparation: 5 });
  assert.equal(result.steps, 17);
  assert.equal(result.phases.length, 18);
  assert.equal(result.totalSeconds, 698);
  assert.deepEqual(result.phases.slice(1, 4).map(phase => [phase.kind, phase.seconds]), [['work', 60], ['work', 45], ['rest', 30]]);
  assert.equal(result.phases.at(-1).kind, 'rest');
  assert.equal(result.phases.at(-1).round, 4);
  assert.equal(result.phases.at(-1).rounds, 4);
  assert.equal(result.phases.at(-1).group, 2);
  assert.equal(result.phases.at(-1).groupStep, 2);
  assert.equal(compileTimerText(result.commands).totalSeconds, 693);
});

test('commands alone survive calendar copy with no titles, notes, activities or names', () => {
  const session = { title: 'Privé Jean Tremblay', notes: 'Téléphone 555-0100', sport: 'boxing', workout_document: { version: 1,
    text: '# Privé Jean Tremblay\nPrévoir gants\nShadow Boxing 2 rounds\nConseil pour Éric\n- Sac 1m @ Z3 - Garder les mains hautes\n- 30s @ repos\n\n- Respirer calmement', marks: [] },
    blocks: [step({ duration_seconds: 999, title: 'Ancien bloc' })] };
  const before = structuredClone(session), commands = timerTextFromSession(session);
  assert.equal(commands, '2 rounds\n- 1m @ Z3\n- 30s @ Repos');
  assert.doesNotMatch(commands, /Jean|Éric|555|Conseil|Sac|Shadow|Respirer/);
  assert.equal(compileTimerText(commands).totalSeconds, 180);
  assert.deepEqual(session, before);
});

test('source text remains authoritative over stale saved block doses and understood group syntax', () => {
  const session = { workout_document: { text: 'Shadow Boxing 3 rounds\n- 2min\n- 1min @ repos' }, blocks: [step({ duration_seconds: 120 }), step({ duration_seconds: 60 })] };
  assert.equal(compileTimerText(timerTextFromSession(session)).totalSeconds, 540);
  session.workout_document.text = '- 45s @ Z4';
  assert.equal(compileTimerText(timerTextFromSession(session)).totalSeconds, 45);
  session.workout_document.text = 'Juste une note';
  assert.throws(() => timerTextFromSession(session), /au moins une étape/);
});

test('legacy compact rounds preserve their exact rest placement and hide all prose', () => {
  const session = { blocks: [step({ title: 'Mike au sac', notes: 'Appeler Mike', description: 'Jab', rounds: 3, work_seconds: 60, rest_seconds: 20, duration_seconds: 999, zone: 4 })] };
  const before = structuredClone(session), commands = timerTextFromSession(session), result = compileTimerText(commands);
  assert.equal(result.totalSeconds, 220);
  assert.deepEqual(result.phases.map(phase => [phase.kind, phase.seconds]), [['work', 60], ['rest', 20], ['work', 60], ['rest', 20], ['work', 60]]);
  assert.equal(result.phases[0].color, ZONE_COLORS[4]);
  assert.doesNotMatch(commands, /Mike|sac|Appeler|Jab|999/);
  assert.deepEqual(session, before);
});

test('legacy nested repeats preserve order, durations, efforts and round-group repetition', () => {
  const session = { blocks: [repeat(2, [repeat(2, [step({ duration_seconds: 10, zone: 3 }), step({ duration_seconds: 5, effort: { kind: 'recovery', label: 'Repos' } })]), step({ duration_seconds: 20, effort: { kind: 'rpe', min: 6, max: 7 } })], { repeat_unit: 'rounds' })] };
  const result = compileTimerText(timerTextFromSession(session));
  assert.equal(result.totalSeconds, 100);
  assert.equal(result.steps, 10);
  assert.equal(result.phases.at(-1).round, 2);
  assert.equal(result.phases.at(-1).label, 'RPE 6-7/10');
});

test('legacy free prose is not copied as a command and known untimed exercises need a duration', () => {
  const session = { blocks: [step({ title: 'Respirer calmement', description: 'Conseil de Mike' }), step({ duration_seconds: 30 })] };
  assert.equal(timerTextFromSession(session), '- 30s');
  assert.throws(() => timerTextFromSession({ blocks: [{ ...makeBlock('burpees'), title: 'Burpees' }] }), /durée/);
  const withoutIds = { blocks: [step({ id: undefined, title: 'Une note de Mike' }), step({ id: undefined, duration_seconds: 30 })] };
  assert.equal(timerTextFromSession(withoutIds), '- 30s');
  assert.equal(withoutIds.blocks[0].id, undefined);
  assert.throws(() => timerTextFromSession({ blocks: [step({ id: 'shared', duration_seconds: 0 }), step({ id: 'shared', title: 'Une note' })] }), /positive/);
});

test('distance and movement counts cannot silently vanish or acquire invented times', () => {
  for (const text of ['- 400mtr', '- Burpees 10x', '- 1m\n- 1km', '2x\n- 20s\n- 12x']) {
    assert.throws(() => compileTimerText(text), /distance|mouvements/, text);
    assert.throws(() => timerTextFromSession({ workout_document: { text } }), /distance|mouvements/, text);
  }
  assert.throws(() => timerTextFromSession({ blocks: [step({ distance_m: 400 })] }), /durée/);
  assert.throws(() => timerTextFromSession({ blocks: [step({ repetitions: 12 })] }), /durée/);
  const mixed = compileTimerText('- Jog 1min + 400mtr\n- Burpees 30s + 10x');
  assert.equal(mixed.commands, '- 1m\n\n- 30s');
  assert.equal(mixed.totalSeconds, 90);
});

test('malformed timer commands block the full program instead of being dropped as prose', () => {
  for (const bad of ['-1mxx', '- 0s', '- 1m @ Z9', '- 1m @', '-10', '- 1qq', '1m', '1mxx', '- Burpees', '- 1m @ Éric', '2x\n- 1m\n3x\n- 30s']) {
    assert.throws(() => compileTimerText(`- 30s\n${bad}`), /Ligne/, bad);
  }
  assert.throws(() => compileTimerText('2x\nUne note'), /étape/);
  assert.throws(() => compileTimerText('- 1m', { preparation: -1 }), /préparation/);
  assert.throws(() => compileTimerText('- 1m', { preparation: 61 }), /préparation/);
  assert.throws(() => compileTimerText('- 1m', { preparation: 1.5 }), /préparation/);
});

test('timer retains graph palette values and range endpoints without inventing intermediate zones', () => {
  for (let zone = 1; zone <= 7; zone++) {
    const phase = compileTimerText(`- 10s @ Z${zone}`).phases[0];
    assert.equal(phase.color, ZONE_COLORS[zone]);
    assert.equal(phase.kind, 'work', 'Z1 is a zone, not an implicit rest');
    assert.equal(phase.label, `Z${zone}`);
  }
  const range = compileTimerText('- 1m @ Z2 - Z4 - Consigne').phases[0];
  assert.equal(range.label, 'Z2-Z4');
  assert.equal(range.range, true);
  assert.equal(range.color, ZONE_COLORS[2]);
  assert.equal(range.highColor, ZONE_COLORS[4]);
  assert.doesNotMatch(JSON.stringify(range), /Z3/);
});

test('default work is green, explicit rests are gray and preparation stays dark', () => {
  const phases = compileTimerText('- 10s\n- 10s @ Repos\n- 10s @ Z1', { preparation: 5 }).phases;
  assert.deepEqual(phases.map(phase => phase.color), ['#111317', '#25a567', '#a3a9b2', '#9298a1']);
  assert.deepEqual(phases.map(phase => phase.kind), ['prepare', 'work', 'rest', 'work']);
  assert.equal(timerEffortAppearance({ kind: 'rest' }).color, '#a3a9b2');
  assert.equal(timerEffortAppearance(null).label, 'Travail');
});

test('timer-only preparation commands are visible, black, canonical and not a numbered work step', () => {
  const result = compileTimerText('- 7s @ préparation\n\n2x\n- 45s @ Z3\n- 15s @ Repos');
  assert.equal(result.phases[0].kind, 'prepare');
  assert.equal(result.phases[0].color, '#111317');
  assert.equal(result.phases[0].label, 'Préparation');
  assert.equal(result.phases[1].index, 1);
  assert.equal(result.phases[1].group, 1);
  assert.equal(result.steps, 4);
  assert.equal(result.totalSeconds, 127);
  assert.match(result.commands, /^- 7s @ Préparation\n\n2x/);
  assert.deepEqual(compileTimerText(result.commands), result);
  assert.equal(compileTimerText('- 1m @ Preparation\n- 1s').phases[0].seconds, 60);
});

test('preparation must be positive, unique, initial and outside repeated groups', () => {
  for (const text of ['- 0s @ Préparation\n- 1m', '- 61s @ Préparation\n- 1m', '- 0.5s @ Préparation\n- 1m', '- 5s @ Préparation\n- 6s @ Préparation\n- 1m', '- 1m\n- 5s @ Préparation', '2x\n- 5s @ Préparation\n- 1m', '1x\n- 5s @ Préparation\n- 1m', '- 5s @ Préparation']) {
    assert.throws(() => compileTimerText(text), /préparation|positive/i, text);
  }
  assert.throws(() => compileTimerText('- 5s @ Préparation\n- 1m', { preparation: 5 }), /deux fois/);
  assert.equal(compileTimerText('# note\n- 5s @ Préparation\n- 1m').totalSeconds, 65);
});

test('RPE and named color targets reuse graph colors; absolute efforts stay neutral', () => {
  for (const effort of [{ kind: 'rpe', min: 6, max: 8 }, { kind: 'color', min: 1, max: 3 }, { kind: 'bpm', min: 120, max: 150 }, { kind: 'pace', min: 330, max: 390 }]) {
    const expected = sessionChartData({ blocks: [step({ duration_seconds: 60, effort })] }).bars[0];
    const actual = timerEffortAppearance(effort);
    assert.equal(actual.color, expected.color);
    assert.equal(actual.highColor, expected.highColor);
    assert.equal(actual.range, expected.range);
    assert.equal(actual.label, expected.name);
  }
  const phases = compileTimerText('- 1m @ 120-150 bpm\n- 1m @ 5:30-6:30/km\n- 1m @ Marche\n- 1m @ Repos actif').phases;
  assert.ok(phases.every(phase => phase.kind === 'work'));
  assert.equal(phases[0].color, '#939eae');
});

test('program bounds and cycles are rejected before expansion without mutating source', () => {
  assert.throws(() => compileTimerText('101x\n- 1s'), /répétitions/);
  assert.throws(() => compileTimerText('- 1000001s'), /limite/);
  assert.throws(() => compileTimerText('x'.repeat(20001)), /20/);
  const cyclic = repeat(2, []); cyclic.children.push(cyclic);
  assert.throws(() => timerTextFromSession({ blocks: [cyclic] }), /circulaire/);
  const group = repeat(100, [repeat(100, [step({ duration_seconds: 1 }), step({ duration_seconds: 1 })])]);
  assert.throws(() => timerTextFromSession({ blocks: [group] }), /10/);
});

test('numbered prose is stripped and calendar prose that mentions durations never becomes a command', () => {
  const prose = ['3 conseils pour demain', '2026 : nouvelle saison', '- 2 conseils importants', '# 3x\n# - 2m @ Z5', 'Rappel : arriver à 18:30', 'Faire 3 séries dans la semaine'].join('\n');
  assert.equal(compileTimerText(`${prose}\n- 30s`).commands, '- 30s');
  const source = `${prose}\n30 secondes avant le départ, ajuster les gants\n1m @ Z3\n- 45s @ Z2`;
  assert.equal(timerTextFromSession({ workout_document: { text: source } }), '- 45s @ Z2');
  assert.throws(() => timerTextFromSession({ workout_document: { text: `${source}\n- 30ss` } }), /Ligne/);
  assert.equal(compileTimerText('2x\n- 10s\n# 5x\n// - 20s @ Z4\n- 5s @ Repos').totalSeconds, 30);
});

test('all Help unit spellings keep the same meaning and canonical commands round-trip', () => {
  const cases = [['3m', 180], ['3 min', 180], ['3 minutes', 180], ['3 minute', 180], ['3\'', 180], ['30s', 30], ['30 sc', 30], ['30 sec', 30], ['30 secondes', 30], ['30 seconde', 30], ['30"', 30], ['1m30s', 90], ['1 min 30 sec', 90], ['1\'30"', 90], ['1’30″', 90], ['1h', 3600], ['1 heure', 3600], ['2 heures', 7200], ['0,5s', .5], ['.5m', 30], ['0.0000001s', 1e-7]];
  for (const [dose, seconds] of cases) {
    const compiled = compileTimerText(`- ${dose.toUpperCase()}`);
    assert.equal(compiled.totalSeconds, seconds, dose);
    assert.equal(compileTimerText(compiled.commands).totalSeconds, seconds, compiled.commands);
  }
  for (const distance of ['400mtr', '400 MTR', '400 mètres', '400 metre', '2km', '2 KM', '2 kilomètres']) assert.throws(() => compileTimerText(`- ${distance}`), /distance/, distance);
});

test('groups accept spacing, Unicode multiplication, CRLF and preserve single-iteration groups', () => {
  for (const header of ['3x', '3 x', '3rounds', '3 rounds', '3×', 'Shadow Boxing 3 rounds', '3 rounds de Shadow', 'Jog 3x', '3x de Jog']) {
    const compiled = compileTimerText(`${header}\r\n- 1s\r\n- 2s @ Repos\r\n\r\n- 3s`);
    assert.equal(compiled.totalSeconds, 12, header);
    assert.equal(compiled.steps, 7, header);
    assert.deepEqual(compiled.phases.slice(0, 6).map(phase => phase.round), [1, 1, 2, 2, 3, 3]);
  }
  assert.equal(compileTimerText('1 round\n- 10s\n- 2s @ Repos').commands, '1 rounds\n- 10s\n- 2s @ Repos');
  assert.throws(() => compileTimerText('3x\n\n- 10s'), /étape/);
});

test('range spacing, zone basis and edge values retain endpoints while malformed ranges fail', () => {
  for (const source of ['Z2-Z4', 'Z2 - Z4', 'Z2-4', 'zone 2 - zone 4']) {
    const compiled = compileTimerText(`- 1m @ ${source}`), phase = compiled.phases[0];
    assert.equal(phase.color, ZONE_COLORS[2]); assert.equal(phase.highColor, ZONE_COLORS[4]);
    assert.equal(phase.label, 'Z2-Z4'); assert.equal(phase.range, true);
    assert.equal(compileTimerText(compiled.commands).phases[0].label, phase.label);
  }
  assert.equal(compileTimerText('- 1m @ Z1-Z7 FC').phases[0].label, 'Z1-Z7 FC');
  assert.equal(compileTimerText('- 1m @ Z3 Allure').phases[0].label, 'Z3 Allure');
  for (const invalid of ['Z4-Z2', 'Z0-Z4', 'Z2-Z8', 'Z2 - 4 - 5', 'Z2-RPE4', 'RPE 0', 'RPE 11', 'RPE 7-4', 'Rouge-Vert']) assert.throws(() => compileTimerText(`- 1m @ ${invalid}`), /Ligne/, invalid);
  assert.equal(compileTimerText('- 1m @ Z2 - RPE 4 pour la prochaine séance').commands, '- 1m @ Z2');
});

test('expanded step limit accepts exactly 10,000, rejects excess, and never drops a group at text limits', () => {
  const hundredSteps = Array.from({ length: 100 }, () => '- 1s').join('\n');
  const max = compileTimerText(`100x\n${hundredSteps}`, { preparation: 60 });
  assert.equal(max.steps, 10000); assert.equal(max.phases.length, 10001); assert.equal(max.totalSeconds, 10060);
  assert.throws(() => compileTimerText(`100x\n${hundredSteps}\n\n- 1s`), /étapes/);
  assert.throws(() => compileTimerText(`${hundredSteps}\n- 1s`), /blocs/);
  assert.equal(compileTimerText(`${'a'.repeat(19994)}\n- 1s`).totalSeconds, 1);
  assert.throws(() => compileTimerText(`${'a'.repeat(19996)}\n- 1s`), /caractères/);
});
