import { mountTestSessionBanner } from './test-session.js';

// The return action remains available even if the test account cannot load.
mountTestSessionBanner();

const icons = {
  athletes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  library: '<path d="M4 4h6v16H4zM14 4h6v16h-6zM6 8h2m8 0h2"/>',
  gym: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-8h6v8"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  admin: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

let disposeExplorer = () => {};

/** A native dialog keeps focus and Escape behaviour without replacing ordinary links. */
function mountExplorer(nav, items, route, onPlanning) {
  disposeExplorer();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'nav-explore';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'spaceNavigation');
  trigger.innerHTML = '<span class="explore-symbol" aria-hidden="true">✳</span><span>Explorer</span>';
  nav.append(trigger);

  const dialog = document.createElement('dialog');
  dialog.id = 'spaceNavigation';
  dialog.className = 'space-navigation';
  dialog.setAttribute('aria-labelledby', 'spaceTitle');
  dialog.innerHTML = '<div class="space-orbit" aria-hidden="true"><i></i><i></i><i></i></div><header class="space-heading"><div><h2 id="spaceTitle">Navigation</h2></div><button type="button" class="space-close" aria-label="Fermer la navigation">×</button></header><div class="space-stage"><div class="space-grid"></div></div><p class="space-hint">Choisis une rubrique pour continuer.</p>';
  const descriptions = {
    athletes: 'Fiches, disponibilités et listes.',
    calendar: 'Séances, événements et suivi.',
    gym: 'Coordonnées et identité du gym.',
    profile: 'Profil et informations sportives.',
    admin: 'Membres, gyms et athlète de test.',
    library: 'Tes entraînements et les séances de base.',
  };
  for (const [index, item] of items.entries()) {
    const link = document.createElement('a');
    link.className = 'space-card';
    link.href = route(item.href);
    link.innerHTML = `<span class="space-card-top">${icon(item.icon)}<span class="space-number">0${index + 1}</span></span><strong>${item.text}</strong><span class="space-description"></span><span class="space-arrow" aria-hidden="true">↗</span>`;
    link.querySelector('.space-description').textContent = item.connections ? 'Liens et autorisations de partage.' : descriptions[item.icon];
    if (item.active) {
      link.classList.add('is-current');
      const current = document.createElement('span');
      current.className = 'space-current'; current.textContent = 'Tu es ici'; link.append(current);
    }
    link.addEventListener('click', event => {
      dialog.close();
      if ((item.connections || item.library) && onPlanning) {
        const button = document.getElementById(item.library ? 'libraryButton' : 'connectionsButton');
        if (button) { event.preventDefault(); button.click(); }
      }
    });
    dialog.querySelector('.space-grid').append(link);
  }
  document.body.append(dialog);
  const close = dialog.querySelector('.space-close');
  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal();
    document.body.classList.add('space-is-open');
    close.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  const grid = dialog.querySelector('.space-grid');
  const motion = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let frame = null;
  const reset = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; grid.style.removeProperty('--space-x'); grid.style.removeProperty('--space-y');
  };
  dialog.addEventListener('pointermove', event => {
    if (!dialog.open || !motion.matches || event.pointerType === 'touch') return;
    const rect = dialog.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      grid.style.setProperty('--space-x', `${-y * 3}deg`);
      grid.style.setProperty('--space-y', `${x * 4}deg`);
      frame = null;
    });
  });
  dialog.addEventListener('pointerleave', reset);
  dialog.addEventListener('close', () => {
    reset(); document.body.classList.remove('space-is-open');
    if (trigger.isConnected && !document.querySelector('dialog[open]')) trigger.focus();
  });
  disposeExplorer = () => {
    reset(); dialog.remove(); document.body.classList.remove('space-is-open');
  };
}

/** Role-specific primary navigation. Authorization remains in the data layer. */
export function mountNavigation({ role = 'athlete', isAdmin = false } = {}) {
  document.getElementById('primaryNavigation')?.remove();
  const path = location.pathname;
  const inAdmin = /\/admin(?:\/|$)/.test(path);
  const base = inAdmin ? '../' : './';
  const athlete = role === 'athlete';
  const onPlanning = path.endsWith('/planning.html');
  const onProfile = path.endsWith('/profile.html');
  const params = new URLSearchParams(location.search);
  const previewRole = import.meta.env?.DEV && ['coach', 'athlete'].includes(params.get('demo')) ? params.get('demo') : null;
  const route = href => {
    const url = new URL(base + href, location.href);
    if (previewRole && url.pathname.endsWith('/planning.html')) url.searchParams.set('demo', previewRole);
    return url.href;
  };
  const nav = document.createElement('nav');
  nav.id = 'primaryNavigation';
  nav.className = 'primary-navigation';
  nav.setAttribute('aria-label', 'Menu principal');
  const identity = document.createElement('a');
  identity.className = 'nav-identity';
  identity.href = route(athlete || previewRole ? 'planning.html' : '');
  identity.innerHTML = '<span class="nav-track" aria-hidden="true"></span><span class="nav-role"></span>';
  identity.querySelector('.nav-role').textContent = athlete ? 'Mon compte' : 'Fonctions coach';
  nav.append(identity);
  const items = athlete
    ? [
      { icon: 'calendar', text: 'Calendrier', href: 'planning.html', active: onPlanning && location.hash !== '#coachs' },
      { icon: 'athletes', text: 'Mes coachs', href: 'planning.html#coachs', active: onPlanning && location.hash === '#coachs', connections: true },
      { icon: 'profile', text: 'Mon profil', href: 'profile.html', active: onProfile },
    ]
    : [
      { icon: 'athletes', text: 'Mes athlètes', href: '', active: !onPlanning && !onProfile && !inAdmin },
      { icon: 'calendar', text: 'Calendrier', href: 'planning.html', active: onPlanning },
      { icon: 'gym', text: 'Mon profil', href: 'profile.html', active: onProfile },
    ];
  if (isAdmin) items.push({ icon: 'admin', text: 'Administration', short: 'Admin', href: 'admin/', active: inAdmin });
  const links = document.createElement('div');
  links.className = 'nav-links';
  for (const item of items) {
    const link = document.createElement('a');
    link.href = route(item.href);
    if (previewRole && !new URL(link.href).pathname.endsWith('/planning.html')) link.title = 'Quitter l’aperçu et ouvrir mon espace connecté';
    link.innerHTML = `${icon(item.icon)}<span class="nav-label">${item.text}</span>${item.short ? `<span class="nav-label-short">${item.short}</span>` : ''}`;
    if (item.active) link.setAttribute('aria-current', 'page');
    if (item.connections && onPlanning) link.addEventListener('click', event => {
      const button = document.getElementById('connectionsButton');
      if (button) { event.preventDefault(); button.click(); }
    });
    links.append(link);
  }
  nav.append(links);
  document.body.classList.add('has-navigation');
  document.body.dataset.accountRole = athlete ? 'athlete' : 'coach';
  document.body.prepend(nav);
  mountExplorer(nav, athlete ? items : [...items, { icon: 'library', text: 'Bibliothèque', href: 'planning.html#bibliotheque', library: true }], route, onPlanning);
  if (!athlete && onPlanning && location.hash === '#bibliotheque') {
    const clean = new URL(location.href); clean.hash = ''; history.replaceState(history.state, '', clean.href);
    requestAnimationFrame(() => { const library = document.getElementById('libraryButton'); if (library && !library.hidden) library.click(); });
  }
  mountTestSessionBanner();
  if (onPlanning && location.hash === '#coachs') {
    // Consume this deep link before scheduling: a data refresh may mount the
    // navigation again before the first frame, or after the dialog was closed.
    const clean = new URL(location.href);
    clean.hash = '';
    history.replaceState(history.state, '', clean.href);
    requestAnimationFrame(() => {
      const connections = document.getElementById('connectionsButton');
      if (connections && !connections.hidden) connections.click();
    });
  }
}
