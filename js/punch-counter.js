/** A session stays in the owning page's state; changing rounds does not erase earlier scores. */
export function mountPunchCounter(host, { state, bindTap, onActivity = () => {}, onReset = () => {} }) {
  const doc = host.ownerDocument;
  const $ = id => host.querySelector(`#${id}`);
  state.rounds ??= [];
  host.innerHTML = `
    <p class="tool-instructions">Un appui = un coup. Les deux coins peuvent être touchés en même temps.</p>
    <p id="punchRound" class="punch-round" aria-live="polite"></p>
    <div class="punch-counters">
      ${[['blue', 'bleu'], ['red', 'rouge']].map(([corner, name]) => `
        <div class="punch-corner">
          <button id="${corner}Add" type="button" class="punch-button punch-${corner}">
            <span>Coin ${name}</span><span id="${corner}Count" class="punch-number">0</span><span>+ 1 coup</span>
          </button>
          <button id="${corner}Undo" type="button" class="button secondary" aria-label="Retirer un coup au coin ${name}">− 1 coup</button>
        </div>`).join('')}
    </div>
    <div class="counter-actions">
      <button id="punchReset" class="button secondary" type="button">Remettre à zéro</button>
      <button id="punchNextRound" class="button" type="button">Round suivant</button>
    </div>
    <section id="punchRoundHistoryPanel" class="punch-history" aria-labelledby="punchHistoryTitle" hidden>
      <h2 id="punchHistoryTitle">Rounds terminés</h2>
      <ol id="punchRoundHistory" class="punch-history-list"></ol>
    </section>`;

  function drawCurrent() {
    const roundLabel = `Round ${state.rounds.length + 1}`;
    if ($('punchRound').textContent !== roundLabel) $('punchRound').textContent = roundLabel;
    for (const corner of ['blue', 'red']) {
      $(`${corner}Count`).textContent = String(state[corner]);
      $(`${corner}Add`).setAttribute('aria-label', `Coin ${corner === 'blue' ? 'bleu' : 'rouge'} : ${state[corner]} coups. Ajouter un coup`);
      $(`${corner}Undo`).disabled = !state[corner];
    }
  }

  function drawHistory() {
    $('punchRoundHistoryPanel').hidden = state.rounds.length === 0;
    const entries = state.rounds.map((round, index) => {
      const row = doc.createElement('li');
      row.className = 'punch-history-row';
      const label = doc.createElement('span');
      label.className = 'punch-history-round';
      label.textContent = `Round ${index + 1}`;
      row.append(label);
      for (const corner of ['blue', 'red']) {
        if (corner === 'red') {
          const separator = doc.createElement('span');
          separator.className = 'punch-history-separator';
          separator.textContent = '–';
          separator.setAttribute('aria-hidden', 'true');
          row.append(separator);
        }
        const score = doc.createElement('span');
        score.className = `punch-history-score punch-history-${corner}`;
        score.textContent = String(round[corner]);
        score.setAttribute('aria-label', `Coin ${corner === 'blue' ? 'bleu' : 'rouge'} : ${round[corner]} coups`);
        row.append(score);
      }
      return row;
    });
    $('punchRoundHistory').replaceChildren(...entries);
  }

  for (const corner of ['blue', 'red']) {
    bindTap($(`${corner}Add`), () => {
      state[corner]++;
      drawCurrent();
      onActivity();
    });
    $(`${corner}Undo`).addEventListener('click', () => {
      state[corner] = Math.max(0, state[corner] - 1);
      drawCurrent();
    });
  }
  $('punchNextRound').addEventListener('click', () => {
    state.rounds.push({ blue: state.blue, red: state.red });
    state.blue = state.red = 0;
    draw();
    onActivity();
  });
  $('punchReset').addEventListener('click', () => {
    state.blue = state.red = 0;
    state.rounds.length = 0;
    draw();
    onReset();
  });

  function draw() { drawCurrent(); drawHistory(); }
  draw();
  return { draw };
}
