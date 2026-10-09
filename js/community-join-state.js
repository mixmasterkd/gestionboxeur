const STORAGE_KEY = 'gestionboxeur:pending-group-join';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function validGroupJoinToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

export function rememberGroupJoinToken(token, view = window) {
  const valid = validGroupJoinToken(token);
  if (!valid) return false;
  try { view.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: valid, savedAt: Date.now() })); return true; }
  catch { return false; }
}

export function pendingGroupJoinToken(view = window) {
  try {
    const value = JSON.parse(view.sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (validGroupJoinToken(value?.token) && Number.isFinite(value.savedAt) && value.savedAt <= Date.now() && Date.now() - value.savedAt <= MAX_AGE) return value.token;
    view.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* The URL remains available when per-tab storage is blocked. */ }
  return null;
}

/** Keep only an opaque group token, never a caller-provided redirect URL. */
export function captureGroupJoinToken(view = window) {
  const url = new URL(view.location.href);
  if (!url.searchParams.has('join')) return pendingGroupJoinToken(view);
  const token = validGroupJoinToken(url.searchParams.get('join'));
  if (!token) {
    clearGroupJoinToken(undefined, view);
    url.searchParams.delete('join'); view.history.replaceState(view.history.state, '', url);
    return 'invalid';
  }
  if (rememberGroupJoinToken(token, view)) {
    url.searchParams.delete('join'); view.history.replaceState(view.history.state, '', url);
  }
  return token;
}

export function clearGroupJoinToken(token, view = window) {
  const expected = validGroupJoinToken(token);
  try {
    if (token === undefined || pendingGroupJoinToken(view) === expected) view.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Removal is best effort when storage is blocked. */ }
  const url = new URL(view.location.href);
  if (url.searchParams.has('join') && (token === undefined || validGroupJoinToken(url.searchParams.get('join')) === expected)) {
    url.searchParams.delete('join'); view.history.replaceState(view.history.state, '', url);
  }
}

export function groupJoinUrl(token, { login = false, signup = false, view = window } = {}) {
  const valid = validGroupJoinToken(token);
  if (!valid) throw new Error('Lien d’invitation invalide ou expiré.');
  const url = new URL(login ? './login.html' : './groups.html', view.location.href);
  url.searchParams.set('join', valid);
  if (login && signup) url.searchParams.set('mode', 'signup');
  return url.href;
}
