const GAMES = new Set(['tiles', 'bag', 'visual-memory', 'reaction', 'dual-task']);
export function mountCognitiveMenu(host, { loadCognitive, loadReaction, loadMental = () => import('./mental-games.js'), cognitiveStore, reactionStore, mentalStore, ownerId, storage, now, autoTick, onActivity = () => {}, onSelection = () => {} } = {}) {
  let child = null, selected = null, destroyed = false, ticket = 0;
  async function select(id) {
    if (destroyed || !GAMES.has(id)) return false;
    if (selected === id) return true;
    return load(id);
  }
  async function load(id) {
    if (destroyed) return false;
    if (child?.canLeave && !child.canLeave()) return false;
    const changed = selected !== id, current = ++ticket;
    child?.destroy(); child = null; selected = id; onActivity(false);
    host.innerHTML = '<div class="cognitive-game-detail"><div class="cognitive-game-host"><p role="status">Chargement du jeu…</p></div></div>';
    const target = host.querySelector('.cognitive-game-host');
    // The accepted loading view is already the selected game; late imports never select again.
    if (changed) onSelection(id);
    const options = { ownerId, storage, now, autoTick, onActivity(active) { if (!destroyed && ticket === current) onActivity(active); } };
    try {
      if (id === 'tiles' || id === 'bag') {
        const { mountCognitiveGames } = await loadCognitive(); if (destroyed || ticket !== current) return false;
        child = mountCognitiveGames(target, { ...options, autoTick: false, initialVariant: id, store: cognitiveStore });
      } else if (id === 'reaction') {
        const { mountReactionGame } = await loadReaction(); if (destroyed || ticket !== current) return false;
        child = mountReactionGame(target, { ...options, store: reactionStore });
      } else {
        const { mountMentalGame } = await loadMental(); if (destroyed || ticket !== current) return false;
        child = mountMentalGame(target, { ...options, mode: id, store: mentalStore });
      }
    } catch {
      if (!destroyed && ticket === current) {
        const message = host.ownerDocument.createElement('p'); message.setAttribute('role', 'alert'); message.textContent = 'Impossible d’ouvrir ce jeu. Réessaie dans un instant.';
        const retry = host.ownerDocument.createElement('button'); retry.type = 'button'; retry.className = 'button secondary'; retry.textContent = 'Réessayer';
        retry.addEventListener('click', () => {
          if (destroyed || ticket !== current || selected !== id || retry.disabled) return;
          retry.disabled = true;
          void load(id).then(accepted => { if (!accepted && retry.isConnected) retry.disabled = false; });
        });
        target.replaceChildren(message, retry);
      }
    }
    return !destroyed && ticket === current;
  }
  host.replaceChildren();
  return {
    select,
    getSelection() { return selected; },
    tick() { if (!destroyed && (!autoTick || ['tiles', 'bag'].includes(selected))) child?.tick(); },
    canLeave() { return destroyed ? true : child?.canLeave?.() ?? true; },
    destroy() { if (destroyed) return; destroyed = true; ticket++; child?.destroy(); child = null; selected = null; onActivity(false); host.replaceChildren(); },
  };
}
