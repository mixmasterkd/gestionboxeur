import { mountTestSessionBanner } from './test-session.js';

// The return action remains available even if the test account cannot load.
mountTestSessionBanner();

const icons = {
  athletes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  journal: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>',
  library: '<path d="M4 4h6v16H4zM14 4h6v16h-6zM6 8h2m8 0h2"/>',
  gym: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-8h6v8"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  admin: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

/** Role-specific primary navigation. Authorization remains in the data layer. */
export function mountNavigation({ role = 'athlete', isAdmin = false, section = '' } = {}) {
  document.getElementById('primaryNavigation')?.remove();
  const path = location.pathname;
  const inAdmin = /\/admin(?:\/|$)/.test(path);
  const base = inAdmin ? '../' : './';
  const athlete = role === 'athlete';
  const onPlanning = path.endsWith('/planning.html');
  const onJournal=onPlanning&&(section==='journal'||!section&&location.hash==='#journal');
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
  identity.href = route('planning.html');
  identity.innerHTML = '<img class="nav-logo" alt="" width="104" height="104"><span class="nav-role"></span>';
  identity.querySelector('img').src = base + 'images/boxing-logo.png';
  identity.querySelector('.nav-role').textContent = athlete ? 'Mon compte' : 'Fonctions coach';
  nav.append(identity);
  const items = athlete
    ? [
      { icon: 'calendar', text: 'Calendrier', href: 'planning.html', active: onPlanning && !onJournal && location.hash !== '#coachs', calendar: true },
      { icon: 'athletes', text: 'Mes coachs', href: 'planning.html#coachs', active: onPlanning && location.hash === '#coachs', connections: true },
      { icon: 'profile', text: 'Mon profil', href: 'profile.html', active: onProfile },
    ]
    : [
      { icon: 'calendar', text: 'Calendrier', href: 'planning.html', active: onPlanning&&!onJournal, calendar:true },
      { icon: 'athletes', text: 'Mes athlètes', href: 'roster.html', active: path.endsWith('/roster.html') },
      { icon: 'gym', text: 'Mon profil', href: 'profile.html', active: onProfile },
    ];
  items.splice(1,0,{icon:'journal',text:'Journal',href:'planning.html#journal',active:onJournal,journal:true});
  if (isAdmin) items.push({ icon: 'admin', text: 'Administration', short: 'Admin', href: 'admin/', active: inAdmin });
  const links = document.createElement('div');
  links.className = 'nav-links';
  for (const item of items) {
    const link = document.createElement('a');
    link.href = route(item.href);
    if (previewRole && !new URL(link.href).pathname.endsWith('/planning.html')) link.title = 'Quitter l’aperçu et ouvrir mon espace connecté';
    link.innerHTML = `${icon(item.icon)}<span class="nav-label">${item.text}</span>${item.short ? `<span class="nav-label-short">${item.short}</span>` : ''}`;
    if (item.active) link.setAttribute('aria-current', 'page');
    if ((item.journal||item.calendar)&&onPlanning) link.addEventListener('click',event=>{const target=document.getElementById(item.journal?'journalButton':'calendarButton');if(target){event.preventDefault();target.click();}});
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
  const brand=document.querySelector('.app-header .gym-identity, .topbar .brand');
  if(brand&&!brand.querySelector('.mobile-brand-logo')) {
    const logo=document.createElement('img');logo.className='mobile-brand-logo';logo.src=base+'images/boxing-logo.png';logo.alt='';logo.width=48;logo.height=48;
    brand.classList.add('has-mobile-logo');brand.prepend(logo);
  }
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
