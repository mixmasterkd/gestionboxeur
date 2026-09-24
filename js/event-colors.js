export const EVENT_COLORS = [
  { id: 'sand', label: 'Sable', background: '#f4ecd9', border: '#cfbc8d', ink: '#64512c' },
  { id: 'coral', label: 'Corail', background: '#fbe2dc', border: '#d6a499', ink: '#753f35' },
  { id: 'blue', label: 'Bleu', background: '#e1edf9', border: '#9ebbd9', ink: '#365775' },
  { id: 'lavender', label: 'Lavande', background: '#eee5f8', border: '#c0a6d6', ink: '#614477' },
  { id: 'mint', label: 'Menthe', background: '#e0f1e8', border: '#9cbfaa', ink: '#365d46' },
];
export function applyEventColor(node, color) {
  const choice = EVENT_COLORS.find(item => item.id === color) || EVENT_COLORS[0];
  node.dataset.color = choice.id;
  node.style.setProperty('--event-bg', choice.background);
  node.style.setProperty('--event-border', choice.border);
  node.style.setProperty('--event-ink', choice.ink);
}
