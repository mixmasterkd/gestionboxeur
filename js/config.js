import { createClient } from '@supabase/supabase-js';

// Public project credentials. Security is enforced by PostgreSQL permissions and RLS.
const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL || 'https://opxsaykcofzbufzzzqwz.supabase.co';
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY || 'sb_publishable_5iSjD5Zi9-eSGtX0f2oL4w_N-NdZKcZ';
export const TEST_MODE_KEY = 'gestionboxeur-test-mode';
export const TEST_STORAGE_POINTER = 'gestionboxeur-test-storage';
const tabStorage = typeof sessionStorage === 'undefined' ? null : sessionStorage;
export let TEST_SESSION_KEY = tabStorage?.getItem(TEST_STORAGE_POINTER) || 'gestionboxeur-athlete-test';
export const createTestClient = ({ fresh = false } = {}) => {
  if (fresh || !tabStorage?.getItem(TEST_STORAGE_POINTER)) {
    tabStorage?.removeItem(TEST_SESSION_KEY);
    TEST_SESSION_KEY = `gestionboxeur-athlete-test-${crypto.randomUUID()}`;
    tabStorage?.setItem(TEST_STORAGE_POINTER, TEST_SESSION_KEY);
  }
  return createClient(url, key, {
    auth: { storage: tabStorage, storageKey: TEST_SESSION_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
};
export const isTestSession = () => Boolean(tabStorage?.getItem(TEST_MODE_KEY));
export const client = isTestSession() ? createTestClient() : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
