/** Targets describe what was written; they never infer physiological zones. */
const clean = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—−]/g, '-').trim().toLowerCase();
const numeric = '(\\d+(?:[.,]\\d+)?)';
const number = value => Number(value.replace(',', '.'));
const colors = ['Vert', 'Jaune', 'Rouge'];
function interval(kind, first, last = first, { minimum, maximum, integer = false, basis } = {}) {
  const min = number(first), max = number(last);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < minimum || max > maximum || min > max || integer && (!Number.isInteger(min) || !Number.isInteger(max))) {
    throw new Error(`Cible ${kind === 'zone' ? 'zone' : kind === 'rpe' ? 'RPE' : kind} invalide${minimum != null && maximum != null ? ` : de ${minimum} à ${maximum}` : ''}.`);
  }
  return { kind, min, max, ...(basis ? { basis } : {}) };
}
function pace(value) {
  const [minutes, seconds] = value.split(':').map(Number);
  if (seconds > 59 || minutes * 60 + seconds <= 0 || minutes > 1440) throw new Error('Allure invalide : utilise minutes:secondes/km.');
  return minutes * 60 + seconds;
}
export function parseEffort(value) {
  if (value == null || !String(value).trim()) return null;
  const original = String(value).trim().replace(/^@\s*/, '').trim();
  const source = clean(original);
  if (!source || /^(non precisee?|libre)$/.test(source)) return null;
  if (original.length > 120) throw new Error('La cible ne peut pas dépasser 120 caractères.');
  let match;
  if ((match = new RegExp(`^z(?:one)?\\s*${numeric}(?:\\s*-\\s*(?:z(?:one)?\\s*)?${numeric})?(?:\\s*(fc|allure))?$`, 'i').exec(source))) return interval('zone', match[1], match[2], { minimum: 1, maximum: 7, integer: true, basis: {fc:'hr',allure:'pace'}[match[3]] });
  if ((match = new RegExp(`^rpe\\s*${numeric}(?:\\s*-\\s*(?:rpe\\s*)?${numeric})?(?:\\s*(?:/|sur)\\s*10)?$`, 'i').exec(source))) return interval('rpe', match[1], match[2], { minimum: 1, maximum: 10, basis: '10' });
  if ((match = /^(vert|jaune|rouge)(?:\s*-\s*(vert|jaune|rouge))?$/.exec(source))) {
    return interval('color', String(colors.findIndex(color => clean(color) === match[1]) + 1), String(colors.findIndex(color => clean(color) === (match[2] || match[1])) + 1), { minimum: 1, maximum: 3, integer: true });
  }
  if ((match = /^(\d+)(?:\s*-\s*(\d+))?\s*bpm$/.exec(source))) return interval('bpm', match[1], match[2], { minimum: 1, maximum: 300, integer: true, basis: 'bpm' });
  if ((match = /^(\d+:\d{1,2})(?:\s*-\s*(\d+:\d{1,2}))?\s*(?:min\s*)?\/\s*km$/.exec(source))) {
    const first = pace(match[1]), last = pace(match[2] || match[1]);
    return { kind: 'pace', min: Math.min(first, last), max: Math.max(first, last), basis: 'seconds_per_km' };
  }
  const recovery = { repos: 'Repos', marche: 'Marche', marcher: 'Marche', 'repos actif': 'Repos actif', 'recuperation active': 'Repos actif', recuperation: 'Repos' }[source];
  if (recovery) return { kind: 'recovery', label: recovery };
  // Do not turn mistyped numeric targets into a plausible-looking custom target.
  if (/^(?:z(?:one)?\s*[+-]?\d|rpe|\d)|\bbpm\b|\/\s*km\b/.test(source)) throw new Error('Cible invalide : précise la zone, le RPE, les bpm ou l’allure /km.');
  return { kind: 'custom', label: original };
}

const value = number => Number.isInteger(number) ? String(number) : String(number).replace('.', ',');
const paceText = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
export function formatEffort(effort) {
  if (!effort || typeof effort !== 'object') return '';
  const range = (format, suffix = '') => `${format(effort.min)}${effort.max != null && effort.max !== effort.min ? `-${format(effort.max)}` : ''}${suffix}`;
  switch (effort.kind) {
    case 'zone': return range(number => `Z${value(number)}`, {hr:' FC',pace:' Allure'}[effort.basis] || '');
    case 'rpe': return `RPE ${range(value)}/10`;
    case 'color': return range(number => colors[number - 1] || '');
    case 'bpm': return range(value, ' bpm');
    case 'pace': return range(paceText, '/km');
    case 'recovery': case 'custom': return effort.label || '';
    default: return '';
  }
}
