import Sortable from 'sortablejs';
import { BLOCK_TYPES, BLOCK_TYPE_GROUPS, WORKOUT_LIMITS, makeBlock, summarizeBlocks, formatDuration } from './domain.js';
import { parseWorkoutText, serializeSessionText, parseSessionText } from './workout-text.js';
import { el, button, field, input, textarea, select, errorBox, showError, busy } from './ui.js';

const clone = value => structuredClone(value);
const typeLabel = type => BLOCK_TYPES.find(item => item.id === type)?.label || type || 'Étape';
const secondsText = value => value == null ? '' : value % 60 === 0 ? `${value / 60}m` : `${value}s`;
const choose = (name, options, value) => select(name, options.map(([value, label]) => ({ value, label })), value);
function typeSelect(name, value, hybrid = false) {
  const control = el('select', { name }, el('option', { value: '' }, 'Choisir'));
  if (hybrid) control.append(el('option', { value: 'hybrid' }, 'Hybride'));
  for (const group of BLOCK_TYPE_GROUPS) control.append(el('optgroup', { label: group.label }, group.types.map(([id, label]) => el('option', { value: id }, label))));
  if (value && value !== 'hybrid' && !BLOCK_TYPES.some(type => type.id === value)) control.append(el('option', { value }, value));
  control.value = value; return control;
}
function validate(blocks) {
  const errors = summarizeBlocks(blocks).errors;
  if (errors.length) throw new Error(errors.join(' '));
}
function normalized(blocks) {
  validate(blocks); const ids = new Set();
  const visit = list => list.map(source => {
    const block = { ...makeBlock(source.kind === 'repeat' ? 'repeat' : source.type), ...clone(source) };
    if (typeof block.id !== 'string' || !block.id || ids.has(block.id)) block.id = makeBlock().id;
    ids.add(block.id); block.children = block.kind === 'repeat' ? visit(source.children) : [];
    return block;
  });
  return visit(blocks);
}
function copyWithIds(block) {
  const value = clone(block); value.id = makeBlock().id;
  value.children = (block.children || []).map(copyWithIds); return value;
}
function depthOf(block) { return block.kind === 'repeat' && block.children.length ? 1 + Math.max(...block.children.map(depthOf)) : 1; }
function dose(block) {
  if (block.kind === 'repeat') return `${block.repeat_count} × la séquence ci-dessous`;
  const parts = [];
  if (block.rounds && block.work_seconds != null) {
    parts.push(`${block.rounds} × ${formatDuration(block.work_seconds)}`);
    if (block.rest_seconds) parts.push(`repos ${formatDuration(block.rest_seconds)}`);
  } else if (block.duration_seconds != null) parts.push(formatDuration(block.duration_seconds));
  if (block.distance_m != null) parts.push(`${block.distance_m.toLocaleString('fr-CA')} mètres`);
  if (block.repetitions) parts.push(`${block.repetitions} répétitions`);
  if (block.zone) parts.push(`Z${block.zone}`);
  return parts.join(' · ') || 'Consignes libres';
}
function duration(value, label, allowZero = false) {
  if (allowZero && /^(?:0|0s|0m)$/.test(value.trim())) return 0;
  const parsed = parseWorkoutText(value);
  const block = parsed.blocks[0];
  if (parsed.errors.length || parsed.blocks.length !== 1 || block?.kind !== 'step' || block.distance_m != null || !(block.duration_seconds > 0)) throw new Error(`${label} : indique une durée, par exemple 1m30s ou 30s.`);
  return block.duration_seconds;
}
function numeric(value, label, { min = 1, max = 10000, integer = true } = {}) {
  const number = value.trim() ? Number(value.replace(',', '.')) : NaN;
  if (!Number.isFinite(number) || number < min || number > max || integer && !Number.isInteger(number)) throw new Error(`${label} : ${integer ? 'un entier' : 'une valeur'} entre ${min} et ${max} est requis.`);
  return number;
}

/** One structured program, two editing surfaces; invalid drafts never replace it. */
export class ProgramEditor {
  constructor(container, { blocks = [], notes = '', sport = 'other', onChange = () => {}, onSaveBlock = null } = {}) {
    this.container = container; this.blocks = normalized(blocks);
    this.sport = sport; this.onChange = onChange; this.onSaveBlock = onSaveBlock;
    this.notes = notes;
    this.mode = 'text'; this.textDraft = serializeSessionText(this.blocks, this.notes); this.textErrors = []; this.mini = null;
    this.sortables = []; this.helpOpen = false; this.destroyed = false;
    this.group = `program-${makeBlock().id}`;
    this.render();
  }
  getValue() {
    if (this.mini) throw new Error('Valide ou annule le petit formulaire du bloc avant de continuer.');
    if (this.mode === 'text' && this.textErrors.length) throw new Error(`Corrige le programme : ligne ${this.textErrors[0].line}, ${this.textErrors[0].message}`);
    return clone(this.blocks);
  }
  hasDraft() { return !!this.mini || this.textErrors.length > 0; }
  getNotes() { this.getValue(); return this.notes; }
  setValue(blocks, notes = this.notes) {
    const next = normalized(blocks);
    const draft = this.mode === 'text' ? serializeSessionText(next, notes) : '';
    this.notes = notes;
    this.blocks = next; this.mini = null; this.textErrors = [];
    if (this.mode === 'text') this.textDraft = draft;
    this.render(); this.emit();
  }
  setSport(sport) { this.sport = sport; if (!this.mini) this.render(); }
  appendBlock(block) {
    this.getValue(); const next = [...this.blocks, copyWithIds(block)];
    validate(next); this.setValue(next);
  }
  emit() { this.updateSummary(); this.onChange(clone(this.blocks), summarizeBlocks(this.blocks)); }
  destroy() { this.destroyed = true; this.sortables.forEach(s => s.destroy()); this.sortables = []; this.container.replaceChildren(); }
  locate(id, list = this.blocks, depth = 1) {
    for (let index = 0; index < list.length; index++) {
      const block = list[index];
      if (block.id === id) return { block, list, index, depth };
      const child = this.locate(id, block.children || [], depth + 1); if (child) return child;
    }
    return null;
  }
  action(label, action, id, title = label) {
    return button(label, () => this.handle(action, id), 'pe-button', { 'aria-label': title, title, disabled: !!this.mini, dataset: { action, ...(id ? { id } : {}) } });
  }
  switchMode(mode) {
    if (this.mini) { this.showError('Valide ou annule le formulaire du bloc avant de changer de mode.'); return; }
    if (mode === this.mode) return;
    if (mode === 'program' && this.textErrors.length) { this.showError('Corrige les lignes signalées, ou reviens au dernier programme valide.'); return; }
    if (mode === 'text') {
      try { this.textDraft = serializeSessionText(this.blocks, this.notes); }
      catch (error) { this.showError(error.message); return; }
    }
    this.mode = mode; this.render();
    if (mode === 'text') this.container.querySelector('.pe-text-input').focus();
  }
  render() {
    if (this.destroyed) return;
    const priorHelp = this.container.querySelector('.pe-help'); if (priorHelp) this.helpOpen = priorHelp.open;
    this.sortables.forEach(s => s.destroy()); this.sortables = [];
    this.container.classList.add('program-editor');
    const modes = el('div', { class: 'pe-modes', role: 'group', 'aria-label': 'Vue de l’entraînement' });
    for (const [mode, label] of [['text', 'Texte'], ['program', 'Blocs']]) modes.append(button(label, () => this.switchMode(mode), 'pe-button', { 'aria-pressed': String(this.mode === mode), disabled: !!this.mini, dataset: { mode } }));
    const header = el('header', { class: 'pe-heading' }, el('div', {}, el('h3', {}, 'Entraînement')), modes);
    this.errors = errorBox(); this.errors.classList.add('pe-error');
    this.summary = el('p', { class: 'pe-summary', role: 'status' });
    this.container.replaceChildren(header, this.help(), this.errors);
    if (this.mode === 'text') this.container.append(this.textSurface());
    else {
      if (this.notes) this.container.append(button(this.notes, () => this.switchMode('text'), 'pe-narrative', { title: 'Modifier le texte libre' }));
      this.container.append(this.renderList(this.blocks, 1));
      if (this.mini) this.container.append(this.miniPanel());
      else this.container.append(this.addBar());
    }
    this.container.append(this.summary); this.updateSummary();
    if (!this.mini && this.mode === 'program') this.setupSorting();
  }
  help() {
    const example = 'Course\n2x\n  1m @ Z2\n  1m @ Z1 - Marcher si nécessaire\n\nShadow\n3 rounds 1m/1m - Faire du 8/16\n3 rounds 30s/30s - In and out / burpees\n\nSac\n4 rounds 2m/1m - Jab et déplacement\n\nAbdos\n5m - Circuit au choix';
    return el('details', { class: 'pe-help', open: this.helpOpen }, el('summary', {}, 'ⓘ Aide · écrire un entraînement'),
      el('p', {}, 'Écris directement dans Texte, ou utilise les boutons dans la vue Blocs. Les deux modifient les mêmes étapes.'),
      el('dl', {},
        el('dt', {}, 'Course, Shadow, Sac…'), el('dd', {}, 'Un titre de section donne le type et le nom aux étapes qui suivent. Exemple : Course : Jog facile.'),
        el('dt', {}, '10m · 30s · 1m30s'), el('dd', {}, 'Minutes, secondes ou durée combinée. Le m signifie toujours minutes. Les durées sont prioritaires, sans distance obligatoire.'),
        el('dt', {}, '2x + lignes en retrait'), el('dd', {}, 'Répète les étapes placées dessous, avec 2 espaces au début de chaque ligne. Reviens au bord gauche pour terminer la séquence. La récupération écrite fait partie de chaque répétition, même la dernière.'),
        el('dt', {}, '3 rounds 1m/1m'), el('dd', {}, '3 rounds de 1 minute de travail, avec 1 minute de repos entre les rounds, sans repos après le dernier. Écris un repos séparé si tu en veux ensuite. 3rounds est aussi accepté.'),
        el('dt', {}, '@ Z2'), el('dd', {}, 'Zone cible facultative, de Z1 à Z7. Ce n’est pas le RPE après séance.'),
        el('dt', {}, '# texte libre'), el('dd', {}, 'Les lignes précédées de # contiennent les consignes et les notes de la séance.'),
        el('dt', {}, '- consigne'), el('dd', {}, 'Tout ce qui suit le tiret est une consigne libre : « faire du 8/16 » ne crée pas d’intervalles automatiquement.'),
        el('dt', {}, '400 mètres · 1km'), el('dd', {}, 'Distance seulement si tu la choisis explicitement. Aucune conversion automatique en durée.')),
      el('pre', {}, el('code', {}, example)),
      el('details', { class: 'pe-help-advanced' }, el('summary', {}, 'Réglages avancés et conservation des données'), el('p', {}, 'Certains blocs existants peuvent afficher une annotation | {…} à la fin d’une ligne. Elle conserve les notes, intensités, types précis ou autres réglages non exprimés dans la notation courte. Garde cette annotation pour conserver ces informations, ou modifie-les avec le petit formulaire. Ce format est propre à cette plateforme ; tous les codes Intervals.icu ne sont pas pris en charge.')));
  }
  textSurface() {
    const text = textarea('workout_program', this.textDraft, { class: 'pe-text-input', spellcheck: false, rows: 13, 'aria-label': 'Programme en texte', 'aria-describedby': `${this.group}-text-status` });
    this.textStatus = el('div', { class: 'pe-text-status', id: `${this.group}-text-status`, role: 'status' });
    text.addEventListener('input', () => {
      this.textDraft = text.value; const result = parseSessionText(this.textDraft, { sport: this.sport });
      this.textErrors = result.errors; this.errors.hidden = true;
      if (!result.errors.length) { this.blocks = result.blocks; this.notes = result.notes; this.emit(); }
      this.updateTextStatus(text);
    });
    text.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || event.shiftKey) return;
      event.preventDefault(); const start = text.selectionStart, end = text.selectionEnd;
      text.setRangeText('  ', start, end, 'end'); text.dispatchEvent(new text.ownerDocument.defaultView.Event('input', { bubbles: true }));
    });
    const revert = button('Revenir au dernier programme valide', () => {
      this.textErrors = []; this.textDraft = serializeSessionText(this.blocks, this.notes); this.mode = 'program'; this.render();
    }, 'pe-button', { class: 'pe-button pe-revert', hidden: !this.textErrors.length });
    const panel = el('div', { class: 'pe-text-panel' }, text, this.textStatus, revert);
    this.updateTextStatus(text, revert); return panel;
  }
  updateTextStatus(text, revert = this.container.querySelector('.pe-revert')) {
    text.setAttribute('aria-invalid', String(!!this.textErrors.length));
    this.textStatus.replaceChildren();
    if (this.textErrors.length) {
      this.textStatus.append(el('p', {}, 'Aperçu : dernier programme valide. Corrige le texte avant de planifier.'), el('ul', {}, this.textErrors.slice(0, 8).map(error => el('li', {}, `Ligne ${error.line} : ${error.message}`))));
    } else this.textStatus.textContent = this.blocks.length ? 'Programme valide · synchronisé avec les blocs.' : '';
    if (revert) revert.hidden = !this.textErrors.length;
  }
  updateSummary() {
    if (!this.summary) return;
    const result = summarizeBlocks(this.blocks), parts = [];
    if (result.hasTime) parts.push(formatDuration(result.duration_seconds));
    if (result.hasDistance) parts.push(`${result.distance_m.toLocaleString('fr-CA')} mètres renseignés`);
    if (result.hasUnquantified || result.hasDistanceOnly) parts.push('durée partielle');
    this.summary.textContent = parts.join(' · ') || 'Aucune durée imposée.';
  }
  renderList(blocks, depth) {
    const list = el('div', { class: 'pe-list', dataset: { depth } });
    for (const block of blocks) {
      const row = el('article', { class: `pe-row${block.kind === 'repeat' ? ' pe-repeat' : ''}`, dataset: { id: block.id } });
      const handle = this.action('⠿', 'handle', block.id, 'Glisser cette étape'); handle.classList.add('pe-handle'); handle.tabIndex = -1;
      const main = this.action('', 'edit', block.id, `Modifier ${block.title || typeLabel(block.type)}`); main.classList.add('pe-line');
      main.append(el('strong', {}, block.title || (block.kind === 'repeat' ? 'Répétition' : typeLabel(block.type))), el('span', { class: 'pe-dose' }, dose(block)));
      if (block.description) main.append(el('small', { class: 'pe-instructions' }, block.description));
      const actions = el('div', { class: 'pe-row-actions' });
      const more = el('details', { class: 'pe-row-more' }, el('summary', { 'aria-label': `Actions pour ${block.title || typeLabel(block.type)}` }, '•••'));
      more.append(this.action('↑ Monter', 'up', block.id), this.action('↓ Descendre', 'down', block.id));
      more.append(this.action('Dupliquer', 'duplicate', block.id), this.action('Supprimer', 'delete', block.id));
      if (this.onSaveBlock) more.append(this.action('Garder comme bloc', 'save', block.id));
      actions.append(more); row.append(el('div', { class: 'pe-row-head' }, handle, main, actions));
      if (block.kind === 'repeat') {
        row.append(this.renderList(block.children, depth + 1));
        if (depth < WORKOUT_LIMITS.depth) row.append(this.addBar(block.id));
      }
      list.append(row);
    }
    return list;
  }
  addBar(parentId = '') {
    const bar = el('div', { class: 'pe-addbar', dataset: { parent: parentId } });
    for (const [action, label] of [['add-step', '＋ Étape'], ['add-repeat', '＋ Répétition'], ['add-rounds', '＋ Rounds']]) {
      if (action === 'add-repeat' && parentId && this.locate(parentId).depth >= WORKOUT_LIMITS.depth - 1) continue;
      bar.append(this.action(label, action, parentId));
    }
    return bar;
  }
  handle(action, id) {
    if (this.mini || action === 'handle') return;
    this.errors.hidden = true;
    if (action.startsWith('add-')) {
      this.mini = { action, parentId: id || '', block: action === 'add-repeat' ? { ...makeBlock('repeat'), type: this.sport === 'running' ? 'run' : this.sport === 'boxing' ? 'shadow' : this.sport === 'sparring' ? 'sparring' : 'other' } : makeBlock(this.sport === 'running' ? 'run' : this.sport === 'boxing' ? 'shadow' : this.sport === 'sparring' ? 'sparring' : 'other') };
      if (action === 'add-step') this.mini.block.duration_seconds = 300;
      if (action === 'add-rounds') Object.assign(this.mini.block, { rounds: 3, work_seconds: 120, rest_seconds: 60 });
      this.render(); this.container.querySelector('.pe-mini input')?.focus(); return;
    }
    const found = this.locate(id); if (!found) return;
    if (action === 'edit') { this.mini = { action, id, block: clone(found.block) }; this.render(); this.container.querySelector('.pe-mini input')?.focus(); return; }
    if (action === 'save') {
      const trigger = [...this.container.querySelectorAll('[data-action="save"]')].find(node => node.dataset.id === id);
      busy(trigger, () => this.onSaveBlock(clone(found.block))).catch(error => { if (!this.destroyed) this.showError(error.message); }); return;
    }
    const previous = clone(this.blocks);
    if (action === 'up' && found.index > 0) [found.list[found.index - 1], found.list[found.index]] = [found.list[found.index], found.list[found.index - 1]];
    if (action === 'down' && found.index < found.list.length - 1) [found.list[found.index + 1], found.list[found.index]] = [found.list[found.index], found.list[found.index + 1]];
    if (action === 'delete') {
      if (found.depth > 1 && found.list.length === 1) { this.showError('Une répétition doit garder une étape. Supprime la répétition entière si nécessaire.'); return; }
      found.list.splice(found.index, 1);
    }
    if (action === 'duplicate') found.list.splice(found.index + 1, 0, copyWithIds(found.block));
    try { validate(this.blocks); this.render(); this.emit(); }
    catch (error) { this.blocks = previous; this.showError(error.message); }
  }
  showError(message) { if (this.errors) showError(this.errors, new Error(message)); }
  repeatPanel() {
    const draft = this.mini, block = draft.block;
    const panel = el('section', { class: 'pe-mini pe-sequence', 'aria-label': 'Répétition' });
    const count = input('block_count', block.repeat_count, 'number', { min: 1, max: WORKOUT_LIMITS.repeat, step: 1, inputMode: 'numeric', dataset: { field: 'repeat_count' } });
    const children = block.children.length ? block.children : [makeBlock(block.type)];
    const workTypes = new Set(children.filter(child => child.type !== 'recovery').map(child => child.kind === 'repeat' ? 'hybrid' : child.type));
    const initialType = workTypes.size > 1 || workTypes.has('hybrid') ? 'hybrid' : [...workTypes][0] || 'run';
    const commonType = typeSelect('repeat_type', initialType, true);
    panel.append(el('h4', {}, draft.id ? 'Modifier la répétition' : 'Ajouter une répétition'), el('div', { class: 'pe-repeat-settings' }, field('Nombre de répétitions', count), field('Type du bloc', commonType)));
    const lines = el('div', { class: 'pe-sequence-lines' });
    const rows = [];
    const refresh = () => rows.forEach((row, index) => {
      row.number.textContent = `Étape ${index + 1}`;
      row.up.disabled = index === 0; row.down.disabled = index === rows.length - 1; row.remove.disabled = rows.length === 1;
      row.updateType?.(); lines.append(row.element);
    });
    const addRow = source => {
      const row = { source };
      row.number = el('strong');
      const move = offset => { const index = rows.indexOf(row); if (index + offset < 0 || index + offset >= rows.length) return; [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]]; refresh(); };
      row.up = button('↑', () => move(-1), 'pe-button', { 'aria-label': 'Monter cette ligne' });
      row.down = button('↓', () => move(1), 'pe-button', { 'aria-label': 'Descendre cette ligne' });
      row.remove = button('×', () => { if (rows.length < 2) return; rows.splice(rows.indexOf(row), 1); row.element.remove(); refresh(); }, 'pe-button', { 'aria-label': 'Supprimer cette ligne' });
      row.element = el('article', { class: 'pe-sequence-row' }, el('header', { class: 'pe-sequence-head' }, row.number, el('div', { class: 'pe-sequence-actions' }, row.up, row.down, row.remove)));
      if (source.kind === 'repeat') {
        row.element.append(el('p', { class: 'pe-hint' }, `${source.title || 'Répétition'} · ${dose(source)}. Modification des sous-étapes depuis les blocs.`));
        row.read = () => clone(source);
      } else {
        const type = typeSelect(`step_type_${source.id}`, source.type);
        const phase = choose(`step_phase_${source.id}`, [['work', 'Effort'], ['recovery', 'Récupération']], source.type === 'recovery' ? 'recovery' : 'work');
        const typeField = field('Type', type), phaseField = field('Effort', phase);
        row.updateType = () => { typeField.hidden = commonType.value !== 'hybrid'; phaseField.hidden = commonType.value === 'hybrid'; };
        type.addEventListener('change', () => { phase.value = type.value === 'recovery' ? 'recovery' : 'work'; });
        phase.addEventListener('change', () => { type.value = phase.value === 'recovery' ? 'recovery' : commonType.value; });
        const originalFormat = source.rounds && source.work_seconds != null ? 'rounds' : source.distance_m != null ? source.duration_seconds != null ? 'mixed' : 'distance' : source.duration_seconds != null ? 'time' : 'free';
        const isNew = !block.children.includes(source);
        const format = choose(`step_format_${source.id}`, [['time', 'Durée'], ['distance', 'Distance'], ['mixed', 'Durée + distance'], ['rounds', 'Rounds'], ['free', 'Consignes seules']], isNew ? 'time' : originalFormat);
        const time = input(`step_duration_${source.id}`, secondsText(source.duration_seconds), 'text', { dataset: { field: 'duration' } });
        const meters = input(`step_distance_${source.id}`, source.distance_m, 'text', { inputMode: 'decimal', dataset: { field: 'distance' } });
        const zone = choose(`step_zone_${source.id}`, [['', 'Non précisée'], ...Array.from({ length: 7 }, (_, i) => [String(i + 1), `Z${i + 1}`])], source.zone == null ? '' : String(source.zone));
        zone.dataset.field = 'zone'; format.dataset.field = 'format'; type.dataset.field = 'type'; phase.dataset.field = 'phase';
        const timeField = field('Durée', time), metersField = field('Distance en mètres', meters);
        const rounds = input(`step_rounds_${source.id}`, source.rounds ?? 3, 'number', { min: 1, max: 10000, step: 1 });
        const work = input(`step_work_${source.id}`, secondsText(source.work_seconds ?? 120));
        const rest = input(`step_rest_${source.id}`, secondsText(source.rest_seconds ?? 0));
        const roundFields = el('div', { class: 'pe-mini-fields' }, field('Rounds', rounds), field('Travail', work), field('Repos entre les rounds', rest));
        const drawFormat = () => { timeField.hidden = !['time', 'mixed'].includes(format.value); metersField.hidden = !['distance', 'mixed'].includes(format.value); roundFields.hidden = format.value !== 'rounds'; };
        format.addEventListener('change', drawFormat); drawFormat();
        const title = input(`step_title_${source.id}`, source.title, 'text', { maxLength: 500 });
        const description = textarea(`step_description_${source.id}`, source.description, { rows: 2, maxLength: 10000 });
        const notes = textarea(`step_notes_${source.id}`, source.notes, { rows: 2, maxLength: 10000 });
        row.element.append(el('div', { class: 'pe-sequence-fields' }, typeField, phaseField, field('Mesure', format), timeField, metersField, field('Zone d’effort', zone)), roundFields,
          el('details', { class: 'pe-line-options' }, el('summary', {}, 'Nom et consignes'), field('Nom', title), field('Consigne', description), field('Notes', notes)));
        row.read = () => {
          const next = { ...clone(source), type: commonType.value === 'hybrid' ? type.value : phase.value === 'recovery' ? 'recovery' : commonType.value, zone: zone.value ? Number(zone.value) : null, title: title.value.trim(), description: description.value.trim(), notes: notes.value };
          if (!next.type) throw new Error('Choisis le type de chaque ligne du bloc hybride.');
          if (isNew && !next.title || next.type !== source.type && next.title === typeLabel(source.type)) next.title = typeLabel(next.type);
          if (format.value !== originalFormat) Object.assign(next, { duration_seconds: null, distance_m: null, rounds: null, work_seconds: null, rest_seconds: null });
          if (['time', 'mixed'].includes(format.value)) next.duration_seconds = duration(time.value, 'Durée', source.duration_seconds === 0);
          if (['distance', 'mixed'].includes(format.value)) next.distance_m = numeric(meters.value, 'Distance', { min: source.distance_m === 0 ? 0 : .001, max: 1e6, integer: false });
          if (format.value === 'rounds') Object.assign(next, { rounds: numeric(rounds.value, 'Rounds'), work_seconds: duration(work.value, 'Travail', source.work_seconds === 0), rest_seconds: rest.value === secondsText(source.rest_seconds ?? 0) && source.rest_seconds == null ? source.rest_seconds : duration(rest.value, 'Repos', true) });
          return next;
        };
      }
      rows.push(row); refresh();
      return row;
    };
    children.forEach(addRow);
    commonType.addEventListener('change', refresh);
    const error = errorBox();
    const add = button('＋ Ajouter une ligne', () => {
      if (rows.length >= WORKOUT_LIMITS.siblings) { showError(error, new Error(`Maximum ${WORKOUT_LIMITS.siblings} lignes dans une répétition.`)); return; }
      const row = addRow(makeBlock(commonType.value === 'hybrid' ? '' : commonType.value));
      row.element.querySelector('input')?.focus();
    }, 'pe-button', { dataset: { action: 'add-repeat-line' } });
    const title = input('block_title', block.title, 'text', { maxLength: 500, dataset: { field: 'title' } });
    const description = textarea('block_description', block.description, { rows: 2, maxLength: 10000 });
    const notes = textarea('block_notes', block.notes, { rows: 2, maxLength: 10000 });
    panel.append(lines, add, el('p', { class: 'pe-hint' }, 'Toutes les lignes sont parcourues dans l’ordre, puis le bloc recommence. Une récupération ajoutée fait partie de chaque répétition.'),
      el('details', { class: 'pe-mini-advanced' }, el('summary', {}, 'Nom et consignes du bloc'), field('Nom', title), field('Consigne', description), field('Notes', notes)));
    const apply = () => {
      try {
        if (!commonType.value) throw new Error('Choisis le type du bloc.');
        const next = { ...clone(block), title: title.value.trim() || (draft.id ? '' : 'Répétition'), description: description.value.trim(), notes: notes.value, repeat_count: numeric(count.value, 'Répétitions', { max: WORKOUT_LIMITS.repeat }), children: rows.map((row, index) => { try { return row.read(); } catch (failure) { throw new Error(`Étape ${index + 1} : ${failure.message}`); } }) };
        // The group carries no inherited dose or zone; each child is explicit.
        if (!draft.id) Object.assign(next, { type: 'other', zone: null, intensity: null });
        this.commitMini(next); this.mini = null; this.render(); this.emit();
      } catch (failure) { showError(error, failure); }
    };
    panel.append(error, el('div', { class: 'pe-mini-actions' }, button('Annuler', () => { this.mini = null; this.render(); }, 'pe-button'), button(draft.id ? 'Appliquer' : 'Ajouter', apply, 'pe-button pe-primary', { dataset: { action: 'apply-mini' } })));
    panel.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault(); });
    return panel;
  }
  commitMini(nextBlock) {
    const draft = this.mini, previous = this.blocks; this.blocks = clone(previous);
    try {
      if (draft.id) { const target = this.locate(draft.id); target.list[target.index] = nextBlock; }
      else { const list = draft.parentId ? this.locate(draft.parentId).block.children : this.blocks; list.push(nextBlock); }
      validate(this.blocks);
    } catch (failure) { this.blocks = previous; throw failure; }
  }
  miniPanel() {
    if (this.mini.block.kind === 'repeat') return this.repeatPanel();
    const draft = this.mini, block = draft.block;
    const panel = el('section', { class: 'pe-mini', 'aria-label': draft.id ? 'Modifier une étape' : 'Ajouter une étape' });
    const title = input('block_title', block.title, 'text', { maxLength: 500, dataset: { field: 'title' } });
    panel.append(el('h4', {}, draft.id ? 'Modifier cette ligne' : 'Ajouter une étape'), field('Nom', title));
    const originalFormat = block.rounds && block.work_seconds != null ? 'rounds' : block.distance_m != null ? block.duration_seconds != null ? 'mixed' : 'distance' : block.duration_seconds != null ? 'time' : 'free';
    const format = choose('block_format', [['time', 'Durée'], ['rounds', 'Rounds'], ['distance', 'Distance'], ['mixed', 'Durée + distance'], ['free', 'Consignes seules']], originalFormat);
    const minutes = input('block_duration', secondsText(block.duration_seconds), 'text', { dataset: { field: 'duration' } });
    const rounds = input('block_rounds', block.rounds ?? 3, 'text', { inputMode: 'numeric', dataset: { field: 'rounds' } });
    const work = input('block_work', secondsText(block.work_seconds ?? 120), 'text', { dataset: { field: 'work' } });
    const restDefault = block.rest_seconds ?? (draft.id ? 0 : 60);
    const rest = input('block_rest', secondsText(restDefault), 'text', { dataset: { field: 'rest' } });
    const meters = input('block_distance', block.distance_m ?? '', 'text', { inputMode: 'decimal', dataset: { field: 'distance' } });
    const timed = field('Durée', minutes), distance = field('Distance en mètres', meters), roundFields = el('div', { class: 'pe-mini-fields' }, field('Rounds', rounds), field('Travail', work), field('Repos', rest, 'Entre les rounds uniquement.'));
    const drawFormat = () => { timed.hidden = !['time', 'mixed'].includes(format.value); distance.hidden = !['distance', 'mixed'].includes(format.value); roundFields.hidden = format.value !== 'rounds'; };
    format.addEventListener('change', drawFormat); drawFormat();
    panel.append(el('div', { class: 'pe-mini-fields' }, field('Format', format), timed, distance), roundFields);
    const description = textarea('block_description', block.description, { rows: 2, maxLength: 10000, dataset: { field: 'description' } });
    panel.append(field('Consigne', description));
    const type = typeSelect('block_type', block.type);
    const zone = choose('block_zone', [['', 'Non précisée'], ...Array.from({ length: 7 }, (_, i) => [String(i + 1), `Z${i + 1}`])], block.zone == null ? '' : String(block.zone));
    const notes = textarea('block_notes', block.notes || '', { maxLength: 10000 });
    const measurementFields = panel.querySelector('.pe-mini-fields');
    measurementFields.prepend(field('Type', type)); measurementFields.append(field('Zone d’effort', zone));
    const advanced = el('details', { class: 'pe-mini-advanced' }, el('summary', {}, 'Plus d’options'), field('Notes', notes));
    panel.append(advanced);
    const error = errorBox();
    const apply = () => {
      try {
        const nextBlock = { ...clone(block), title: title.value.trim(), description: description.value.trim(), type: type.value, zone: zone.value ? Number(zone.value) : null, notes: notes.value };
        if (!nextBlock.type) throw new Error('Choisis le type de l’étape.');
        if (!draft.id && !nextBlock.title) nextBlock.title = typeLabel(nextBlock.type);
        if (format.value !== originalFormat) Object.assign(nextBlock, { duration_seconds: null, distance_m: null, rounds: null, work_seconds: null, rest_seconds: null });
        if (['time', 'mixed'].includes(format.value)) nextBlock.duration_seconds = duration(minutes.value, 'Durée', block.duration_seconds === 0);
        if (['distance', 'mixed'].includes(format.value)) nextBlock.distance_m = numeric(meters.value, 'Distance', { min: block.distance_m === 0 ? 0 : 0.001, max: 1e6, integer: false });
        if (format.value === 'rounds') {
          Object.assign(nextBlock, { rounds: numeric(rounds.value, 'Rounds'), work_seconds: duration(work.value, 'Travail', block.work_seconds === 0), rest_seconds: rest.value === secondsText(restDefault) && block.rest_seconds == null && draft.id ? block.rest_seconds : duration(rest.value, 'Repos', true) });
          // Keep explicit additional measures on legacy rounds when their format is unchanged.
          if (block.rounds && block.work_seconds != null) { nextBlock.distance_m = block.distance_m; nextBlock.duration_seconds = block.duration_seconds; }
        }
        if (format.value === 'free') { nextBlock.rounds = block.rounds && block.work_seconds == null ? block.rounds : null; }
        this.commitMini(nextBlock);
        this.mini = null; this.render(); this.emit();
      } catch (failure) { showError(error, failure); }
    };
    panel.append(error, el('div', { class: 'pe-mini-actions' }, button('Annuler', () => { this.mini = null; this.render(); }, 'pe-button'), button(draft.id ? 'Appliquer' : 'Ajouter', apply, 'pe-button pe-primary', { dataset: { action: 'apply-mini' } })));
    panel.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); apply(); } });
    return panel;
  }
  setupSorting() {
    this.container.querySelectorAll('.pe-list').forEach(list => this.sortables.push(Sortable.create(list, {
      group: this.group, handle: '.pe-handle', draggable: '.pe-row', animation: 150, delay: 170, delayOnTouchOnly: true, touchStartThreshold: 5, fallbackOnBody: true, ghostClass: 'pe-ghost',
      onMove: event => {
        const block = this.locate(event.dragged.dataset.id)?.block;
        return !!block && !event.dragged.contains(event.to) && Number(event.to.dataset.depth) + depthOf(block) - 1 <= WORKOUT_LIMITS.depth;
      },
      onEnd: () => {
        const previous = clone(this.blocks), byId = new Map();
        const collect = blocks => blocks.forEach(block => { byId.set(block.id, block); collect(block.children || []); }); collect(this.blocks);
        const read = node => [...node.children].filter(child => child.matches('.pe-row')).map(row => {
          const block = byId.get(row.dataset.id); if (block.kind === 'repeat') block.children = read(row.querySelector(':scope > .pe-list')); return block;
        });
        try { this.blocks = read(this.container.querySelector(':scope > .pe-list')); validate(this.blocks); this.render(); this.emit(); }
        catch (error) { this.blocks = previous; this.render(); this.showError(error.message); }
      },
    })));
  }
}
