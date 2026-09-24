import Sortable from 'sortablejs';
import { BLOCK_TYPES, blockName, ZONE_COLORS, WORKOUT_LIMITS, makeBlock, summarizeBlocks, formatDuration } from './domain.js';

const copy = value => structuredClone(value);
const typeLabel = type => BLOCK_TYPES.find(item => item.id === type)?.label || type || 'Bloc';
const distanceLabel = value => value >= 1000 ? `${Number((value / 1000).toFixed(2)).toLocaleString('fr')} km` : `${value.toLocaleString('fr')} m`;
const intensities = [['', 'Non précisée'], ['easy', 'Facile'], ['moderate', 'Modérée'], ['hard', 'Difficile'], ['max', 'Maximale']];
let instance = 0;
function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(text, action, title = text, className = '') {
  const node = element('button', `be-button ${className}`, text);
  node.type = 'button'; node.dataset.action = action; node.title = title;
  node.setAttribute('aria-label', title); return node;
}
function field(label, name, value, { type = 'text', options, min, max, step, unit } = {}) {
  const wrapper = element('label', 'be-field'); wrapper.append(element('span', '', label));
  let input;
  if (options) {
    input = element('select');
    for (const [id, text] of options) { const option = element('option', '', text); option.value = id; input.append(option); }
  } else if (type === 'textarea') { input = element('textarea'); input.rows = 2; }
  else { input = element('input'); input.type = type; }
  input.dataset.field = name; input.value = value ?? '';
  if (type === 'number') { input.inputMode = 'decimal'; input.min = min ?? 0; input.step = step ?? 'any'; if (max != null) input.max = max; }
  if (unit) input.dataset.unit = unit;
  if (name === 'title') input.maxLength = 500;
  if (name === 'description' || name === 'notes') input.maxLength = 10000;
  wrapper.append(input); return wrapper;
}
function normalizedCopy(blocks) {
  const seen = new WeakSet(), ids = new Set(); let count = 0;
  function visit(list, depth) {
    if (!Array.isArray(list) || depth > WORKOUT_LIMITS.depth || list.length > WORKOUT_LIMITS.siblings) throw new RangeError('Structure de blocs invalide, trop profonde ou trop volumineuse.');
    return list.map(block => {
      if (!block || typeof block !== 'object' || seen.has(block) || ++count > WORKOUT_LIMITS.blocks) throw new RangeError('La structure de blocs est invalide ou trop volumineuse.');
      seen.add(block);
      const result = { ...makeBlock(block.kind === 'repeat' ? 'repeat' : block.type), ...copy({ ...block, children: [] }) };
      if (typeof result.id !== 'string' || ids.has(result.id)) result.id = makeBlock().id;
      ids.add(result.id);
      result.children = block.kind === 'repeat' ? visit(block.children || [], depth + 1) : [];
      return result;
    });
  }
  return visit(blocks || [], 1);
}
function duplicateBlock(block) {
  const result = copy(block); result.id = makeBlock().id;
  result.children = (block.children || []).map(duplicateBlock); return result;
}
function depthOf(block) { return block.kind === 'repeat' && block.children.length ? 1 + Math.max(...block.children.map(depthOf)) : 1; }
function modeOf(block) {
  if (block.rounds != null || block.work_seconds != null) return 'rounds';
  if (block.duration_seconds != null && block.distance_m != null) return 'mixed';
  if (block.duration_seconds != null) return 'time';
  if (block.distance_m != null) return 'distance';
  return 'free';
}

export class BlockEditor {
  constructor(container, { blocks = [], sport = 'other', onChange = () => {}, onSaveBlock = null } = {}) {
    this.container = container; this.onChange = onChange; this.onSaveBlock = onSaveBlock;
    this.sport = sport; this.disclosures = new Map();
    this.intervalDraft = { repeat_count: '6', effort: '2', effort_unit: 'min', recovery: '1', recovery_unit: 'min', zone: '4' };
    this.blocks = normalizedCopy(blocks); this.sortables = []; this.group = `workout-blocks-${++instance}`;
    this.click = event => this.handleClick(event);
    this.input = event => this.handleInput(event);
    this.change = event => { if (event.target.matches('select')) this.handleInput(event); };
    this.keydown = event => {
      if (event.key === 'Enter' && event.target.matches('input[data-interval]')) { event.preventDefault(); this.addIntervals(); }
    };
    container.addEventListener('click', this.click); container.addEventListener('input', this.input); container.addEventListener('change', this.change); container.addEventListener('keydown', this.keydown);
    this.render();
  }
  getValue() { return copy(this.blocks); }
  setValue(blocks) { this.blocks = normalizedCopy(blocks); this.render(); this.emit(); }
  setSport(sport) {
    if (sport === this.sport) return;
    this.sport = sport; this.render();
  }
  newStep() {
    const block = makeBlock(this.sport === 'running' ? 'run' : 'other');
    if (this.sport === 'running') block.duration_seconds = 300;
    return block;
  }
  appendBlock(block) {
    const next = normalizedCopy([...this.blocks, duplicateBlock(block)]);
    this.blocks = next; this.render(); this.emit();
  }
  destroy() {
    this.sortables.forEach(sortable => sortable.destroy()); this.sortables = [];
    this.container.removeEventListener('click', this.click); this.container.removeEventListener('input', this.input); this.container.removeEventListener('change', this.change); this.container.removeEventListener('keydown', this.keydown);
    this.container.replaceChildren();
  }
  locate(id, list = this.blocks) {
    for (let index = 0; index < list.length; index++) {
      if (list[index].id === id) return { block: list[index], list, index };
      const found = this.locate(id, list[index].children || []); if (found) return found;
    }
    return null;
  }
  emit() {
    const summary = summarizeBlocks(this.blocks); this.drawSummary(summary);
    this.onChange(this.getValue(), summary);
  }
  drawSummary(summary = summarizeBlocks(this.blocks)) {
    const node = this.container.querySelector('.be-summary'); if (!node) return;
    const parts = [];
    if (summary.hasTime) parts.push(formatDuration(summary.duration_seconds));
    if (summary.hasDistance) parts.push(distanceLabel(summary.distance_m));
    if (summary.hasUnquantified || summary.hasDistanceOnly) parts.push('Durée partielle');
    node.textContent = summary.errors.length ? summary.errors[0] : parts.join(' · ') || 'Ajoute des instructions, puis une durée ou une distance si utile.';
    node.classList.toggle('be-error', summary.errors.length > 0);
  }
  render() {
    this.container.querySelectorAll('.be-advanced').forEach(details => {
      this.disclosures.set(details.closest('.be-card').dataset.id, details.open);
    });
    this.sortables.forEach(sortable => sortable.destroy()); this.sortables = [];
    this.container.classList.add('block-editor');
    const head = element('div', 'be-heading');
    const intro = element('div'); intro.append(element('h3', '', 'Déroulé de la séance'), element('p', 'be-muted', 'Glisse les étapes pour les réordonner. Déplie leurs options au besoin.'));
    head.append(intro);
    const summary = element('p', 'be-summary'); summary.setAttribute('aria-live', 'polite');
    const children = [head];
    if (this.sport === 'running') children.push(this.intervalBuilder());
    this.container.replaceChildren(...children, this.renderList(this.blocks, 1), this.addBar(1), summary);
    this.drawSummary(); this.setupSorting();
  }
  intervalBuilder() {
    const panel = element('section', 'be-interval-builder');
    panel.setAttribute('aria-label', 'Créer des intervalles de course');
    panel.append(element('h4', '', 'Intervalles express'));
    const controls = element('div', 'be-interval-fields');
    const units = [['min', 'min'], ['s', 's'], ['m', 'm']];
    const addField = (label, key, className, options = {}) => {
      const wrapper = field(label, key, this.intervalDraft[key], options);
      wrapper.classList.add(className);
      const input = wrapper.querySelector('input, select');
      delete input.dataset.field; input.dataset.interval = key;
      // This is a draft generator, not part of the session form's validation.
      if (input.tagName === 'INPUT') input.inputMode = key === 'repeat_count' ? 'numeric' : 'decimal';
      controls.append(wrapper);
    };
    addField('Répétitions', 'repeat_count', 'be-interval-count');
    addField('Effort', 'effort', 'be-interval-value');
    addField('Unité effort', 'effort_unit', 'be-interval-unit', { options: units });
    addField('Récupération', 'recovery', 'be-interval-value');
    addField('Unité récupération', 'recovery_unit', 'be-interval-unit', { options: units });
    addField('Zone d’effort', 'zone', 'be-interval-zone', { options: [['', 'Libre'], ...Array.from({ length: 7 }, (_, index) => [String(index + 1), `Z${index + 1}`])] });
    controls.append(button('＋ Ajouter', 'add-intervals', 'Ajouter cette séquence d’intervalles'));
    const error = element('p', 'be-error be-interval-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    panel.append(controls, element('p', 'be-muted', 'Une séquence réutilisée à chaque répétition. Récupération à 0 pour la retirer.'), error);
    return panel;
  }
  addIntervals() {
    const draft = this.intervalDraft;
    const number = value => String(value).trim() === '' ? NaN : Number(String(value).replace(',', '.'));
    const count = number(draft.repeat_count), effort = number(draft.effort), recovery = number(draft.recovery);
    const zone = draft.zone === '' ? null : number(draft.zone);
    try {
      if (!Number.isInteger(count) || count < 1 || count > WORKOUT_LIMITS.repeat) throw new RangeError(`Choisis entre 1 et ${WORKOUT_LIMITS.repeat} répétitions entières.`);
      if (!Number.isFinite(effort) || effort <= 0 || !Number.isFinite(recovery) || recovery < 0) throw new RangeError('Indique un effort supérieur à 0 et une récupération égale ou supérieure à 0.');
      if (zone != null && (!Number.isInteger(zone) || zone < 1 || zone > 7)) throw new RangeError('Choisis une zone d’effort entre 1 et 7.');
      const step = (value, unit, type, title, targetZone) => {
        if (!['min', 's', 'm'].includes(unit)) throw new RangeError('Choisis des minutes, secondes ou mètres.');
        const amount = unit === 'min' ? value * 60 : value;
        if (!Number.isFinite(amount) || amount > 1e6) throw new RangeError('La durée ou la distance d’un intervalle ne peut pas dépasser 1 000 000 secondes ou mètres.');
        return { ...makeBlock(type), title, zone: targetZone, [unit === 'm' ? 'distance_m' : 'duration_seconds']: amount };
      };
      const block = { ...makeBlock('repeat'), title: 'Intervalles', repeat_count: count, children: [step(effort, draft.effort_unit, 'run', 'Effort', zone)] };
      if (recovery > 0) block.children.push(step(recovery, draft.recovery_unit, 'recovery', 'Récupération', 1));
      const next = normalizedCopy([...this.blocks, block]);
      const summary = summarizeBlocks(next);
      if (summary.errors.length) throw new RangeError(summary.errors[0]);
      this.blocks = next; this.render(); this.emit();
      [...this.container.querySelectorAll('.be-card')].find(card => card.dataset.id === block.id)?.querySelector('[data-field="title"]')?.focus();
    } catch (error) {
      const node = this.container.querySelector('.be-interval-error');
      if (node) { node.textContent = error.message; node.hidden = false; }
      else this.drawError(error.message);
    }
  }
  addBar(depth, parentId = '') {
    const bar = element('div', 'be-addbar'); bar.dataset.parent = parentId;
    const add = button('＋ Bloc', 'add-step', 'Ajouter un bloc');
    bar.append(add);
    if (depth < WORKOUT_LIMITS.depth) bar.append(button('↻ Répétition', 'add-repeat', 'Ajouter une répétition avec sous-blocs'));
    return bar;
  }
  renderList(blocks, depth) {
    const list = element('div', 'be-list'); list.dataset.depth = depth;
    for (const block of blocks) list.append(this.renderBlock(block, depth));
    return list;
  }
  renderBlock(block, depth) {
    const card = element('article', `be-card${block.kind === 'repeat' ? ' be-repeat' : ''}`);
    card.dataset.id = block.id;
    const header = element('div', 'be-card-head');
    const handle = button('⠿', 'handle', 'Glisser pour déplacer ce bloc', 'be-handle'); handle.tabIndex = -1;
    const title = field('Titre du bloc', 'title', block.title); title.classList.add('be-title');
    header.append(handle, title);
    if (block.kind === 'repeat') {
      const repeat = field('Répétitions', 'repeat_count', block.repeat_count, { type: 'number', min: 1, max: WORKOUT_LIMITS.repeat, step: 1 }); repeat.classList.add('be-repeat-count'); header.append(repeat);
    }
    const tools = element('div', 'be-tools');
    tools.append(button('↑', 'up', 'Monter ce bloc'), button('↓', 'down', 'Descendre ce bloc'));
    header.append(tools); card.append(header);
    const body = element('div', 'be-body');
    const details = element('details', 'be-advanced'); details.open = this.disclosures.get(block.id) || false;
    details.append(element('summary', '', block.description ? `Consignes · ${block.description.replace(/\s+/g, ' ').slice(0, 64)}${block.description.length > 64 ? '…' : ''}` : 'Consignes et options'));
    details.append(field(block.kind === 'repeat' ? 'Instructions de la séquence' : 'Instructions', 'description', block.description, { type: 'textarea' }));
    if (block.kind === 'repeat') {
      body.append(details);
      const nested = element('div', 'be-children'); nested.append(this.renderList(block.children, depth + 1));
      if (depth < WORKOUT_LIMITS.depth) nested.append(this.addBar(depth + 1, block.id));
      body.append(nested);
    } else {
      const controls = element('div', 'be-controls be-essentials');
      const types = BLOCK_TYPES.map(item => [item.id, item.label]);
      if (!types.some(([id]) => id === block.type)) types.push([block.type, block.type]);
      controls.append(field('Type', 'type', block.type, { options: types }), field('Format', 'mode', modeOf(block), { options: [['free', 'Libre'], ['time', 'Durée'], ['distance', 'Distance'], ['mixed', 'Durée + distance'], ['rounds', 'Rounds / séries']] }));
      body.append(controls);
      const dose = element('div', 'be-dose'); const mode = modeOf(block);
      if (mode === 'time' || mode === 'mixed') dose.append(field('Durée (minutes)', 'duration_seconds', block.duration_seconds == null ? '' : Number((block.duration_seconds / 60).toFixed(4)), { type: 'number', unit: 'minutes', step: 'any' }));
      if (mode === 'distance' || mode === 'mixed') dose.append(field('Distance (mètres)', 'distance_m', block.distance_m, { type: 'number' }));
      if (mode === 'rounds') {
        dose.append(field('Rounds / séries', 'rounds', block.rounds, { type: 'number', min: 1, max: 10000, step: 1 }), field('Travail (secondes)', 'work_seconds', block.work_seconds, { type: 'number' }), field('Repos entre rounds (s)', 'rest_seconds', block.rest_seconds, { type: 'number' }));
      }
      if (dose.childElementCount) controls.append(dose);
      controls.append(field('Zone cible', 'zone', block.zone, { options: [['', 'Libre'], ...Array.from({ length: 7 }, (_, index) => [String(index + 1), `Z${index + 1}`])] }));
      const advanced = element('div', 'be-controls');
      advanced.append(field('Répétitions de mouvement', 'repetitions', block.repetitions, { type: 'number', min: 1, max: 10000, step: 1 }));
      details.append(advanced, field('Notes', 'notes', block.notes, { type: 'textarea' })); body.append(details);
    }
    const footer = element('div', 'be-card-footer');
    footer.append(button('Dupliquer', 'duplicate', 'Dupliquer ce bloc'));
    if (this.onSaveBlock) footer.append(button('Enregistrer comme modèle', 'save', 'Enregistrer ce bloc dans la bibliothèque'));
    footer.append(button('Supprimer', 'delete', 'Supprimer ce bloc', 'be-delete'));
    details.append(footer); card.append(body); return card;
  }
  handleInput(event) {
    const interval = event.target.closest('[data-interval]');
    if (interval && this.container.contains(interval)) {
      this.intervalDraft[interval.dataset.interval] = interval.value;
      const error = this.container.querySelector('.be-interval-error'); if (error) error.hidden = true;
      return;
    }
    const input = event.target.closest('[data-field]'); if (!input || !this.container.contains(input)) return;
    if (event.type === 'input' && input.tagName === 'SELECT') return;
    const found = this.locate(input.closest('.be-card')?.dataset.id); if (!found) return;
    const block = found.block, key = input.dataset.field;
    if (key === 'mode') {
      const previous = { ...block };
      Object.assign(block, { duration_seconds: null, distance_m: null, rounds: null, work_seconds: null, rest_seconds: null });
      if (input.value === 'time' || input.value === 'mixed') block.duration_seconds = previous.duration_seconds ?? 0;
      if (input.value === 'distance' || input.value === 'mixed') block.distance_m = previous.distance_m ?? 0;
      if (input.value === 'rounds') Object.assign(block, { rounds: previous.rounds ?? 3, work_seconds: previous.work_seconds ?? 120, rest_seconds: previous.rest_seconds ?? 60 });
      this.render(); this.emit(); return;
    }
    if (input.type === 'number' || key === 'zone') {
      const value = input.value === '' ? null : Number(input.value);
      block[key] = value == null ? null : input.dataset.unit === 'minutes' ? Math.round(value * 60000) / 1000 : value;
    } else block[key] = key === 'intensity' ? input.value || null : input.value;
    this.emit();
  }
  handleClick(event) {
    const target = event.target.closest('[data-action]'); if (!target || !this.container.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'handle') return;
    if (action === 'add-intervals') { this.addIntervals(); return; }
    if (action === 'add-step' || action === 'add-repeat') {
      const parentId = target.closest('.be-addbar').dataset.parent;
      const list = parentId ? this.locate(parentId)?.block.children : this.blocks;
      if (!list) return;
      const block = action === 'add-repeat' ? makeBlock('repeat') : this.newStep();
      if (block.kind === 'repeat') block.children.push(this.newStep());
      list.push(block);
      try { normalizedCopy(this.blocks); } catch (error) { list.pop(); this.drawError(error.message); return; }
      this.render(); this.emit();
      const newCard = [...this.container.querySelectorAll('.be-card')].find(card => card.dataset.id === block.id);
      newCard?.querySelector('[data-field="title"]')?.focus(); return;
    }
    const found = this.locate(target.closest('.be-card')?.dataset.id); if (!found) return;
    const { block, list, index } = found;
    if (action === 'up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
    if (action === 'down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
    if (action === 'delete') list.splice(index, 1);
    if (action === 'duplicate') {
      list.splice(index + 1, 0, duplicateBlock(block));
      try { normalizedCopy(this.blocks); } catch (error) { list.splice(index + 1, 1); this.drawError(error.message); return; }
    }
    if (action === 'save') {
      Promise.resolve().then(() => this.onSaveBlock(copy(block))).catch(error => this.drawError(error.message || 'Impossible d’enregistrer ce bloc.')); return;
    }
    this.render(); this.emit();
    if (action === 'up' || action === 'down') {
      const card = [...this.container.querySelectorAll('.be-card')].find(node => node.dataset.id === block.id);
      card?.querySelector(`[data-action="${action}"]`)?.focus();
    }
  }
  drawError(message) {
    const summary = this.container.querySelector('.be-summary'); summary.textContent = message; summary.classList.add('be-error');
  }
  setupSorting() {
    this.container.querySelectorAll('.be-list').forEach(list => {
      this.sortables.push(Sortable.create(list, {
        group: this.group, handle: '.be-handle', draggable: '.be-card', animation: 160,
        fallbackOnBody: true, swapThreshold: 0.65, delayOnTouchOnly: true, delay: 140,
        touchStartThreshold: 5, ghostClass: 'be-ghost', chosenClass: 'be-chosen',
        onMove: event => {
          const block = this.locate(event.dragged.dataset.id)?.block;
          const siblings = [...event.to.children].filter(child => child.matches('.be-card')).length;
          return !!block && (event.to === event.from || siblings < WORKOUT_LIMITS.siblings) && !event.dragged.contains(event.to) && Number(event.to.dataset.depth) + depthOf(block) - 1 <= WORKOUT_LIMITS.depth;
        },
        onEnd: () => {
          const byId = new Map(); const collect = blocks => blocks.forEach(block => { byId.set(block.id, block); collect(block.children || []); }); collect(this.blocks);
          const read = node => [...node.children].filter(child => child.matches('.be-card')).map(card => {
            const block = byId.get(card.dataset.id);
            if (block.kind === 'repeat') block.children = read(card.querySelector(':scope > .be-body > .be-children > .be-list'));
            return block;
          });
          this.blocks = read(this.container.querySelector(':scope > .be-list')); this.render(); this.emit();
        },
      }));
    });
  }
}

function dosage(block) {
  const result = [];
  if (block.rounds && block.work_seconds) {
    result.push(`${block.rounds} × ${formatDuration(block.work_seconds)}`);
    if (block.rest_seconds) result.push(`${formatDuration(block.rest_seconds)} de repos entre les rounds`);
  } else if (block.duration_seconds) result.push(formatDuration(block.duration_seconds));
  if (block.distance_m) result.push(distanceLabel(block.distance_m));
  if (block.repetitions) result.push(`${block.repetitions} répétitions`);
  return result.join(' · ');
}
function readonlyBlock(block) {
  const card = element('article', `workout-step${block.kind === 'repeat' ? ' workout-repeat' : ''}`);
  const head = element('div', 'workout-step-head'); head.append(element('h4', '', blockName(block)));
  if (block.kind === 'repeat') head.append(element('span', 'workout-badge', `× ${block.repeat_count}`));
  else if (block.zone) { const zone = element('span', 'workout-badge workout-zone', `Z${block.zone}`); zone.style.setProperty('--zone-color', ZONE_COLORS[block.zone] || ZONE_COLORS[1]); head.append(zone); }
  card.append(head);
  if (block.kind !== 'repeat') {
    const details = dosage(block); if (details) card.append(element('p', 'workout-dose', details));
  }
  if (block.description) card.append(element('p', 'workout-instructions', block.description));
  if (block.notes) card.append(element('p', 'workout-notes', block.notes));
  if (block.kind === 'repeat') { const nested = element('div', 'workout-nested'); block.children.forEach(child => nested.append(readonlyBlock(child))); card.append(nested); }
  return card;
}
function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text != null) node.textContent = text; return node;
}
export function renderChart(summary, axis = summary.hasTime ? 'time' : 'distance') {
  const figure = element('figure', 'workout-chart');
  const head = element('div', 'chart-heading');
  head.append(element('figcaption', '', 'Le rythme de ta séance'));
  figure.append(head);
  if (!summary.hasTime && !summary.hasDistance) {
    figure.append(element('p', 'be-muted', 'Ajoute une durée ou une distance à tes blocs pour dessiner ta séance.')); return figure;
  }
  const time = axis === 'time', key = time ? 'duration_seconds' : 'distance_m', total = summary[key];
  const format = time ? formatDuration : distanceLabel;
  if (summary.hasTime && summary.hasDistance) {
    const controls = element('div', 'chart-axis'); controls.setAttribute('role', 'group');controls.setAttribute('aria-label', 'Axe du graphique');
    for (const [value, label] of [['time', 'Durée'], ['distance', 'Distance']]) {
      const control = button(label, 'axis');control.setAttribute('aria-pressed', String(axis === value));
      control.addEventListener('click', () => { const replacement = renderChart(summary, value);figure.replaceWith(replacement);replacement.querySelector(`[aria-pressed="true"]`)?.focus(); });
      controls.append(control);
    }
    head.append(controls);
  }
  const id = `workout-chart-${++instance}`;
  const svg = svgNode('svg', { viewBox: '0 0 720 205', role: 'group', 'aria-labelledby': `${id}-title ${id}-desc`, preserveAspectRatio: 'xMidYMid meet' });
  svg.append(svgNode('title', { id: `${id}-title` }, 'Profil des intervalles'), svgNode('desc', { id: `${id}-desc` }, `Total représenté : ${format(total)}. La largeur représente ${time ? 'la durée' : 'la distance'} ; la hauteur et la couleur indiquent la zone d’effort. Utilise les flèches gauche et droite pour parcourir les intervalles.`));
  const detail = element('p', 'chart-tooltip', 'Touche un intervalle pour en voir le détail.');detail.setAttribute('aria-live', 'polite');
  const bars = [], segments = summary.segments.filter(segment => segment[key] > 0);
  const left = 38, bottom = 173, width = 660, height = 146;
  const maxZone = Math.max(5, ...summary.segments.map(segment => segment.zone || 0));
  for (let zone = 1; zone <= maxZone; zone++) {
    const y = bottom - height * zone / maxZone;
    svg.append(svgNode('line', { x1: left, y1: y, x2: left + width, y2: y, stroke: '#dddcd6', 'stroke-dasharray': '3 4' }), svgNode('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#6d716b' }, `Z${zone}`));
  }
  let elapsed = 0;
  for (const segment of segments) {
    const x = left + width * elapsed / total;
    const w = width * segment[key] / total;
    const h = height * (segment.zone || 0.45) / maxZone;
    const rect = svgNode('rect', { x, y: bottom - h, width: Math.max(0.1, w - Math.min(0.8, w / 4)), height: h, rx: Math.min(2, w / 5), fill: ZONE_COLORS[segment.zone] || '#b8b9b4' });
    const index = bars.length;
    const description = `${index + 1}. ${blockName(segment)} · ${format(segment[key])} · ${segment.zone ? `Z${segment.zone}` : 'zone non précisée'}`;
    rect.setAttribute('tabindex', index === 0 ? '0' : '-1');rect.setAttribute('role', 'button');rect.setAttribute('aria-label', description);
    const activate = () => { detail.textContent = description;bars.forEach(bar => {bar.setAttribute('tabindex', bar === rect ? '0' : '-1');bar.classList.toggle('is-active', bar === rect);}); };
    rect.addEventListener('pointerenter', activate);rect.addEventListener('click', activate);rect.addEventListener('focus', activate);
    rect.addEventListener('keydown', event => {
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();const next = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));bars[next].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();activate();}
    });
    rect.append(svgNode('title', {}, description));svg.append(rect);bars.push(rect);
    elapsed += segment[key];
  }
  svg.append(svgNode('line', { x1: left, y1: bottom, x2: left + width, y2: bottom, stroke: '#8a8d85' }));
  for (let tick = 0; tick <= 4; tick++) svg.append(svgNode('text', { x: left + width * tick / 4, y: 195, 'text-anchor': tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle', 'font-size': 11, fill: '#6d716b' }, tick === 0 ? '0' : format(total * tick / 4)));
  figure.append(svg, detail);
  if (segments.length !== summary.segments.length) figure.append(element('p', 'workout-chart-note', `Profil partiel : seuls les blocs avec une ${time ? 'durée' : 'distance'} sont représentés. Les autres restent dans le déroulé, sans estimation.`));
  const legend = element('div', 'workout-legend');
  const zones = [...new Set(segments.map(segment => segment.zone || 0))].sort((a, b) => a - b);
  zones.forEach(zone => { const item = element('span', '', zone ? `Z${zone}` : 'Zone non précisée'); item.style.setProperty('--zone-color', ZONE_COLORS[zone] || '#b8b9b4'); legend.append(item); });
  figure.append(legend); return figure;
}

/** Read-only presentation shared by coach preview and athlete session view. */
export function renderWorkout(container, blocks = [], { sport = 'other', chartOnly = false } = {}) {
  container.classList.add('workout-view'); container.replaceChildren();
  let normalized;
  try { normalized = normalizedCopy(blocks); } catch (error) { container.append(element('p', 'be-error', error.message)); return; }
  const summary = summarizeBlocks(normalized);
  if (summary.errors.length) container.append(element('p', 'be-error', summary.errors.join(' ')));
  const totals = [];
  if (summary.hasTime) totals.push(`${formatDuration(summary.duration_seconds)}${summary.hasUnquantified || summary.hasDistanceOnly ? ' connues' : ''}`);
  if (summary.hasDistance) totals.push(distanceLabel(summary.distance_m));
  if (totals.length) container.append(element('p', 'workout-totals', totals.join(' · ')));
  if (sport === 'running') container.append(renderChart(summary));
  if (chartOnly) return summary;
  if (!normalized.length) container.append(element('p', 'be-muted', 'Les consignes de cette séance sont dans sa description.'));
  normalized.forEach(block => container.append(readonlyBlock(block)));
  return summary;
}
