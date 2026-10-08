import { el, button } from './ui.js';
import { applyEventColor } from './event-colors.js';
import { summarizeBlocks, formatDuration } from './domain.js';
import { sessionChartData } from './session-chart.js';

/** Keep both types visible when possible, after accounting for the spanning note. */
export function chooseMonthPreviews(sessions, notes, spanningCount = 0) {
  const queue = [];
  if (sessions.length) queue.push({ kind: 'session', item: sessions[0] });
  if (notes.length) queue.push({ kind: 'note', item: notes[0] });
  queue.push(...sessions.slice(1).map(item => ({ kind: 'session', item })), ...notes.slice(1).map(item => ({ kind: 'note', item })));
  return queue.slice(0, Math.max(0, 2 - spanningCount));
}
const compactDuration = seconds => {
  const total = Math.round(seconds), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}h${m ? String(m).padStart(2,'0') : ''}` : m ? `${m}m${s ? String(s).padStart(2,'0') : ''}` : `${s}s`;
};
export function monthSessionPreview(session, onOpen) {
  const summary = summarizeBlocks(session.blocks || []), partial = summary.hasUnquantified || summary.hasDistanceOnly;
  const label = `${session.title} · ${session.completed_at ? 'Faite' : 'À faire'} · Ouvrir la séance`;
  const node = button('', onOpen, `month-preview month-session-preview${session.completed_at ? ' is-completed' : ''}`, { 'aria-label': label, title: session.title, dataset: { sessionId: session.id } });
  applyEventColor(node, session.workout_document?.banner_color || 'sand');
  node.append(el('strong', {}, session.title));
  const measure = summary.hasTime ? compactDuration(summary.duration_seconds) + (partial ? '+' : '') : summary.hasDistance ? `${Number((summary.distance_m / 1000).toFixed(2))}km` : 'Libre';
  node.append(el('span', { class:'month-preview-meta', title: summary.hasTime ? `${formatDuration(summary.duration_seconds)}${partial ? ' connues · étapes sans durée' : ''}` : 'Consulter la programmation' }, measure));
  const chart = sessionChartData(session, { summary, maxBars: 16 });
  if (chart.bars.length && !chart.aggregated && !chart.unavailable) {
    const graph = el('span', { class:'month-preview-chart', 'aria-hidden':'true' });
    for (const bar of chart.bars) {
      const mark = el('i');mark.style.flexGrow = String(bar.value);mark.style.height = `${Math.max(15, bar.highHeight * 100)}%`;
      mark.style.background = bar.range ? `linear-gradient(to top,${bar.color},${bar.highColor})` : bar.color;graph.append(mark);
    }
    node.append(graph);
  }
  return node;
}
export function monthNotePreview(note, onOpen) {
  const node = button('', onOpen, 'month-preview month-note-preview', { 'aria-label': `${note.title} · Ouvrir la note`, title: note.title, dataset: { eventId: note.id } });
  applyEventColor(node, note.color || 'sand');
  node.append(el('span', { class: 'month-preview-meta' }, 'Note'), el('strong', {}, note.title));
  return node;
}
