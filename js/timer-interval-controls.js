import { readDuration, displayDuration } from './timer-interval-settings.js';

const durations = [['work', 'Travail', 1, 3600], ['rest', 'Repos', 0, 3600], ['seriesRest', 'Entre les séries', 0, 3600], ['preparation', 'Préparation', 0, 60]];
export function intervalControlsMarkup(config) {
  return `<section id="timerSettings" class="interval-settings" aria-label="Réglages des intervalles">
    <div class="interval-mode-tabs" role="tablist" aria-label="Mode du timer">
      <button id="timerModeBase" type="button" role="tab" aria-controls="timerBasePanel" aria-selected="true">Base</button>
      <button id="timerModeAdvanced" type="button" role="tab" aria-controls="timerAdvancedPanel" aria-selected="false" tabindex="-1">Avancé</button>
    </div>
    <div id="timerBasePanel" role="tabpanel" aria-labelledby="timerModeBase"><form id="timerForm"><fieldset id="timerFields" class="interval-fields">
      <div class="interval-counts">${[['rounds', 'Répétitions'], ['series', 'Séries']].map(([name, label]) => `<label for="interval-${name}"><span>${label}</span><input id="interval-${name}" name="${name}" aria-label="${name === 'rounds' ? 'Répétitions par série' : 'Nombre de séries'}" type="number" inputmode="numeric" min="1" max="99" value="${config[name]}" required></label>`).join('')}</div>
      ${durations.map(([name, label]) => `<div id="interval-${name}-row" class="interval-duration-row"${name === 'seriesRest' && config.series === 1 ? ' hidden' : ''}><label for="interval-${name}">${label}</label><div class="interval-duration-input"><input id="interval-${name}" name="${name}" type="number" required><div class="interval-unit-toggle" role="group" aria-label="Unité : ${label}">${['M', 'S'].map(unit => `<button type="button" data-duration="${name}" data-unit="${unit}" aria-label="${label} en ${unit === 'M' ? 'minutes' : 'secondes'}" title="${unit === 'M' ? 'Minutes' : 'Secondes'}" aria-pressed="false">${unit}</button>`).join('')}</div></div></div>`).join('')}
    </fieldset></form></div>
    <div id="timerAdvancedPanel" role="tabpanel" aria-labelledby="timerModeAdvanced" hidden>
      <label for="timerProgramText" class="timer-program-label">Commandes du timer</label>
      <textarea id="timerProgramText" rows="11" maxlength="20000" spellcheck="false" autocapitalize="off" aria-describedby="timerProgramError"></textarea>
      <p id="timerProgramError" class="form-error" role="alert" hidden></p>
    </div><p id="timerSettingsHint" class="timer-help" hidden>Réinitialise le timer pour modifier les réglages.</p>
  </section>`;
}

/** Base and Advanced are separate drafts, selected by accessible, reversible tabs. */
export function mountIntervalControls(host, { config, units, draft, onChange }) {
  const $ = id => host.querySelector(`#${id}`), form = $('timerForm');
  let locked = false, lastSeriesRest = config.seriesRest;
  const tabs = [$('timerModeBase'), $('timerModeAdvanced')];
  function paintDuration(name, seconds) {
    const [, label, min, max] = durations.find(field => field[0] === name), unit = units[name];
    const input = form.elements[name];
    input.value = displayDuration(seconds, unit);
    input.min = displayDuration(min, unit); input.max = displayDuration(max, unit);
    input.step = unit === 'M' ? 'any' : '1'; input.inputMode = unit === 'M' ? 'decimal' : 'numeric';
    input.setAttribute('aria-label', `${label} en ${unit === 'M' ? 'minutes' : 'secondes'}`);
    input.setCustomValidity('');
    host.querySelectorAll(`[data-duration="${name}"]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.unit === unit)));
  }
  function syncSeriesRest() {
    const hidden = Number(form.elements.series.value) === 1;
    $('interval-seriesRest-row').hidden = hidden;
    form.elements.seriesRest.disabled = hidden;
    host.querySelectorAll('[data-duration="seriesRest"]').forEach(button => { button.disabled = hidden; });
  }
  function sync() {
    tabs.forEach((tab, index) => {
      const active = index === Number(draft.custom);
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; tab.disabled = locked;
    });
    $('timerBasePanel').hidden = draft.custom; $('timerAdvancedPanel').hidden = !draft.custom;
    $('timerFields').disabled = locked || draft.custom;
    $('timerProgramText').disabled = locked;
    syncSeriesRest();
  }
  function switchMode(custom) {
    if (locked || custom === draft.custom) return;
    draft.custom = custom; sync(); onChange('mode');
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchMode(Boolean(index)));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || locked) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      switchMode(Boolean(next)); tabs[next].focus();
    });
  });
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => {
    if (event.target.setCustomValidity) event.target.setCustomValidity('');
    if (!locked && !draft.custom) onChange('base');
  });
  form.addEventListener('change', () => { if (!locked && !draft.custom) onChange('base'); });
  host.querySelectorAll('[data-duration]').forEach(button => button.addEventListener('click', () => {
    if (locked || draft.custom) return;
    const name = button.dataset.duration, target = button.dataset.unit;
    if (units[name] === target) return;
    const [, , min, max] = durations.find(field => field[0] === name), input = form.elements[name];
    try {
      const seconds = readDuration(input.value, units[name], { min, max });
      units[name] = target; paintDuration(name, seconds); onChange('units');
    } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
  }));
  $('timerProgramText').value = draft.text;
  $('timerProgramText').addEventListener('input', () => {
    if (locked || !draft.custom) return;
    draft.text = $('timerProgramText').value; draft.edited = true; onChange('text');
  });
  for (const [name] of durations) paintDuration(name, config[name]);
  sync();
  return {
    readConfig(report = false) {
      syncSeriesRest();
      const result = { rounds: Number(form.elements.rounds.value), series: Number(form.elements.series.value), warning: false };
      let valid = true;
      for (const [name, , min, max] of durations) {
        const input = form.elements[name]; input.setCustomValidity('');
        if (name === 'seriesRest' && input.disabled) { result[name] = lastSeriesRest; continue; }
        try { result[name] = readDuration(input.value, units[name], { min, max }); }
        catch (error) { input.setCustomValidity(error.message); valid = false; }
      }
      if (Number.isInteger(result.seriesRest)) lastSeriesRest = result.seriesRest;
      if (!(report ? form.reportValidity() : form.checkValidity()) || !valid) return null;
      return result;
    },
    setText(text) { if ($('timerProgramText').value !== text) $('timerProgramText').value = text; },
    setError(message) { $('timerProgramError').textContent = message; $('timerProgramError').hidden = !message; $('timerProgramText').setAttribute('aria-invalid', String(Boolean(message))); },
    setLocked(value) { locked = value; sync(); },
    destroy() { /* All listeners belong to the detached tool subtree. */ },
  };
}
