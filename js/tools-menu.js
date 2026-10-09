import { createMenuPanelLayout } from './menu-panel-layout.js';
import { TOOL_MENU_ITEMS } from './tool-catalog.js';
import { el } from './ui.js';
import '../css/tools-menu.css';
import '../css/menu-panels.css';

/** Compact, nonmodal access to each tool from any authenticated page. */
export function mountToolsMenu({ trigger, route }) {
  const doc = trigger.ownerDocument, view = doc.defaultView;
  const onToolsPage = view.location.pathname.endsWith('/tools.html');
  const params = new URLSearchParams(view.location.search);
  let selected = onToolsPage ? { tool: params.get('tool'), game: params.get('game') } : null;
  let destroyed = false;
  const dialog = el('dialog', { id: 'toolsMenuDialog', class: 'tools-menu-dialog', 'aria-labelledby': 'toolsMenuTitle', 'aria-modal': 'false' });
  const list = el('nav', { class: 'tools-menu-list', 'aria-label': 'Choisir un outil' });
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', dialog.id);
  trigger.setAttribute('aria-label', 'Outils');

  const plainClick = event => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  function updateOpenState() {
    if (!dialog.open) layout.close();
    trigger.setAttribute('aria-expanded', String(dialog.open));
    trigger.classList.toggle('is-open', dialog.open);
    trigger.title = dialog.open ? 'Fermer les outils' : 'Ouvrir les outils';
  }
  function updateSelection() {
    for (const item of TOOL_MENU_ITEMS) {
      const link = list.querySelector(`[data-tool-menu-item="${item.id}"]`);
      const active = selected?.tool === item.tool && (selected?.game || null) === (item.game || null);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  const layout = createMenuPanelLayout({ dialog, trigger, onDismiss: () => close() });
  const position = () => layout.position();
  function close({ restoreFocus = true } = {}) {
    layout.close();
    if (!dialog.open) return;
    dialog.close(); updateOpenState();
    if (restoreFocus && !destroyed && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function open() {
    if (destroyed) return;
    if (!dialog.open) dialog.show();
    updateOpenState(); position();
    dialog.querySelector('h2').focus({ preventScroll: true });
  }
  let gamesLabelAdded = false;
  for (const item of TOOL_MENU_ITEMS) {
    if (item.game && !gamesLabelAdded) {
      gamesLabelAdded = true;
      list.append(el('p', { class: 'tools-menu-section' }, 'Jeux cognitifs'));
    }
    const query = new URLSearchParams({ tool: item.tool });
    if (item.game) query.set('game', item.game);
    const link = el('a', { class: 'tools-menu-item', href: route(`tools.html?${query}`), dataset: { toolMenuItem: item.id } });
    const mark = el('span', { class: 'tools-menu-icon', 'aria-hidden': 'true' });
    mark.innerHTML = item.icon;
    link.append(mark, el('span', {}, item.title));
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      if (onToolsPage) {
        event.preventDefault(); close();
        view.dispatchEvent(new view.CustomEvent('tools:navigate', { detail: { tool: item.tool, ...(item.game ? { game: item.game } : {}) } }));
      } else close({ restoreFocus: false });
    });
    list.append(link);
  }
  dialog.append(el('header', { class: 'tools-menu-heading' }, el('h2', { id: 'toolsMenuTitle', tabindex: '-1' }, 'Outils')), list);
  doc.body.append(dialog); updateSelection(); updateOpenState();
  const toggle = () => { if (dialog.open) close(); else open(); };
  const onOutside = event => { if (dialog.open && !dialog.contains(event.target) && !trigger.contains(event.target) && !event.target.closest?.('.menu-drawer-dismiss')) close({ restoreFocus: false }); };
  const onKey = event => {
    if (!dialog.open || event.defaultPrevented || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  const onSelection = event => { selected = event.detail || null; updateSelection(); };
  const onScroll = event => { if (!dialog.contains(event.target)) position(); };
  trigger.addEventListener('click', toggle);
  dialog.addEventListener('close', updateOpenState);
  doc.addEventListener('pointerdown', onOutside); doc.addEventListener('focusin', onOutside);
  doc.addEventListener('keydown', onKey); doc.addEventListener('scroll', onScroll, true);
  view.addEventListener('resize', position); view.addEventListener('tools:selection', onSelection);
  view.visualViewport?.addEventListener('resize', position); view.visualViewport?.addEventListener('scroll', position);
  return {
    open, close,
    destroy() {
      destroyed = true; close({ restoreFocus: false });
      trigger.removeEventListener('click', toggle); dialog.removeEventListener('close', updateOpenState);
      doc.removeEventListener('pointerdown', onOutside); doc.removeEventListener('focusin', onOutside);
      doc.removeEventListener('keydown', onKey); doc.removeEventListener('scroll', onScroll, true);
      view.removeEventListener('resize', position); view.removeEventListener('tools:selection', onSelection);
      view.visualViewport?.removeEventListener('resize', position); view.visualViewport?.removeEventListener('scroll', position);
      layout.destroy(); dialog.remove();
    },
  };
}
