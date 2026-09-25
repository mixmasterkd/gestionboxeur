import { blockName, ZONE_COLORS, summarizeBlocks, formatDuration } from './domain.js';
import { formatEffort } from './workout-effort.js';

export const SESSION_CHART_LIMIT = 96;
const NEUTRAL = '#939eae';
const COLOR_LEVELS = ['#58a97e', '#d9b645', '#db626d'];
const RPE_COLORS = ['#8fa8b5', '#71aeb0', '#55aa92', '#73af77', '#a6b263', '#c9b34e', '#d7a34b', '#dc8751', '#df6c5e', '#d75064'];
const distanceLabel = metres => metres >= 1000 ? `${Number((metres / 1000).toFixed(3)).toLocaleString('fr-CA')} km` : `${Number(metres.toFixed(3)).toLocaleString('fr-CA')} mtr`;
const numericRange = (effort, max) => Number.isFinite(effort.min) && Number.isFinite(effort.max ?? effort.min) && effort.min >= 1 && effort.min <= (effort.max ?? effort.min) && (effort.max ?? effort.min) <= max;

/** Effort scales stay separate. Absolute pace/HR never acquire an inferred zone. */
function effortAppearance(segment) {
  const effort = segment.phase === 'rest'
    ? { kind: 'recovery', label: 'Repos' }
    : segment.effort || (segment.zone ? { kind: 'zone', min: segment.zone, max: segment.zone } : null);
  const base = { effort, name: effort ? formatEffort(effort) : 'Effort non précisé', lowHeight: .16, highHeight: .16, color: NEUTRAL, highColor: NEUTRAL, range: false, scaled: false, conventional: false, absolute: false };
  if (!effort) return base;
  const max = effort.max ?? effort.min;
  if (effort.kind === 'zone' && numericRange(effort, 7) && Number.isInteger(effort.min) && Number.isInteger(max)) {
    return { ...base, lowHeight: effort.min / 7, highHeight: max / 7, color: ZONE_COLORS[effort.min], highColor: ZONE_COLORS[max], range: effort.min !== max, scaled: true };
  }
  if (effort.kind === 'rpe' && numericRange(effort, 10)) {
    return { ...base, lowHeight: effort.min / 10, highHeight: max / 10, color: RPE_COLORS[Math.round(effort.min) - 1], highColor: RPE_COLORS[Math.round(max) - 1], range: effort.min !== max, scaled: true };
  }
  if (effort.kind === 'color' && numericRange(effort, 3) && Number.isInteger(effort.min) && Number.isInteger(max)) {
    const levels = [.3, .58, .88];
    return { ...base, lowHeight: levels[effort.min - 1], highHeight: levels[max - 1], color: COLOR_LEVELS[effort.min - 1], highColor: COLOR_LEVELS[max - 1], range: effort.min !== max, scaled: true };
  }
  if (effort.kind === 'recovery') {
    const label = String(effort.label || '').toLocaleLowerCase('fr');
    const known = { repos: [.1, '#a3a9b2'], marche: [.18, '#87a3b1'], 'repos actif': [.24, '#8fa89b'] }[label];
    if (known) return { ...base, lowHeight: known[0], highHeight: known[0], color: known[1], highColor: known[1], conventional: true };
  }
  return { ...base, absolute: effort.kind === 'bpm' || effort.kind === 'pace' };
}

/** Bounded chart data: long timelines become an explicitly labelled distribution. */
export function sessionChartData(session, { summary = summarizeBlocks(session.blocks || []), maxBars = SESSION_CHART_LIMIT, partial = false } = {}) {
  const running = session.sport === 'running';
  const limit = Math.max(1, Math.min(SESSION_CHART_LIMIT, Math.floor(Number(maxBars)) || SESSION_CHART_LIMIT));
  const all = summary.segments || [];
  const measured=all.filter(segment=>segment.duration_seconds>0||segment.distance_m>0);
  const hasSeries=all.some(segment=>segment.repetitions>0&&!segment.duration_seconds&&!segment.distance_m);
  const axis = !measured.length&&hasSeries?'series':measured.length&&measured.every(segment=>segment.distance_m>0&&!segment.duration_seconds)?'distance':'duration';
  const source = all.filter(segment => (axis === 'distance' ? segment.distance_m > 0 : segment.duration_seconds > 0)||(segment.repetitions>0&&!segment.duration_seconds&&!segment.distance_m));
  const doses=measured.map(segment=>axis==='distance'?segment.distance_m:segment.duration_seconds).filter(Boolean).sort((a,b)=>a-b);
  // A series gets a modest visual slot, never an estimated duration or distance.
  const seriesWidth=axis==='series'?1:Math.max(axis==='distance'?25:15,Math.min(axis==='distance'?200:60,(doses[Math.floor(doses.length/2)]||60)/2));
  const omitted = all.length - source.length;
  let bars = source.map(segment => {
    const appearance = effortAppearance(segment);
    const type = segment.phase === 'rest' ? 'rest' : segment.type;
    const activity = segment.phase === 'rest' ? 'Repos' : blockName(segment);
    const customTitle = segment.title && segment.title !== activity ? segment.title : '';
    return {
      ...appearance, seconds: segment.duration_seconds || 0, distance: segment.distance_m || 0, repetitions:segment.repetitions||0,
      indicative:!(axis==='distance'?segment.distance_m:segment.duration_seconds),
      value: (axis === 'distance' ? segment.distance_m : segment.duration_seconds)||seriesWidth,
      zone: segment.zone || (segment.effort?.kind === 'zone' && segment.effort.min === segment.effort.max ? segment.effort.min : 0),
      type, blockId: segment.id, key: appearance.effort ? JSON.stringify(appearance.effort) : 'unspecified',
      label: `${activity}${customTitle ? ` · ${customTitle}` : ''}${segment.round ? ` · round ${segment.round}` : ''}`,
      instruction: [segment.description, segment.notes].filter(Boolean).join(' · '),
    };
  });
  const aggregated = bars.length > limit;
  if (aggregated) {
    const groups = new Map();
    for (const bar of bars) {
      if (groups.has(bar.key)) {
        const existing = groups.get(bar.key);
        for (const measure of ['value', 'seconds', 'distance','repetitions']) existing[measure] += bar[measure];
        existing.indicative ||= bar.indicative;
      } else groups.set(bar.key, { ...bar, label: bar.name, blockId: null, instruction: '' });
    }
    bars = [...groups.values()];
    if (bars.length > limit) {
      const tail = bars.slice(limit - 1);
      bars = [...bars.slice(0, limit - 1), {
        ...effortAppearance({}), key: 'mixed', type: 'other', zone: 0,
        value: tail.reduce((total, bar) => total + bar.value, 0),
        seconds: tail.reduce((total, bar) => total + bar.seconds, 0),
        distance: tail.reduce((total, bar) => total + bar.distance, 0),
        repetitions:tail.reduce((total,bar)=>total+bar.repetitions,0),indicative:tail.some(bar=>bar.indicative),blockId: null, label: 'Autres efforts', name: 'Autres efforts', instruction: '',
      }];
    }
  }
  return {
    running, bars, axis, omitted, hasSeries,layoutTotal:bars.reduce((total,bar)=>total+bar.value,0), partial: Boolean(partial || summary.errors?.length || omitted), aggregated,
    total: source.reduce((total, segment) => total + (axis==='series'?1:axis === 'distance' ? segment.distance_m : segment.duration_seconds), 0),
    unavailable: Boolean(summary.errors?.length), segments: source.length,
  };
}

function html(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text != null) node.textContent = text; return node;
}
function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text != null) node.textContent = text; return node;
}

/** The same effort plan on calendar tiles, in the editor, and while reading. */
export function renderSessionChart(session, { compact = true, summary, maxBars, partial = false, onSelect } = {}) {
  const data = sessionChartData(session, { summary, maxBars, partial });
  const figure = html('figure', `session-chart${compact ? ' session-chart-compact' : ''}${data.running ? ' session-chart-running' : ' session-chart-boxing'}`);
  const heading = data.aggregated ? 'Répartition des efforts' : 'Plan visuel';
  figure.append(html('figcaption', '', heading));
  if (!data.bars.length || data.unavailable) {
    figure.classList.add('session-chart-empty');
    figure.append(html('p', 'session-chart-note', data.unavailable ? 'Profil indisponible : vérifie les étapes.' : !session.blocks?.length ? 'Aucune étape structurée.' : 'Aucune durée représentable · aucun temps estimé.'));
    if (data.partial && !data.unavailable) figure.append(html('p', 'session-chart-note', 'Profil partiel · le texte reste visible dans la séance.'));
    return figure;
  }
  const width = 288, bottom = 60, height = 50;
  const measure = data.axis === 'series' ? count=>`${count} série${count>1?'s':''}` : data.axis === 'distance' ? distanceLabel : formatDuration;
  const explanation = `Largeur : ${data.axis === 'series' ? 'indicative, une barre par série' : data.axis === 'distance' ? 'distance' : 'durée'}${data.hasSeries&&data.axis!=='series'?' avec des emplacements indicatifs pour les séries, sans durée ni distance estimée':''}. Hauteur et couleur : effort demandé ou zone cible, selon sa propre échelle. Effort non précisé : repère neutre.`;
  const categories = [...new Set(data.bars.map(bar => bar.name))].join(', ');
  const label = `${heading} · ${measure(data.total)}${data.partial ? ' connues. Profil partiel.' : '.'} ${explanation} ${categories}.${data.aggregated ? ' Les étapes sont regroupées par effort, sans ordre chronologique.' : ''}`;
  const interactive = !compact || Boolean(onSelect);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} 64`, role: interactive ? 'group' : 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  svg.append(svgNode('title', {}, label));
  for (const level of [.25, .5, .75]) svg.append(svgNode('line', { x1: 0, y1: bottom - height * level, x2: width, y2: bottom - height * level, class: 'session-chart-guide' }));
  const selection = interactive ? html('output', 'session-chart-selection', onSelect && !data.aggregated ? 'Choisis une étape pour la modifier.' : 'Choisis une portion pour voir le détail.') : null;
  if (selection) selection.setAttribute('aria-live', 'polite');
  let elapsed = 0;
  for (const bar of data.bars) {
    const x = width * elapsed / data.layoutTotal, barWidth = width * bar.value / data.layoutTotal;
    const barLabel = `${bar.label} · ${bar.indicative ? `${bar.repetitions} mouvements · largeur indicative` : `${measure(data.axis==='distance'?bar.distance:bar.seconds)}${bar.repetitions?` · ${bar.repetitions} mouvements`:''}`} · ${bar.name}${bar.instruction ? ` · ${bar.instruction}` : ''}`;
    const group = svgNode('g', { class: 'session-chart-segment', 'data-block-id': bar.blockId || '', ...(interactive ? { role: 'button', tabindex: '0', 'aria-label': `${barLabel}${onSelect && bar.blockId ? ' · Modifier cette étape' : ''}` } : {}) });
    group.append(svgNode('title', {}, barLabel));
    if (bar.range) {
      group.append(svgNode('rect', { x, y: bottom - height * bar.highHeight, width: barWidth, height: height * bar.highHeight, fill: bar.highColor, 'fill-opacity': '.38', class: 'session-chart-upper', 'data-bound': 'upper' }));
    }
    group.append(svgNode('rect', {
      x, y: bottom - height * bar.lowHeight, width: barWidth, height: height * bar.lowHeight, fill: bar.color,
      'fill-opacity': bar.range ? '.95' : '1', 'data-seconds': bar.seconds, 'data-distance': bar.distance, 'data-kind': bar.key,
      'data-repetitions':bar.repetitions,'data-indicative':String(bar.indicative),'data-bound': bar.range ? 'lower' : 'single', class: 'session-chart-lower',
    }));
    if (interactive) {
      // The whole column responds to touch, including above short recovery bars.
      group.append(svgNode('path', { d: `M${x} ${bottom - height}h${barWidth}v${height}h${-barWidth}Z`, class: 'session-chart-hit', fill: 'transparent' }));
      const choose = event => {
        event.preventDefault(); event.stopPropagation();
        for (const other of svg.querySelectorAll('.session-chart-segment')) other.removeAttribute('data-selected');
        group.setAttribute('data-selected', 'true'); selection.textContent = barLabel;
        if (bar.blockId && typeof onSelect === 'function') onSelect(bar.blockId);
      };
      group.addEventListener('click', choose);
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') choose(event); });
    }
    svg.append(group); elapsed += bar.value;
  }
  svg.append(svgNode('line', { x1: 0, y1: bottom, x2: width, y2: bottom, class: 'session-chart-baseline' }));
  figure.append(svg);
  const axisLabels = html('div', 'session-chart-axis-labels');
  axisLabels.setAttribute('aria-hidden', 'true');
  axisLabels.append(html('span', '', '0'), html('span', '', `${measure(data.total)}${data.hasSeries&&data.axis!=='series'?' + séries':''}`));
  figure.append(axisLabels);
  const notes = [data.hasSeries ? (data.axis==='series'?'Séries · largeurs indicatives, aucun temps estimé.':'Séries sans durée ni distance : largeurs indicatives, exclues du total de durée ou de distance.') : data.partial ? `Profil partiel · ${data.axis === 'distance' ? 'distances' : 'durées'} connues uniquement.` : `Effort demandé · ${data.axis === 'distance' ? 'distance' : 'durée'}`];
  if (data.aggregated) notes.push('Étapes regroupées par effort, sans ordre chronologique.');
  if (!compact && data.bars.some(bar => bar.absolute)) notes.push('BPM et allures : valeurs affichées sans estimation de leur difficulté.');
  if (!compact && data.bars.some(bar => bar.conventional)) notes.push('Repos et marche : hauteurs indicatives.');
  if (!compact && new Set(data.bars.filter(bar => bar.scaled).map(bar => bar.effort.kind)).size > 1) notes.push('Les échelles d’effort ne sont pas équivalentes.');
  figure.append(html('p', 'session-chart-note', notes.join(' ')));
  if (selection) figure.append(selection);
  if (!compact) {
    const legend = html('div', 'session-chart-legend');
    for (const bar of new Map(data.bars.map(bar => [bar.key, bar])).values()) {
      const entry = html('span', '', bar.name);
      entry.style.setProperty('--chart-color', bar.range ? `linear-gradient(to top, ${bar.color} 50%, ${bar.highColor} 50%)` : bar.color);
      legend.append(entry);
    }
    figure.append(legend);
  }
  return figure;
}
