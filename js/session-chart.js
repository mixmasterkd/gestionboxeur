import { BLOCK_TYPES, ZONE_COLORS, summarizeBlocks, formatDuration } from './domain.js';

const typeNames = new Map(BLOCK_TYPES.map(type => [type.id, type.label]));
const typeColors = {
  warmup: '#8091a7', shadow: '#60a5fa', bag: '#346cc4', pads: '#7167a8',
  technique: '#64949b', sparring: '#414e74', footwork: '#8b77b4', agility: '#718ca8',
  conditioning: '#688269', cardio: '#498983', strength: '#79648d', mobility: '#77a399',
  recovery: '#c0c6ce', rest: '#c0c6ce', other: '#8c94a0',
};
export const SESSION_CHART_LIMIT = 96;

/** Bounded chart data: unusually long timelines become an explicitly labelled distribution. */
export function sessionChartData(session, { summary = summarizeBlocks(session.blocks || []), maxBars = SESSION_CHART_LIMIT } = {}) {
  const running = session.sport === 'running';
  const limit = Math.max(1, Math.min(SESSION_CHART_LIMIT, Math.floor(Number(maxBars)) || SESSION_CHART_LIMIT));
  const source = summary.segments.filter(segment => segment.duration_seconds > 0);
  const partial = Boolean(summary.errors.length || summary.hasUnquantified || summary.hasDistanceOnly);
  let bars = source.map(segment => {
    const rest = segment.phase === 'rest' || segment.type === 'recovery';
    const type = rest ? 'rest' : typeColors[segment.type] ? segment.type : 'other';
    const zone = segment.zone || 0;
    const name = running ? (zone ? `Zone ${zone}` : 'Zone non précisée') : (rest ? 'Repos / récupération' : typeNames.get(segment.type) || 'Autre');
    return {
      seconds: segment.duration_seconds, zone, type,
      key: running ? String(zone) : type,
      color: running ? ZONE_COLORS[zone] || '#aeb6c0' : typeColors[type],
      label: `${segment.title || typeNames.get(segment.type) || 'Bloc'}${segment.round ? ` · round ${segment.round}` : ''}`,
      name,
    };
  });
  const aggregated = bars.length > limit;
  if (aggregated) {
    const groups = new Map();
    for (const bar of bars) {
      if (groups.has(bar.key)) groups.get(bar.key).seconds += bar.seconds;
      else groups.set(bar.key, { ...bar, label: bar.name });
    }
    bars = [...groups.values()];
    // Callers may request fewer bars than the number of categories. Merge the tail honestly.
    if (bars.length > limit) {
      const tail = bars.slice(limit - 1);
      bars = [...bars.slice(0, limit - 1), { key: 'mixed', type: 'other', zone: 0, color: '#aeb6c0', seconds: tail.reduce((total, bar) => total + bar.seconds, 0), label: 'Autres blocs', name: 'Autres blocs' }];
    }
  }
  return { running, bars, partial, aggregated, total: source.reduce((total, segment) => total + segment.duration_seconds, 0), unavailable: Boolean(summary.errors.length), segments: source.length };
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

/** Shared by calendar tiles and the boxing preview. Never infers pace or exertion. */
export function renderSessionChart(session, { compact = true, summary, maxBars } = {}) {
  const data = sessionChartData(session, { summary, maxBars });
  const figure = html('figure', `session-chart${compact ? ' session-chart-compact' : ''}${data.running ? ' session-chart-running' : ' session-chart-boxing'}`);
  const heading = data.aggregated ? (data.running ? 'Répartition par zone' : 'Répartition des ateliers') : (data.running ? 'Profil de course' : 'Rounds et ateliers');
  figure.append(html('figcaption', '', heading));
  if (!data.bars.length || data.unavailable) {
    figure.append(html('p', 'session-chart-note', data.unavailable ? 'Profil indisponible : vérifie les blocs.' : 'Durées non renseignées · aucun temps estimé.'));
    return figure;
  }
  const width = 288, bottom = 52, height = 42;
  const explanation = data.running ? 'Largeur : durée. Hauteur et couleur : zone cible renseignée.' : 'Largeur : durée. Couleur : type d’atelier ou repos. La hauteur ne représente pas l’effort.';
  const categories=[...new Set(data.bars.map(bar=>bar.name))].join(', ');
  const label = `${heading} · ${formatDuration(data.total)}${data.partial ? ' connues. Profil partiel.' : '.'} ${explanation} ${categories}.${data.aggregated ? ' Les blocs sont regroupés par catégorie, sans ordre chronologique.' : ''}`;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} 65`, role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  svg.append(svgNode('title', {}, label));
  if (data.running) {
    for (const zone of [2, 4, 6]) svg.append(svgNode('line', { x1: 0, y1: bottom - height * zone / 7, x2: width, y2: bottom - height * zone / 7, class: 'session-chart-guide' }));
  }
  let elapsed = 0;
  for (const bar of data.bars) {
    const x = width * elapsed / data.total, barWidth = width * bar.seconds / data.total;
    const barHeight = data.running ? height * (bar.zone || 0.5) / 7 : 31;
    const rect = svgNode('rect', { x, y: bottom - barHeight, width: barWidth, height: barHeight, fill: bar.color, 'data-seconds': bar.seconds, 'data-kind': bar.key });
    rect.append(svgNode('title', {}, `${bar.label} · ${formatDuration(bar.seconds)} · ${bar.name}`));
    svg.append(rect); elapsed += bar.seconds;
  }
  svg.append(svgNode('line', { x1: 0, y1: bottom, x2: width, y2: bottom, class: 'session-chart-baseline' }));
  svg.append(svgNode('text', { x: 0, y: 64, class: 'session-chart-axis' }, '0'), svgNode('text', { x: width, y: 64, 'text-anchor': 'end', class: 'session-chart-axis' }, formatDuration(data.total)));
  figure.append(svg);
  const note = data.partial ? 'Profil partiel · durées connues uniquement.' : data.aggregated ? 'Blocs regroupés par catégorie.' : data.running ? 'Zone cible · durée' : 'Ateliers et repos · durée';
  figure.append(html('p', 'session-chart-note', `${note}${data.partial && data.aggregated ? ' Blocs regroupés.' : ''}`));
  if (!compact) {
    const legend = html('div', 'session-chart-legend');
    for (const bar of new Map(data.bars.map(bar => [bar.key, bar])).values()) {
      const entry = html('span', '', bar.name); entry.style.setProperty('--chart-color', bar.color); legend.append(entry);
    }
    figure.append(legend);
  }
  return figure;
}
