import { addDays, weekStart, monthDates, todayLocal } from './domain.js';
export function datesForView(anchor, view) {
  if (view === 'today') return [anchor];
  if (view === 'month') return monthDates(anchor);
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
export function shiftPeriod(anchor, view, direction) {
  if (view !== 'month') return addDays(anchor, direction * (view === 'today' ? 1 : 7));
  const [y, m] = anchor.split('-').map(Number), d = new Date(y, m - 1 + direction, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
export function orderedSessions(sessions) { return [...sessions].sort((a,b) => a.date.localeCompare(b.date) || Number(a.sort_order)-Number(b.sort_order) || a.id.localeCompare(b.id)); }
// Une seule écriture : les séances des autres coachs restent intactes.
export function positionBetween(before, after) {
  if (!before && !after) return 1024;
  if (!before) return Number(after.sort_order) - 1024;
  if (!after) return Number(before.sort_order) + 1024;
  const lower = Number(before.sort_order), upper = Number(after.sort_order), result = lower + (upper-lower)/2;
  if (!Number.isFinite(result) || result <= lower || result >= upper) throw new Error('Ces positions sont trop proches. Déplace la séance en début ou en fin de journée.');
  return result;
}
export function eventOnDate(event, date) { return event.date <= date && (event.end_date || event.date) >= date; }
export function dateLabel(date, options={day:'numeric',month:'long'}) { return new Intl.DateTimeFormat('fr-CA', options).format(new Date(`${date}T12:00:00`)); }
export function periodLabel(anchor, view) {
  if (view === 'today') return dateLabel(anchor,{weekday:'long',day:'numeric',month:'long'});
  if (view === 'month') return dateLabel(anchor,{month:'long',year:'numeric'});
  const start=weekStart(anchor),end=addDays(start,6);
  if(start.slice(0,7)===end.slice(0,7)) return `${Number(start.slice(8))}–${dateLabel(end)}`;
  return `${dateLabel(start,{day:'numeric',month:'short'})} — ${dateLabel(end,{day:'numeric',month:'short',year:'numeric'})}`;
}
export { todayLocal };
