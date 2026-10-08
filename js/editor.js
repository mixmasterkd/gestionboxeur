import { blockName, ZONE_COLORS, WORKOUT_LIMITS, makeBlock, summarizeBlocks, formatDuration } from './domain.js';

const copy = value => structuredClone(value);
const distanceLabel = value => value >= 1000 ? `${Number((value / 1000).toFixed(2)).toLocaleString('fr')} km` : `${value.toLocaleString('fr')} m`;
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
