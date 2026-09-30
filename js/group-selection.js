import { el, input, displayName } from './ui.js';

export function planningAthletes(state) {
  return (state.athletes || []).filter(athlete => athlete.user_id && (athlete.user_id === state.user?.id || (state.relations || []).some(relation => relation.athlete_id === athlete.id && relation.status === 'accepted' && relation.can_view_calendar && relation.can_add_sessions)));
}

/** A shared selector for group membership and session recipients. */
export function createRecipientPicker({ athletes = [], groups = [], athleteIds = [], groupIds = [], allowGroups = true, legend = 'Destinataires', onChange = () => {} } = {}) {
  const selectedAthletes = new Set(athleteIds), selectedGroups = new Set(allowGroups ? groupIds : []);
  const root = el('fieldset', { class: 'recipient-picker' }, el('legend', {}, legend));
  const summary = el('span', { class: 'recipient-summary', role: 'status' });
  const search = input('recipient_search', '', 'search', { placeholder: 'Rechercher…', 'aria-label': 'Rechercher dans les destinataires', autocomplete: 'off' });
  const list = el('div', { class: 'recipient-options' });
  const details = el('details', { class: 'recipient-details' }, el('summary', {}, summary, el('span', { class: 'muted' }, 'Choisir')), el('div', { class: 'recipient-menu' }, search, list));
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
  function value() { return { athlete_ids: [...selectedAthletes], group_ids: [...selectedGroups] }; }
  function update() {
    const people = new Set(selectedAthletes);
    for (const group of groups) if (selectedGroups.has(group.id)) for (const id of group.athlete_ids || []) people.add(id);
    const names = [...groups.filter(g => selectedGroups.has(g.id)).map(g => g.name), ...athletes.filter(a => selectedAthletes.has(a.id)).map(displayName)];
    summary.textContent = names.length ? `${names.join(', ')} · ${people.size} personne${people.size > 1 ? 's' : ''}` : 'Choisir les destinataires';
    onChange(value());
  }
  function render() {
    list.replaceChildren();
    const query = normalize(search.value.trim());
    const addSection = (label, items, selected, group) => {
      const filtered = items.filter(item => normalize(group ? item.name : displayName(item)).includes(query));
      if (!filtered.length) return;
      list.append(el('p', { class: 'recipient-section' }, label));
      for (const item of filtered) {
        const checkbox = input(group ? 'recipient_group' : 'recipient_athlete', item.id, 'checkbox', { checked: selected.has(item.id) });
        checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(item.id) : selected.delete(item.id); update(); });
        const text = group ? item.name : displayName(item);
        list.append(el('label', { class: 'recipient-option' }, checkbox, el('span', {}, text), group ? el('small', {}, `${(item.athlete_ids || []).length} membre${(item.athlete_ids || []).length > 1 ? 's' : ''}`) : item.planning_unavailable ? el('small', {}, 'Accès retiré') : null));
      }
    };
    if (allowGroups) addSection('Groupes', groups, selectedGroups, true);
    addSection('Athlètes', athletes, selectedAthletes, false);
    if (!list.children.length) list.append(el('p', { class: 'muted' }, 'Aucun résultat.'));
  }
  search.addEventListener('input', render);
  root.append(details); render(); update();
  return { root, value, open: () => { details.open = true; } };
}
