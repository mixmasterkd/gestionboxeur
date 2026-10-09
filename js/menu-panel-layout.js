const drawerOwners = new WeakMap();
const ignoredTags = new Set(['DIALOG', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
const layoutProperties = ['width', 'height', 'max-height', 'left', 'right', 'top', 'bottom'];

/** Shared geometry and reversible page displacement for navigation and calendar menus. */
export function createMenuPanelLayout({ dialog, trigger, onDismiss, placement = 'navigation' }) {
  const doc = dialog.ownerDocument, view = doc.defaultView, body = doc.body;
  const originalStyles = new Map(layoutProperties.map(name => [name, {
    value: dialog.style.getPropertyValue(name), priority: dialog.style.getPropertyPriority(name),
  }]));
  const shifted = new Set();
  let destroyed = false, drawer = false, dismiss = null, previousBodyClass = false;
  let previousWidth = '', previousPriority = '', appliedWidth = '';

  function restoreProperty(style, name, value, priority = '') {
    if (value) style.setProperty(name, value, priority); else style.removeProperty(name);
  }
  function clearDrawer() {
    if (!drawer) return;
    drawer = false;
    dismiss?.remove(); dismiss = null;
    for (const node of shifted) node.classList.remove('menu-drawer-shift');
    shifted.clear();
    if (!previousBodyClass) body.classList.remove('menu-drawer-open');
    if (body.style.getPropertyValue('--menu-drawer-width') === appliedWidth) {
      restoreProperty(body.style, '--menu-drawer-width', previousWidth, previousPriority);
    }
    if (drawerOwners.get(doc) === clearDrawer) drawerOwners.delete(doc);
  }
  function visiblePageChild(node) {
    if (ignoredTags.has(node.tagName) || node.hidden || node.matches('.menu-drawer-dismiss,.toast,.app-toast,.skip-link')) return false;
    const computed = view.getComputedStyle(node);
    return computed.display !== 'none' && computed.visibility !== 'hidden' && computed.visibility !== 'collapse';
  }
  function updatePageShift() {
    const visible = new Set([...body.children].filter(visiblePageChild));
    for (const node of shifted) {
      if (!visible.has(node)) { node.classList.remove('menu-drawer-shift'); shifted.delete(node); }
    }
    for (const node of visible) {
      if (!node.classList.contains('menu-drawer-shift')) {
        node.classList.add('menu-drawer-shift'); shifted.add(node);
      }
    }
  }
  function enableDrawer(panelWidth) {
    if (!drawer) {
      // A second menu can position itself before the first menu's close event.
      // Release that layout first so its eventual cleanup cannot undo this one.
      drawerOwners.get(doc)?.();
      previousBodyClass = body.classList.contains('menu-drawer-open');
      previousWidth = body.style.getPropertyValue('--menu-drawer-width');
      previousPriority = body.style.getPropertyPriority('--menu-drawer-width');
      drawer = true; drawerOwners.set(doc, clearDrawer);
      dismiss = doc.createElement('button');
      dismiss.type = 'button'; dismiss.className = 'menu-drawer-dismiss';
      dismiss.setAttribute('aria-label', 'Fermer le menu');
      dismiss.setAttribute('aria-controls', dialog.id);
      dismiss.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
      dismiss.addEventListener('focusin', event => event.stopPropagation());
      dismiss.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (drawer && !destroyed && event.currentTarget === dismiss) onDismiss();
      });
      body.append(dismiss);
    }
    appliedWidth = `${panelWidth}px`;
    body.style.setProperty('--menu-drawer-width', appliedWidth);
    body.classList.add('menu-drawer-open');
    updatePageShift();
  }
  function position() {
    if (destroyed) return;
    if (!dialog.open) { close(); return; }
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || view.innerWidth, height = viewport?.height || view.innerHeight;
    dialog.style.right = 'auto'; dialog.style.bottom = 'auto';
    if (view.innerWidth <= 800) {
      const strip = Math.max(28, Math.min(48, width * .08));
      const panelWidth = Math.max(0, width - strip);
      dialog.style.width = `${panelWidth}px`;
      dialog.style.height = `${height}px`;
      dialog.style.height = '100dvh'; dialog.style.maxHeight = `${height}px`;
      dialog.style.left = '0px'; dialog.style.top = '0px';
      enableDrawer(panelWidth);
      return;
    }
    clearDrawer();
    const right = left + width, bottom = top + height, margin = 8, gap = 8;
    const panelWidth = Math.min(320, Math.max(0, width - margin * 2));
    const anchor = trigger.getBoundingClientRect();
    const nav = doc.getElementById('primaryNavigation')?.getBoundingClientRect();
    dialog.style.width = `${panelWidth}px`; dialog.style.height = 'auto';
    dialog.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
    const panel = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(left + margin, Math.min(placement === 'below-trigger' ? anchor.left : (nav?.right ?? anchor.right) + gap, right - panelWidth - margin))}px`;
    dialog.style.top = `${Math.max(top + margin, Math.min(placement === 'below-trigger' ? anchor.bottom + gap : anchor.top, bottom - panel.height - margin))}px`;
  }
  function close() {
    clearDrawer();
    for (const [name, saved] of originalStyles) restoreProperty(dialog.style, name, saved.value, saved.priority);
  }
  return {
    position, close,
    destroy() { if (!destroyed) { close(); destroyed = true; } },
  };
}
