import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountPunchCounter } from '../js/punch-counter.js';

function fixture(state = { blue: 0, red: 0, rounds: [] }) {
  const window = new Window();
  const host = window.document.createElement('main');
  window.document.body.append(host);
  let activities = 0, resets = 0;
  const bound = [];
  const options = {
    state,
    bindTap(button, callback) { bound.push(button.id); button.addEventListener('click', callback); },
    onActivity() { activities++; },
    onReset() { resets++; },
  };
  mountPunchCounter(host, options);
  return {
    state, bound, host,
    $: id => host.querySelector(`#${id}`),
    get activities() { return activities; }, get resets() { return resets; },
    remount: () => mountPunchCounter(host, options),
    close: () => window.happyDOM.abort(),
  };
}

test('counter keeps independent corner controls and starts in round one without history', async () => {
  const app = fixture();
  try {
    assert.deepEqual(app.bound, ['blueAdd', 'redAdd']);
    assert.equal(app.$('punchRound').textContent, 'Round 1');
    assert.equal(app.$('punchRoundHistoryPanel').hidden, true);
    assert.equal(app.$('blueUndo').disabled, true);
    assert.equal(app.$('redUndo').disabled, true);
    app.$('blueAdd').click(); app.$('redAdd').click(); app.$('redAdd').click();
    assert.deepEqual(app.state, { blue: 1, red: 2, rounds: [] });
    assert.equal(app.activities, 3);
    app.$('blueUndo').click(); app.$('blueUndo').click();
    assert.equal(app.$('blueCount').textContent, '0');
    assert.equal(app.$('redCount').textContent, '2');
    assert.equal(app.$('blueUndo').disabled, true);
  } finally { await app.close(); }
});

test('next round archives immutable blue and red snapshots then clears just the current counters', async () => {
  const app = fixture({ blue: 23, red: 38, rounds: [] });
  try {
    app.$('punchNextRound').click();
    assert.deepEqual(app.state, { blue: 0, red: 0, rounds: [{ blue: 23, red: 38 }] });
    assert.equal(app.$('punchRound').textContent, 'Round 2');
    assert.equal(app.$('punchRoundHistoryPanel').hidden, false);
    const first = app.$('punchRoundHistory').firstElementChild;
    assert.equal(first.querySelector('.punch-history-round').textContent, 'Round 1');
    assert.equal(first.querySelector('.punch-history-blue').textContent, '23');
    assert.equal(first.querySelector('.punch-history-red').textContent, '38');
    assert.equal(first.querySelector('.punch-history-blue').getAttribute('aria-label'), 'Coin bleu : 23 coups');
    assert.equal(first.querySelector('.punch-history-red').getAttribute('aria-label'), 'Coin rouge : 38 coups');
    assert.equal(app.$('blueUndo').disabled, true);
    app.$('blueAdd').click(); app.$('redAdd').click(); app.$('redUndo').click();
    app.$('punchNextRound').click();
    assert.deepEqual(app.state.rounds, [{ blue: 23, red: 38 }, { blue: 1, red: 0 }]);
    assert.equal(app.$('punchRoundHistory').children.length, 2);
    assert.equal(app.$('punchRound').textContent, 'Round 3');
    assert.equal(app.activities, 4);
    assert.equal(app.resets, 0);
  } finally { await app.close(); }
});

test('a scoreless round can be archived and no preset round limit stops the counter', async () => {
  const app = fixture();
  try {
    for (let round = 0; round < 25; round++) app.$('punchNextRound').click();
    assert.equal(app.$('punchRound').textContent, 'Round 26');
    assert.equal(app.state.rounds.length, 25);
    assert.ok(app.state.rounds.every(round => round.blue === 0 && round.red === 0));
    assert.equal(app.$('punchRoundHistory').children.length, 25);
  } finally { await app.close(); }
});

test('remount restores the current round and history; reset clears everything and returns to round one', async () => {
  const rounds = [{ blue: 23, red: 38 }, { blue: 15, red: 12 }];
  const app = fixture({ blue: 7, red: 4, rounds });
  try {
    app.remount();
    assert.equal(app.$('punchRound').textContent, 'Round 3');
    assert.equal(app.$('blueCount').textContent, '7');
    assert.equal(app.$('redCount').textContent, '4');
    assert.equal(app.$('punchRoundHistory').children.length, 2);
    app.$('punchReset').click();
    assert.deepEqual(app.state, { blue: 0, red: 0, rounds: [] });
    assert.equal(rounds.length, 0, 'the owning state keeps the same history array');
    assert.equal(app.$('punchRound').textContent, 'Round 1');
    assert.equal(app.$('punchRoundHistory').children.length, 0);
    assert.equal(app.$('punchRoundHistoryPanel').hidden, true);
    assert.equal(app.resets, 1);
    assert.equal(app.activities, 0);
    app.$('punchNextRound').click();
    assert.equal(app.$('punchRound').textContent, 'Round 2');
  } finally { await app.close(); }
});
