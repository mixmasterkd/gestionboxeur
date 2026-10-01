const mounts = new WeakMap();

/** Browser instructions only: installation does not add an offline mode. */
export function appInstallInstructions(navigator = {}) {
  const agent = String(navigator.userAgent || '');
  const appleMobile = /iPhone|iPad|iPod/i.test(agent) || (/Mac/i.test(String(navigator.platform || '')) && Number(navigator.maxTouchPoints) > 1);
  if (appleMobile) return {
    platform: 'ios', title: 'Sur iPhone ou iPad',
    steps: [
      'Ouvre cette page dans Safari.',
      'Touche Partager : le carré avec une flèche vers le haut. Ce bouton peut se trouver dans le menu du navigateur.',
      'Choisis « Sur l’écran d’accueil » ou « Ajouter à l’écran d’accueil ». Si « Ouvrir comme app web » est proposé, laisse cette option activée.',
      'Confirme avec « Ajouter ».',
    ],
  };
  if (/Android/i.test(agent)) return {
    platform: 'android', title: 'Sur Android',
    steps: [
      'Ouvre le menu ⋮ de ton navigateur.',
      'Cherche « Installer l’application », « Installer et créer un raccourci » ou « Ajouter à l’écran d’accueil ».',
      'Choisis « Installer » si cette option est proposée, puis confirme.',
    ],
    hint: 'Si l’option est absente, ouvre cette page directement dans Chrome, hors d’une application de messagerie.',
  };
  const safariMac = /Mac/i.test(agent) && /Safari/i.test(agent) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(agent);
  if (safariMac) return {
    platform: 'mac-safari', title: 'Dans Safari sur Mac',
    steps: [
      'Ouvre le menu « Fichier » de Safari, ou le bouton Partager.',
      'Choisis « Ajouter au Dock » si cette option est disponible.',
      'Confirme avec « Ajouter ».',
    ],
  };
  return {
    platform: 'desktop', title: 'Sur ordinateur',
    steps: [
      'Ouvre le menu de ton navigateur (⋮ ou …).',
      'Cherche « Installer GBoxeur », « Installer la page en tant qu’application » ou la rubrique « Applications ».',
      'Confirme l’installation. Une icône d’installation peut aussi apparaître dans la barre d’adresse.',
    ],
    hint: 'Si ton navigateur ne propose pas cette option, tu peux continuer à utiliser GBoxeur directement sur le site.',
  };
}

/** Mounts only at an explicitly provided #appInstallMount; never a floating banner. */
export function mountAppInstall({ doc = globalThis.document, view = doc?.defaultView || globalThis.window } = {}) {
  const host = doc?.getElementById('appInstallMount');
  if (!host || !view) return null;
  if (mounts.has(host)) return mounts.get(host);
  let disposed = false, installedEvent = false, pending = false, installPrompt = null, returnFocus = null;
  const media = ['standalone', 'minimal-ui', 'window-controls-overlay'].flatMap(mode => {
    try { const query = view.matchMedia?.(`(display-mode: ${mode})`); return query ? [query] : []; }
    catch { return []; }
  });
  const installed = () => installedEvent || view.navigator?.standalone === true || media.some(query => query.matches);
  const button = doc.createElement('button');
  button.id = 'appInstallButton'; button.type = 'button'; button.className = 'button secondary app-install-button';
  button.textContent = 'Installer GBoxeur'; button.setAttribute('aria-haspopup', 'dialog');
  const dialog = doc.createElement('dialog');
  dialog.id = 'appInstallDialog'; dialog.className = 'app-install-dialog';
  dialog.setAttribute('aria-labelledby', 'appInstallTitle'); dialog.setAttribute('aria-describedby', 'appInstallDescription');
  dialog.innerHTML = `
    <header class="app-install-heading"><h2 id="appInstallTitle">Installer GBoxeur</h2><button type="button" class="app-install-close" aria-label="Fermer">×</button></header>
    <p id="appInstallDescription">Ajoute GBoxeur à l’écran d’accueil ou aux applications de cet appareil.</p>
    <p id="appInstallNotice" class="app-install-notice" role="status" hidden></p>
    <h3 id="appInstallPlatform"></h3><ol id="appInstallSteps"></ol>
    <p id="appInstallHint" class="app-install-hint" hidden></p>
    <p class="app-install-online">Les options varient selon le navigateur. Une connexion Internet reste nécessaire.</p>
    <footer><button type="button" class="button secondary app-install-done">Fermer</button></footer>`;
  const backdrop = doc.createElement('div'); backdrop.className = 'app-install-backdrop'; backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true');
  const $ = id => dialog.querySelector(`#${id}`);
  host.append(button); (doc.body || doc.documentElement).append(backdrop, dialog);

  function finishClose() {
    backdrop.hidden = true;
    const previous = returnFocus; returnFocus = null;
    if (!disposed && !installed() && previous?.isConnected && !host.hidden) previous.focus({ preventScroll: true });
  }
  function closeDialog({ restore = true } = {}) {
    if (!restore) returnFocus = null;
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    finishClose();
  }
  function instructions(notice = '') {
    if (disposed || installed() || !host.isConnected) return;
    const content = appInstallInstructions(view.navigator);
    dialog.dataset.platform = content.platform;
    $('appInstallPlatform').textContent = content.title;
    $('appInstallSteps').replaceChildren(...content.steps.map(text => { const item = doc.createElement('li'); item.textContent = text; return item; }));
    $('appInstallHint').textContent = content.hint || ''; $('appInstallHint').hidden = !content.hint;
    $('appInstallNotice').textContent = notice; $('appInstallNotice').hidden = !notice;
    if (!dialog.open) {
      returnFocus = doc.activeElement?.isConnected ? doc.activeElement : button;
      // Programmatic clicks need the same dependable return target as pointer clicks.
      if (returnFocus === doc.body || returnFocus === doc.documentElement) returnFocus = button;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.dataset.fallback = 'true'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('open', ''); backdrop.hidden = false;
      }
    }
    dialog.querySelector('.app-install-close').focus({ preventScroll: true });
  }
  function sync() {
    if (disposed) return;
    host.hidden = installed(); button.disabled = pending;
    if (host.hidden) { installPrompt = null; closeDialog({ restore: false }); }
  }
  function beforeInstall(event) {
    if (disposed || installed() || !host.isConnected || typeof event.prompt !== 'function') return;
    event.preventDefault(); installPrompt = event;
  }
  function appInstalled() { installedEvent = true; sync(); }
  async function install() {
    if (disposed || pending || installed()) return;
    if (!installPrompt) { instructions(); return; }
    const prompt = installPrompt; installPrompt = null; pending = true; sync();
    try {
      // Must happen inside the click's user activation, not after any await.
      const result = await prompt.prompt();
      if (!result?.outcome && prompt.userChoice) await prompt.userChoice;
      // Acceptance alone is not proof installation finished; appinstalled owns that state.
    } catch {
      if (!disposed && !installed()) instructions('L’invite automatique n’est pas disponible. Utilise le menu de ton navigateur.');
    } finally { pending = false; sync(); }
  }
  function onKey(event) {
    if (!dialog.open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter(node => !node.hidden);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
  }
  const onCancel = event => { event.preventDefault(); closeDialog(); };
  const onCloseClick = () => closeDialog();
  button.addEventListener('click', install);
  dialog.querySelector('.app-install-close').addEventListener('click', onCloseClick);
  dialog.querySelector('.app-install-done').addEventListener('click', onCloseClick);
  dialog.addEventListener('cancel', onCancel); dialog.addEventListener('close', finishClose);
  backdrop.addEventListener('click', onCloseClick);
  doc.addEventListener('keydown', onKey);
  view.addEventListener('beforeinstallprompt', beforeInstall);
  view.addEventListener('appinstalled', appInstalled);
  view.addEventListener('pageshow', sync);
  for (const query of media) {
    if (query.addEventListener) query.addEventListener('change', sync);
    else query.addListener?.(sync);
  }
  sync();
  const controller = {
    destroy() {
      if (disposed) return;
      disposed = true; installPrompt = null; closeDialog({ restore: false });
      view.removeEventListener('beforeinstallprompt', beforeInstall); view.removeEventListener('appinstalled', appInstalled); view.removeEventListener('pageshow', sync);
      doc.removeEventListener('keydown', onKey);
      for (const query of media) {
        if (query.removeEventListener) query.removeEventListener('change', sync);
        else query.removeListener?.(sync);
      }
      button.removeEventListener('click', install); button.remove(); dialog.remove(); backdrop.remove(); mounts.delete(host);
    },
  };
  mounts.set(host, controller); return controller;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAppInstall(), { once: true });
  else mountAppInstall();
}
