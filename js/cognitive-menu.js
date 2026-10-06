const GAMES = [
  ['tiles', 'Tuiles', 'Reproduis une séquence de couleurs.', 'Mémoire séquentielle', '▦'],
  ['bag', 'Sac', 'Séquences et cibles sur le sac de boxe.', 'Mémoire et réflexes', '◉'],
  ['visual-memory', 'Mémoire visuelle', 'Mémorise les cases, puis retrouve leurs positions.', 'Mémoire spatiale', '▧'],
  ['reaction', 'Test de réactivité', 'Repère le bon signal et réagis rapidement.', 'Attention et vitesse', 'ϟ'],
  ['dual-task', 'Double Tâche', 'Touche les cercles tout en comptant les triangles.', 'Attention et inhibition', '○ △'],
];
export function mountCognitiveMenu(host, { loadCognitive, loadReaction, loadMental = () => import('./mental-games.js'), cognitiveStore, reactionStore, mentalStore, ownerId, storage, now, autoTick, onActivity = () => {} } = {}) {
  let child = null, selected = null, destroyed = false, ticket = 0;
  function menu() {
    host.innerHTML = `<section class="cognitive-menu" aria-label="Choix du jeu cognitif"><p class="cognitive-menu-intro">Mémoire, attention et réflexes. Choisis ton jeu.</p><div class="cognitive-menu-grid">${GAMES.map(([id, title, description, label, icon]) => `<button class="cognitive-game-card" type="button" data-game="${id}"><span class="cognitive-game-icon" aria-hidden="true">${icon}</span><span class="cognitive-game-label">${label}</span><strong>${title}</strong><span>${description}</span><span class="cognitive-game-open" aria-hidden="true">Jouer ↗</span></button>`).join('')}</div></section>`;
    for (const button of host.querySelectorAll('[data-game]')) button.addEventListener('click', () => { void select(button.dataset.game); });
  }
  function back() {
    if (child?.canLeave && !child.canLeave()) return;
    const previous = selected; ticket++; child?.destroy(); child = null; selected = null; onActivity(false); menu();
    host.querySelector(`[data-game="${previous}"]`)?.focus({ preventScroll: true });
  }
  async function select(id) {
    if (destroyed || !GAMES.some(([key]) => key === id) || child?.canLeave && !child.canLeave()) return;
    child?.destroy(); child = null; selected = id; onActivity(false); const current = ++ticket;
    host.innerHTML = '<div class="cognitive-game-detail"><button class="button secondary cognitive-game-back" type="button">← Jeux cognitifs</button><div class="cognitive-game-host"><p role="status">Chargement du jeu…</p></div></div>';
    host.querySelector('.cognitive-game-back').addEventListener('click', back);
    const target = host.querySelector('.cognitive-game-host');
    const options = { ownerId, storage, now, autoTick, onActivity(active) { if (!destroyed && ticket === current) onActivity(active); } };
    try {
      if (id === 'tiles' || id === 'bag') {
        const { mountCognitiveGames } = await loadCognitive(); if (destroyed || ticket !== current) return;
        child = mountCognitiveGames(target, { ...options, autoTick: false, initialVariant: id, store: cognitiveStore });
      } else if (id === 'reaction') {
        const { mountReactionGame } = await loadReaction(); if (destroyed || ticket !== current) return;
        child = mountReactionGame(target, { ...options, store: reactionStore });
      } else {
        const { mountMentalGame } = await loadMental(); if (destroyed || ticket !== current) return;
        child = mountMentalGame(target, { ...options, mode: id, store: mentalStore, onBack: back });
        host.querySelector('.cognitive-game-back').hidden = true;
      }
    } catch { if (!destroyed && ticket === current) target.innerHTML = '<p role="alert">Impossible d’ouvrir ce jeu. Reviens au menu puis réessaie.</p>'; }
  }
  menu();
  return { select, tick() { if (!autoTick || ['tiles', 'bag'].includes(selected)) child?.tick(); }, canLeave() { return child?.canLeave?.() ?? true; }, destroy() { destroyed = true; ticket++; child?.destroy(); onActivity(false); host.replaceChildren(); } };
}
