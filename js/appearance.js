const storageKey = 'gestionboxeur:appearance';
const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
const moon = '<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/>';
let current = 'dark';
let toggle;
try { if (localStorage.getItem(storageKey) === 'light') current = 'light'; } catch { /* Private browsing can block storage. */ }
function apply(value) {
  current = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current === 'light' ? '#f4f5f7' : '#181b20');
  if (!toggle) return;
  const action = current === 'dark' ? 'Passer au mode clair' : 'Passer au mode sombre';
  toggle.setAttribute('aria-label', action);
  toggle.title = action;
  toggle.innerHTML = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${current === 'dark' ? sun : moon}</svg>`;
}
apply(current);
function mount() {
  if (document.getElementById('appearanceToggle')) return;
  toggle = document.createElement('button');
  toggle.id = 'appearanceToggle'; toggle.type = 'button'; toggle.className = 'appearance-toggle';
  const topbar = document.querySelector('.top-actions, .topbar-actions, .account-nav');
  if (topbar) topbar.prepend(toggle);
  else if (document.querySelector('.app-header, .topbar')) document.querySelector('.app-header, .topbar').append(toggle);
  else { const bar = document.createElement('div'); bar.className = 'auth-appearance'; bar.append(toggle); document.body.prepend(bar); }
  toggle.addEventListener('click', () => {
    apply(current === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem(storageKey, current); } catch { /* Switching still works without persistence. */ }
  });
  apply(current);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
window.addEventListener('storage', event => { if (event.key === storageKey || event.key === null) apply(event.newValue); });
