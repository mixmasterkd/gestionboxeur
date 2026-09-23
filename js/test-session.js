import { client, createTestClient, isTestSession, TEST_MODE_KEY, TEST_SESSION_KEY, TEST_STORAGE_POINTER } from './config.js';

const appLocation = path => new URL(`${/\/admin\/(?:index\.html)?$/.test(location.pathname) ? '../' : './'}${path}`, location.href).href;

export async function beginTestSession(credentials, adminId, stillAuthorized = () => true) {
  if (!credentials?.token_hash || !credentials?.user_id || !adminId) throw new Error('La session athlète de test n’a pas pu être préparée.');
  const testClient = createTestClient({ fresh: true });
  const { data, error } = await testClient.auth.verifyOtp({ token_hash: credentials.token_hash, type: 'magiclink' });
  if (error) {
    sessionStorage.removeItem(TEST_SESSION_KEY);
    sessionStorage.removeItem(TEST_STORAGE_POINTER);
    throw error;
  }
  if (!stillAuthorized() || !data.session || data.user?.id !== credentials.user_id || data.user?.app_metadata?.test_admin_id !== adminId) {
    try { await testClient.auth.signOut({ scope: 'local' }); } finally {
      sessionStorage.removeItem(TEST_SESSION_KEY);
      sessionStorage.removeItem(TEST_STORAGE_POINTER);
    }
    throw new Error('La session de test n’est plus autorisée. Reconnecte-toi à ton compte administrateur.');
  }
  sessionStorage.setItem(TEST_MODE_KEY, JSON.stringify({ userId: data.user.id, adminId }));
  // The regular administrator session stays untouched in localStorage. Only this tab changes.
  location.replace(appLocation('planning.html'));
}

export async function returnFromTestSession() {
  if (!isTestSession()) return;
  // Clear only this tab's test credentials. A SIGNED_OUT event would race the
  // page's regular logout redirect; the administrator session is never touched.
  client.auth.stopAutoRefresh();
  sessionStorage.removeItem(TEST_MODE_KEY);
  sessionStorage.removeItem(TEST_SESSION_KEY);
  sessionStorage.removeItem(TEST_STORAGE_POINTER);
  location.replace(appLocation('admin/'));
}

export function mountTestSessionBanner() {
  if (!isTestSession() || document.getElementById('testSessionBanner')) return;
  const banner = document.createElement('aside');
  banner.id = 'testSessionBanner'; banner.className = 'test-session-banner'; banner.setAttribute('aria-label', 'Session athlète de test');
  const text = document.createElement('span');
  text.textContent = 'Athlète de test · Tu utilises les permissions réelles d’un athlète.';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'button button-dark'; button.textContent = 'Revenir à mon administration';
  button.addEventListener('click', () => { button.disabled = true; returnFromTestSession(); });
  banner.append(text, button); document.body.prepend(banner);
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      sessionStorage.removeItem(TEST_MODE_KEY);
      sessionStorage.removeItem(TEST_SESSION_KEY);
      sessionStorage.removeItem(TEST_STORAGE_POINTER);
    }
  });
}
