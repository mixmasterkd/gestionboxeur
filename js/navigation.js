import { mountTestSessionBanner } from './test-session.js';

// The return action remains available even if the test account cannot load.
mountTestSessionBanner();

const icons = {
  athletes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  gym: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-8h6v8"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  admin: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
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
  identity.querySelector('.nav-role').textContent = athlete ? 'Espace athlète' : 'Espace coach';
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
      { icon: 'gym', text: 'Mon gym', href: 'profile.html', active: onProfile },
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
  mountTestSessionBanner();
  if (athlete && onPlanning && location.hash === '#coachs') {
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
