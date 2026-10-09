const icon = paths => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Shared destinations for the navigation and the tools page. */
export const TOOL_MENU_ITEMS = Object.freeze([
  { id: 'boxing', title: 'Timer de boxe', tool: 'boxing', icon: icon('<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m6 1 2-2m-8 5v4l3 2"/>') },
  { id: 'intervals', title: 'Timer à intervalles', tool: 'intervals', icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 3v4m9 5h-4m-5 9v-4m-9-5h4m5-4v4l3 2"/>') },
  { id: 'punches', title: 'Compteur de coups', tool: 'punches', icon: icon('<path d="M7 13V7a2 2 0 0 1 4 0V5a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v6c0 2-1 4-3 5v3H8v-3c-2-1-3-3-3-5v-1a2 2 0 0 1 2-2m4-3v4m4-4v4M8 18h8"/>') },
  { id: 'steps', title: 'Compteur de pas', tool: 'steps', icon: icon('<ellipse cx="8" cy="7" rx="3" ry="5" transform="rotate(-15 8 7)"/><ellipse cx="16" cy="14" rx="3" ry="5" transform="rotate(15 16 14)"/><path d="m6 15 1 3m8 3 1 1"/>') },
  { id: 'bulletin', title: 'Babillard', tool: 'bulletin', icon: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4v4H7zm8 0h2m-2 4h2M7 16h10"/>') },
  { id: 'tiles', title: 'Tuiles', tool: 'cognitive', game: 'tiles', icon: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>') },
  { id: 'bag', title: 'Sac', tool: 'cognitive', game: 'bag', icon: icon('<path d="m9 7 3-5 3 5m-5 5h4m-4 4h4"/><rect x="6" y="7" width="12" height="15" rx="4"/>') },
  { id: 'visual-memory', title: 'Mémoire visuelle', tool: 'cognitive', game: 'visual-memory', icon: icon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>') },
  { id: 'reaction', title: 'Test de réactivité', tool: 'cognitive', game: 'reaction', icon: icon('<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>') },
  { id: 'dual-task', title: 'Double Tâche', tool: 'cognitive', game: 'dual-task', icon: icon('<circle cx="7" cy="8" r="5"/><path d="m16 10 6 11H10z"/>') },
].map(item => Object.freeze(item)));
