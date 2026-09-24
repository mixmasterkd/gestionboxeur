import { SPORTS, summarizeBlocks, formatDuration, makeBlock } from './domain.js';
import { getStarterTemplates } from './starter-templates.js';
import { renderWorkout } from './editor.js';
import { renderTrainingDocument } from './workout-rich-text.js';
import { parseTrainingText } from './workout-document.js';
import { renderSessionChart } from './session-chart.js';
import { $, el, button, heading, errorBox, showError, confirmAction, toast, field, input, select, busy } from './ui.js';

const freshBlocks = blocks => (blocks || []).map(block => ({ ...structuredClone(block), id: makeBlock().id, children: freshBlocks(block.children) }));
const copyTemplate = template => ({ ...structuredClone(template), blocks: freshBlocks(template.blocks) });
const savedFields = (template, ownerId) => ({
  title: template.title, sport: template.sport, description: template.description || '', notes: template.notes || '',
  blocks: freshBlocks(template.blocks), workout_document: template.workout_document ? structuredClone(template.workout_document) : null, kind: template.kind, coach_id: ownerId,
});
// Fresh block IDs differ on every copy; compare content to avoid identical kit copies.
const withoutIds = value => Array.isArray(value) ? value.map(withoutIds)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'id').sort().map(key => [key, withoutIds(value[key])])) : value;
const fingerprint = template => JSON.stringify(withoutIds({
  title: template.title, sport: template.sport, description: template.description || '', notes: template.notes || '',
  blocks: template.blocks || [], workout_document: template.workout_document || null, kind: template.kind,
}));

export function createLibraryUI({ getState, canAdd, onUseTemplate, onCreateTemplate, api }) {
  let ticket = 0;
  const copiesByCoach = new Map(), pendingByCoach = new Map();
  let currentView = null;
  const getApi = () => api ? Promise.resolve(api) : import('./data.js');
  const activeView = ownerId => currentView?.ownerId === ownerId && currentView.active() ? currentView : null;

  async function open({ kind = null, onSelect = null } = {}) {
    const dialog = $('libraryDialog'), wrap = $('libraryContent'), errors = errorBox();
    const current = ++ticket, ownerId = getState().user?.id;
    const body = el('div', { class: 'dialog-body' });
    wrap.replaceChildren(heading(kind === 'block' ? 'Tes blocs réutilisables' : 'Ta bibliothèque', 'SÉANCES ET BLOCS', dialog, 'libraryTitle'), body);
    if (!dialog.open) dialog.showModal();
    const authorized = () => Boolean(ownerId && getState().user?.id === ownerId);
    const active = () => current === ticket && dialog.open && wrap.contains(body) && authorized();
    if (!authorized()) { body.append(el('p', {}, 'Connecte-toi pour ouvrir ta bibliothèque.')); return; }

    if (onCreateTemplate && kind !== 'block' && !onSelect) body.append(button('＋ Créer un entraînement', () => { if (!authorized()) return; dialog.close(); onCreateTemplate(); }, 'button primary'));
    let source = 'personal', folder = 'personal', filter = kind || 'all', templates = [], folders = [], loading = true;
    const starter = getStarterTemplates(), statuses = new Map(), deletedIds = new Set();
    if (!copiesByCoach.has(ownerId)) copiesByCoach.set(ownerId, new Map());
    if (!pendingByCoach.has(ownerId)) pendingByCoach.set(ownerId, new Set());
    const copies = copiesByCoach.get(ownerId);
    const pending = pendingByCoach.get(ownerId);
    const search = el('input', { type: 'search', 'aria-label': 'Rechercher un modèle' });
    const sources = el('div', { class: 'library-sources' });
    const folderSelect = select('library_folder', [], '', {'aria-label':'Dossier'});
    const folderForm = el('div', {class:'library-folder-form',hidden:true});
    const folderName = input('folder_name','', 'text', {maxLength:80,'aria-label':'Nom du dossier'});
    let editingFolder = null;
    const folderSave=button('Enregistrer',async()=>{if(!active())return;try{await busy(folderSave,async()=>{
      const name=folderName.value.trim();if(!name)throw new Error('Indique le nom du dossier.');
      const saved=await (await getApi()).saveLibraryFolder(name,editingFolder);if(!active())return;
      folders=[...folders.filter(f=>f.id!==saved.id),saved];folder=saved.id;source='personal';folderForm.hidden=true;redraw();
    });}catch(error){if(active())showError(errors,error);}},'button primary');
    folderForm.append(field('Nom du dossier',folderName),folderSave,button('Annuler',()=>{folderForm.hidden=true;}));
    sources.append(folderSelect,button('＋ Dossier',()=>{editingFolder=null;folderName.value='';folderForm.hidden=false;folderName.focus();}),button('Renommer',()=>{const current=folders.find(f=>f.id===folder);if(!current)return;editingFolder=current.id;folderName.value=current.name;folderForm.hidden=false;folderName.focus();},'button secondary',{dataset:{action:'rename-folder'}}));
    folderSelect.addEventListener('change',()=>{folder=folderSelect.value;source=folder.startsWith('base:')?'starter':'personal';redraw();});
    const tabs = el('div', { class: 'template-tabs', role: 'group', 'aria-label': 'Type de modèle' });
    const grid = el('div', { class: 'template-grid' });
    const notice = el('p', { class: 'library-notice muted', role: 'status' });
    body.append(errors, sources, folderForm, el('div', { class: 'library-toolbar' }, search, tabs), notice, grid);

    const own = template => template.coach_id === ownerId;
    const existingCopy = template => templates.find(item => own(item) && fingerprint(item) === fingerprint(template));
    const redraw = () => {
      if (!active()) return;
      grid.replaceChildren();
      folderSelect.replaceChildren(...[['personal','Mes entraînements'],['unfiled','Sans dossier'],['base:running','Jog - Base'],['base:boxing','Boxe - Base'],['base:other','Préparation physique - Base'],...folders.map(f=>[f.id,f.name])].map(([value,label])=>el('option',{value},label)));
      folderSelect.value=folder;
      sources.querySelector('[data-action="rename-folder"]').hidden=!folders.some(f=>f.id===folder);
      tabs.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.kind === filter)));
      notice.textContent = source === 'starter' ? 'Séances de base · utilise-les directement ou garde une copie dans tes dossiers.' : '';
      const baseGroup = t=>t.sport==='running'?'running':['boxing','sparring'].includes(t.sport)?'boxing':'other';
      const items = source === 'starter' ? starter.filter(t=>folder==='base:'+baseGroup(t)) : templates.filter(t=>own(t)&&(folder==='personal'||folder==='unfiled'&&!t.folder_id||t.folder_id===folder));
      const query = search.value.trim().toLocaleLowerCase('fr');
      const list = items.filter(template => (filter === 'all' || template.kind === filter) && `${template.title} ${template.description || ''} ${template.workout_document?.text || ''}`.toLocaleLowerCase('fr').includes(query));
      if (!list.length) {
        const empty = source === 'personal' && loading ? 'Chargement de tes modèles…'
          : query ? 'Aucun modèle correspondant.' : source === 'starter' && filter === 'block' ? 'Ce dossier contient des séances complètes.'
            : source === 'personal' ? 'Aucun entraînement dans ce dossier.' : 'Aucun modèle de ce type.';
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
        preview.addEventListener('toggle', () => { if (active() && preview.open && !rendered) {
          if (template.workout_document) {
            const documentView=el('div'); renderTrainingDocument(documentView, template.workout_document);
            const partial=parseTrainingText(template.workout_document.text,{sport:template.sport}).errors.length>0;
            previewBody.append(documentView,renderSessionChart(template, { compact: false, partial }));
          } else renderWorkout(previewBody, template.blocks || [], { sport: template.sport });
          rendered = true;
        } });
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
          const move=select('template_folder',[{value:'',label:'Sans dossier'},...folders.map(f=>({value:f.id,label:f.name}))],template.folder_id||'',{'aria-label':`Dossier de ${template.title}`});
          move.addEventListener('change',async()=>{if(!active())return;move.disabled=true;try{const updated=await (await getApi()).moveTemplate(template,move.value||null);if(active()){templates=templates.map(t=>t.id===updated.id?updated:t);redraw();}}catch(error){if(active()){move.value=template.folder_id||'';showError(errors,error);}}finally{move.disabled=false;}});
          actions.append(move);
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
        statuses.set(starterId, { message: 'Ajouté à tes modèles. Tu peux maintenant le retrouver dans « Mes entraînements ».' });
      },
      deleted(id) { deletedIds.add(id); templates = templates.filter(item => item.id !== id); },
    };
    if (!kind) for (const [value, label] of [['all', 'Tout'], ['session', 'Séances'], ['block', 'Blocs']]) tabs.append(button(label, () => { filter = value; redraw(); }, 'button secondary', { dataset: { kind: value } }));
    search.addEventListener('input', redraw); redraw();
    try {
      const backend = await getApi();
      if (!active()) return;
      const [loaded, loadedFolders] = await Promise.all([backend.getTemplates(), backend.getLibraryFolders()]);
      if (!active()) return;
      folders = loadedFolders.filter(f=>f.owner_id===ownerId);
      templates = [...templates, ...loaded.filter(item => !deletedIds.has(item.id) && !templates.some(saved => saved.id === item.id))];
      for (const [starterId, copyId] of copies) if (!templates.some(item => item.id === copyId)) copies.delete(starterId);
    } catch (error) {
      if (!active()) return;
      showError(errors, new Error(`Tes modèles personnels n’ont pas pu être chargés. Les dossiers de base restent disponibles. ${error?.message || ''}`.trim()));
      source = 'starter'; folder='base:running';
    } finally { loading = false; if (active()) redraw(); }
  }
  return { open, invalidate: () => { ticket++; } };
}
