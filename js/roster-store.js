/** Personal athlete-list persistence for the existing owner schema and the training-platform schema.
 * Legacy access is enabled only after both missing-schema facts are established.
 * Authorization, transport and RPC errors never select another persistence path.
 */
export const ROSTER_FIELDS = 'id,first_name,last_name,birth_date,sex,weight_kg,fights,wins,losses,status,updated_at';
const PROFILE_FIELDS = 'id,full_name,phone,is_admin';
const LEGACY_FIELDS = `${ROSTER_FIELDS},coach_id,notes,selected`;

function missingAccountType(error) {
  const message = String(error?.message || '');
  return (error?.code === '42703' && /\bcolumn (?:(?:"?public"?\.)?"?profiles"?\.)?"?account_type"? does not exist\b/i.test(message))
    || (error?.code === 'PGRST204' && /could not find the ['"]account_type['"] column of ['"]profiles['"] in the schema cache/i.test(message));
}
function missingRelations(error) {
  const message = String(error?.message || '');
  return (error?.code === '42P01' && /\brelation ['"](?:public\.)?coach_athletes['"] does not exist\b/i.test(message))
    || (error?.code === 'PGRST205' && /could not find the table ['"](?:public\.)?coach_athletes['"] in the schema cache/i.test(message));
}
async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
function legacyPayload(payload) {
  const { private_notes, ...fields } = payload;
  if (Object.hasOwn(payload, 'private_notes')) fields.notes = private_notes || null;
  return fields;
}
export function createRosterStore(client) {
  let mode = 'unknown';
  let owner = null;
  let accountType = null;
  let loadTicket = 0;
  function requireAccount() {
    if (!owner || !['coach', 'athlete'].includes(accountType) || mode === 'unknown') throw new Error('Charge ton compte avant de modifier ta liste d’athlètes.');
  }
  return {
    get mode() { return mode; },
    reset() { loadTicket++; mode = 'unknown'; owner = null; accountType = null; },
    async loadProfile(userId) {
      const ticket = ++loadTicket;
      let detectedMode = 'modern';
      mode = 'unknown'; owner = null; accountType = null;
      let response = await client.from('profiles').select(`${PROFILE_FIELDS},account_type`).eq('id', userId).single();
      if (response.error) {
        if (!missingAccountType(response.error)) throw response.error;
        // A missing profile column alone does not prove the old privacy model is active.
        const relationProbe = await client.from('coach_athletes').select('athlete_id').eq('coach_id', userId).limit(1);
        if (!missingRelations(relationProbe.error)) {
          if (relationProbe.error) throw relationProbe.error;
          throw new Error('Le schéma du profil et celui des relations ne correspondent pas. Actualise les migrations avant de modifier l’effectif.');
        }
        response = await client.from('profiles').select(PROFILE_FIELDS).eq('id', userId).single();
        if (response.error) throw response.error;
        detectedMode = 'legacy';
        response = { data: { ...response.data, account_type: 'coach' } };
      }
      if (ticket !== loadTicket) throw new Error('La session a changé. Recharge ton compte avant de continuer.');
      mode = detectedMode;
      owner = userId;
      accountType = response.data.account_type;
      return response.data;
    },
    async loadAthletes() {
      requireAccount();
      const userId = owner, ticket = loadTicket;
      const assertCurrent = () => { if (owner !== userId || ticket !== loadTicket) throw new Error('La session a changé. Recharge ta liste.'); };
      if (mode === 'legacy') {
        const rows = await checked(client.from('athletes').select(LEGACY_FIELDS).eq('coach_id', userId).order('last_name'));
        assertCurrent();
        return rows.map(row => ({ row, relation: { private_notes: row.notes || '', selected: row.selected } }));
      }
      // RLS also exposes personally visible/group-related athletes; the owner's
      // accepted list relations define this directory, never every visible row.
      const rows = await checked(client.from('coach_athletes').select('athlete_id,private_notes,selected,can_view_calendar,updated_at').eq('coach_id', userId).eq('status', 'accepted'));
      assertCurrent();
      const relations = new Map(rows.map(row => [row.athlete_id, row]));
      if (!relations.size) return [];
      const athletes = await checked(client.from('athletes').select(`${ROSTER_FIELDS},user_id`).in('id', [...relations.keys()]).order('last_name'));
      assertCurrent();
      return athletes.filter(row => relations.has(row.id)).map(row => ({ row, relation: relations.get(row.id) }));
    },
    async saveAthlete(id, payload, snapshot) {
      requireAccount();
      if (mode === 'modern') {
        if (id && (!snapshot?.updatedAt || !snapshot?.relationUpdatedAt)) throw new Error('Recharge la fiche avant de l’enregistrer.');
        return checked(id
          ? client.rpc('update_roster_athlete_checked', { p_athlete_id: id, p_data: payload, p_expected_user_id: owner, p_updated_at: snapshot.updatedAt, p_relation_updated_at: snapshot.relationUpdatedAt })
          : client.rpc('create_roster_athlete', { p_data: payload }));
      }
      const data = legacyPayload(payload);
      return checked(id
        ? client.from('athletes').update(data).eq('id', id).eq('coach_id', owner).select('id').single()
        : client.from('athletes').insert({ ...data, coach_id: owner }).select('id').single());
    },
    async removeAthlete(id) {
      requireAccount();
      if (mode === 'modern') return checked(client.rpc('archive_roster_athlete', { p_athlete_id: id }));
      return checked(client.from('athletes').delete().eq('id', id).eq('coach_id', owner).select('id').single());
    },
    async mergeAthletes(source, target, choices) {
      requireAccount();
      if (accountType !== 'coach') throw new Error('Le rattachement nécessite un lien de coaching déjà établi.');
      if (mode !== 'modern') throw new Error('Le rattachement nécessite la mise à jour de la base de données.');
      if (!source?.id || !target?.id || source.id === target.id || source.userId || !target.userId) {
        throw new Error('Choisis une fiche libre et le compte inscrit de la même personne.');
      }
      if (![source.updatedAt, target.updatedAt, source.relationUpdatedAt, target.relationUpdatedAt].every(Boolean)) {
        throw new Error('Recharge les fiches avant de confirmer le rattachement.');
      }
      if (!choices || Object.keys(choices).length !== 2 || !['source', 'target'].includes(choices.weight) || !['source', 'target'].includes(choices.record)) {
        throw new Error('Choisis le poids et le bilan de combats à conserver.');
      }
      try {
        return await checked(client.rpc('merge_roster_athlete', {
          p_source_id: source.id, p_target_id: target.id,
          p_source_updated_at: source.updatedAt, p_target_updated_at: target.updatedAt,
          p_source_relation_updated_at: source.relationUpdatedAt,
          p_target_relation_updated_at: target.relationUpdatedAt,
          p_choices: { weight: choices.weight, record: choices.record },
        }));
      } catch (error) {
        if (['PGRST202', '42883'].includes(error?.code)) throw new Error('Le rattachement nécessite la mise à jour de la base de données.');
        throw error;
      }
    },
  };
}
