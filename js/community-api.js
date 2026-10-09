import { client, rpc } from './data.js';
import { createGroupListCache } from './community-group-cache.js';

const readActions = new Set(['list_groups', 'group_detail', 'group_calendar', 'notifications', 'invite_candidates', 'inspect_join_link']);
const groupListChanges = new Set(['save_group', 'invite_member', 'invite_members', 'accept_join_link', 'respond_invitation', 'set_role', 'remove_member', 'leave_group', 'transfer_group', 'delete_group']);
const groups = createGroupListCache({
  getAccountId: async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session?.user?.id || null;
  },
  fetchGroups: () => command('list_groups'),
});
client.auth.onAuthStateChange((_event, session) => groups.setAccount(session?.user?.id || null));

/** All group access is checked in the database for the signed-in account. */
export async function command(action, data = {}) {
  const revision = groups.accountRevision;
  const value = await rpc('community_command', { p_action: action, p_data: data });
  if (!readActions.has(action)) {
    if (revision !== groups.accountRevision) throw new Error('Le compte a changé. Recharge la page.');
    if (groupListChanges.has(action)) groups.invalidate();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('community-changed', { detail: { action, groupId: data.group_id || value?.group_id || value?.id || null } }));
  }
  return value;
}

export const loadGroups = options => groups.load(options);
export const loadGroup = id => command('group_detail', { group_id: id });
export const loadNotifications = () => command('notifications');
