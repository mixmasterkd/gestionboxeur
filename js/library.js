import { SPORTS, summarizeBlocks, formatDuration, makeBlock } from './domain.js';
import { getStarterTemplates } from './starter-templates.js';
import { renderWorkout } from './editor.js';
import { $, el, button, heading, errorBox, showError, confirmAction, toast } from './ui.js';

const freshBlocks = blocks => (blocks || []).map(block => ({ ...structuredClone(block), id: makeBlock().id, children: freshBlocks(block.children) }));
const copyTemplate = template => ({ ...structuredClone(template), blocks: freshBlocks(template.blocks) });
const savedFields = (template, ownerId) => ({
  title: template.title, sport: template.sport, description: template.description || '', notes: template.notes || '',
  blocks: freshBlocks(template.blocks), kind: template.kind, coach_id: ownerId,
});
// Fresh block IDs differ on every copy; compare content to avoid identical kit copies.
const withoutIds = value => Array.isArray(value) ? value.map(withoutIds)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'id').sort().map(key => [key, withoutIds(value[key])])) : value;
const fingerprint = template => JSON.stringify(withoutIds({
  title: template.title, sport: template.sport, description: template.description || '', notes: template.notes || '',
  blocks: template.blocks || [], kind: template.kind,
}));

export function createLibraryUI({ getState, canAdd, onUseTemplate, api }) {
  let ticket = 0;
  const copiesByCoach = new Map(), pendingByCoach = new Map();
  let currentView = null;
  const getApi = () => api ? Promise.resolve(api) : import('./data.js');
  const activeView = ownerId => currentView?.ownerId === ownerId && currentView.active() ? currentView : null;

  async function open({ kind = null, onSelect = null } = {}) {
    const dialog = $('libraryDialog'), wrap = $('libraryContent'), errors = errorBox();
    const current = ++ticket, ownerId = getState().user?.id;
    const body = el('div', { class: 'dialog-body' });
    wrap.replaceChildren(heading(kind === 'block' ? 'Tes blocs réutilisables' : 'Ta bibliothèque', 'DES BASES À PERSONNALISER', dialog, 'libraryTitle'), body);
    if (!dialog.open) dialog.showModal();
    const authorized = () => Boolean(ownerId && getState().user?.id === ownerId && getState().profile?.account_type === 'coach');
    const active = () => current === ticket && dialog.open && wrap.contains(body) && authorized();
    if (!authorized()) { body.append(el('p', {}, 'La bibliothèque est réservée aux coachs.')); return; }

    let source = 'personal', filter = kind || 'all', templates = [], loading = true;
    const starter = getStarterTemplates(), statuses = new Map(), deletedIds = new Set();
    if (!copiesByCoach.has(ownerId)) copiesByCoach.set(ownerId, new Map());
    if (!pendingByCoach.has(ownerId)) pendingByCoach.set(ownerId, new Set());
    const copies = copiesByCoach.get(ownerId);
    const pending = pendingByCoach.get(ownerId);
    const search = el('input', { type: 'search', placeholder: 'Rechercher un modèle', 'aria-label': 'Rechercher un modèle' });
    const sources = el('div', { class: 'library-sources', role: 'group', 'aria-label': 'Source des modèles' });
    const tabs = el('div', { class: 'template-tabs', role: 'group', 'aria-label': 'Type de modèle' });
    const grid = el('div', { class: 'template-grid' });
    const notice = el('p', { class: 'library-notice muted', role: 'status' });
    body.append(el('p', { class: 'muted library-intro' }, 'Retrouve tes modèles ou pars d’une séance du kit. Chaque utilisation ouvre une copie que tu peux ajuster.'), errors,
      sources, el('div', { class: 'library-toolbar' }, search, tabs), notice, grid);

    const own = template => template.coach_id === ownerId;
    const existingCopy = template => templates.find(item => own(item) && fingerprint(item) === fingerprint(template));
    const redraw = () => {
      if (!active()) return;
      grid.replaceChildren();
      sources.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.source === source)));
      tabs.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.kind === filter)));
      notice.textContent = source === 'starter' ? 'Le kit de départ est disponible sans enregistrement. « Garder dans mes modèles » ajoute seulement le modèle choisi.' : 'Tes séances et tes blocs enregistrés restent privés à ton compte.';
      const items = source === 'starter' ? starter : templates.filter(own);
      const query = search.value.trim().toLocaleLowerCase('fr');
      const list = items.filter(template => (filter === 'all' || template.kind === filter) && `${template.title} ${template.description || ''}`.toLocaleLowerCase('fr').includes(query));
      if (!list.length) {
        const empty = source === 'personal' && loading ? 'Chargement de tes modèles…'
          : query ? 'Aucun modèle correspondant.' : source === 'starter' && filter === 'block' ? 'Le kit contient des séances complètes. Retrouve tes blocs enregistrés dans « Mes modèles ».'
            : source === 'personal' ? 'Ta bibliothèque est encore vide. Découvre le kit de départ ou enregistre une séance depuis sa fiche.' : 'Aucun modèle de ce type.';
        grid.append(el('p', { class: 'empty-message' }, empty)); return;
      }
      for (const template of list) {
        const isStarter = source === 'starter';
        const sport = SPORTS.find(item => item.id === template.sport) || SPORTS.at(-1), summary = summarizeBlocks(template.blocks || []);
        const card = el('article', { class: 'template-card', dataset: { source, templateId: template.id } },
          el('p', { class: 'eyebrow template-source' }, `${template.kind === 'block' ? 'BLOC' : 'SÉANCE'} · ${sport.label.toUpperCase()}`),
          el('h3', {}, template.title), el('p', {}, [summary.hasTime ? formatDuration(summary.duration_seconds) : '', summary.hasDistance ? `${summary.distance_m / 1000} km` : '', `${(template.blocks || []).length} bloc(s)`].filter(Boolean).join(' · ')));
        const preview = el('details', {}, el('summary', {}, 'Aperçu du contenu')), previewBody = el('div', { class: 'template-preview' });
        let rendered = false;
        preview.addEventListener('toggle', () => { if (active() && preview.open && !rendered) { renderWorkout(previewBody, template.blocks || [], { sport: template.sport }); rendered = true; } });
        preview.append(previewBody); card.append(preview);
        const use = button(onSelect ? 'Utiliser' : 'Planifier', () => {
          if (!active() || (!onSelect && !canAdd())) return;
          const copy = copyTemplate(template);
          dialog.close();
          if (onSelect) onSelect(copy); else onUseTemplate?.(copy);
        }, 'button primary', { disabled: !onSelect && !canAdd(), dataset: { action: 'use-template' } });
        if (!onSelect && !canAdd()) use.title = 'Sélectionne un athlète avec la permission de planifier.';
        const actions = el('div', { class: 'template-actions' }, use);
        if (isStarter) {
          const matched = existingCopy(template);
          if (matched) copies.set(template.id, matched.id);
          const saved = copies.has(template.id), saving = pending.has(template.id), status = statuses.get(template.id);
          const keep = button(saved ? 'Déjà dans mes modèles' : saving ? 'Enregistrement…' : 'Garder dans mes modèles', async () => {
            if (!active() || pending.has(template.id) || copies.has(template.id) || existingCopy(template)) return;
            pending.add(template.id); statuses.delete(template.id); redraw();
            try {
              const backend = await getApi();
              if (!active()) return;
              const savedTemplate = await backend.saveTemplate(savedFields(template, ownerId));
              copies.set(template.id, savedTemplate.id);
              activeView(ownerId)?.saved(template.id, savedTemplate);
            } catch (error) {
              if (active()) statuses.set(template.id, { error: true, message: error?.message || 'Impossible de garder ce modèle. Réessaie.' });
            } finally { pending.delete(template.id); activeView(ownerId)?.redraw(); }
          }, 'button secondary', { disabled: saved || saving, 'aria-busy': String(saving), dataset: { action: 'keep-template' } });
          actions.append(keep);
          if (status) card.append(el('p', { class: `template-status${status.error ? ' form-error' : ''}`, role: status.error ? 'alert' : 'status' }, status.message));
        } else if (own(template)) {
          const remove = button(pending.has(template.id) ? 'Suppression…' : 'Supprimer', async () => {
            if (!active() || !own(template) || pending.has(template.id)) return;
            pending.add(template.id); redraw();
            try {
              const confirmed = await confirmAction('Supprimer ce modèle ?', `« ${template.title} » sera retiré de ta bibliothèque. Les séances déjà planifiées restent intactes.`, 'Supprimer');
              if (!confirmed || !active() || !own(template)) return;
              const backend = await getApi();
              if (!active()) return;
              await backend.deleteTemplate(template.id);
              for (const [starterId, copyId] of copies) if (copyId === template.id) copies.delete(starterId);
              activeView(ownerId)?.deleted(template.id);
              if (active()) toast('Modèle supprimé.');
            } catch (error) { if (active()) showError(errors, error); }
            finally { pending.delete(template.id); activeView(ownerId)?.redraw(); }
          }, 'button secondary', { disabled: pending.has(template.id), dataset: { action: 'delete-template' } });
          actions.append(remove);
        }
        card.append(actions); grid.append(card);
      }
    };
    currentView = { ownerId, active, redraw,
      saved(starterId, model) {
        templates = [model, ...templates.filter(item => item.id !== model.id)];
        statuses.set(starterId, { message: 'Ajouté à tes modèles. Tu peux maintenant le retrouver dans « Mes modèles ».' });
      },
      deleted(id) { deletedIds.add(id); templates = templates.filter(item => item.id !== id); },
    };
    for (const [value, label] of [['personal', 'Mes modèles'], ['starter', 'Kit de départ']]) sources.append(button(label, () => { source = value; redraw(); }, 'button secondary', { dataset: { source: value } }));
    if (!kind) for (const [value, label] of [['all', 'Tout'], ['session', 'Séances'], ['block', 'Blocs']]) tabs.append(button(label, () => { filter = value; redraw(); }, 'button secondary', { dataset: { kind: value } }));
    search.addEventListener('input', redraw); redraw();
    try {
      const backend = await getApi();
      if (!active()) return;
      const loaded = await backend.getTemplates();
      if (!active()) return;
      templates = [...templates, ...loaded.filter(item => !deletedIds.has(item.id) && !templates.some(saved => saved.id === item.id))];
      for (const [starterId, copyId] of copies) if (!templates.some(item => item.id === copyId)) copies.delete(starterId);
    } catch (error) {
      if (!active()) return;
      showError(errors, new Error(`Tes modèles personnels n’ont pas pu être chargés. Le kit de départ reste disponible. ${error?.message || ''}`.trim()));
      source = 'starter';
    } finally { loading = false; if (active()) redraw(); }
  }
  return { open, invalidate: () => { ticket++; } };
}
