import { SPORTS, summarizeBlocks, formatDuration, makeBlock } from './domain.js';
import { renderWorkout } from './editor.js';
import { renderTrainingDocument } from './workout-rich-text.js';
import { parseTrainingText } from './workout-document.js';
import { renderSessionChart } from './session-chart.js';
import { $, el, button, heading, errorBox, showError, confirmAction, toast, field, input, select, busy } from './ui.js';

const freshBlocks = blocks => (blocks || []).map(block => ({ ...structuredClone(block), id: makeBlock().id, children: freshBlocks(block.children) }));
const copyTemplate = template => ({ ...structuredClone(template), blocks: freshBlocks(template.blocks) });
const discipline=template=>template.sport==='sparring'?'boxing':template.sport;
const normalize = text => String(text || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('fr');

export function createLibraryUI({ getState, canAdd, onUseTemplate, onCreateTemplate, onEditTemplate, api }) {
  let ticket = 0, workflow = 0;
  const pending = new Set();
  const getApi = () => api ? Promise.resolve(api) : import('./data.js');

  async function open({ kind = null, onSelect = null, restore = null } = {}) {
    if (!onSelect && !restore) workflow++;
    const dialog = $('libraryDialog'), wrap = $('libraryContent'), errors = errorBox();
    const current = ++ticket, ownerId = getState().user?.id;
    const body = el('div', { class: 'dialog-body library-body' });
    wrap.replaceChildren(heading(kind === 'block' ? 'Blocs réutilisables' : 'Bibliothèque', 'ENTRAÎNEMENTS', dialog, 'libraryTitle'), body);
    if (!dialog.open) dialog.showModal();
    const authorized = () => Boolean(ownerId && getState().user?.id === ownerId);
    const active = () => current === ticket && dialog.open && wrap.contains(body) && authorized();
    if (!authorized()) { body.append(el('p', {}, 'Connecte-toi pour ouvrir ta bibliothèque.')); return; }
    let folder = restore?.folder || 'all', filter = restore?.filter || 'all', templates = [], folders = [], loading = true;
    const own = template => template.coach_id === ownerId;
    const notice = el('p', {class:'library-notice muted',role:'status'});
    const search = el('input', { type: 'search', value:restore?.query || '', 'aria-label': 'Rechercher dans la bibliothèque' });
    const searchIcon=el('span',{class:'library-search-icon','aria-hidden':'true'});
    searchIcon.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
    const searchField=field('Rechercher',el('span',{class:'library-search'},searchIcon,search));
    const folderSelect = select('library_folder', [], '', {'aria-label':'Dossier'});
    const typeSelect=select('library_discipline',[{value:'all',label:'Toutes'},...SPORTS.filter(s=>!s.legacy).map(s=>({value:s.id,label:s.label}))],filter,{'aria-label':'Discipline'});
    const grid = el('div', { class: 'template-grid' });
    const edit = (template = null) => {
      if (!active() || loading || template && !own(template)) return;
      const callback=template?onEditTemplate:onCreateTemplate;if(!callback)return;
      const version=workflow, scroll=dialog.scrollTop;
      const view={folder,filter,query:search.value,scroll};
      const options={folders:structuredClone(folders),folderId:folders.some(f=>f.id===folder)?folder:null,onClose:()=>{
        if(authorized()&&version===workflow)open({kind,onSelect,restore:view});
      }};
      dialog.close();
      if(template)callback(structuredClone(template),options);else callback(options);
    };
    const create=onCreateTemplate&&kind!=='block'&&!onSelect?button('＋ Créer un entraînement',()=>edit(), 'button primary',{disabled:true,dataset:{action:'create-template'}}):null;
    let editingFolder = null;
    const folderForm = el('div', {class:'library-folder-form',hidden:true});
    const folderName = input('folder_name','', 'text', {maxLength:80,'aria-label':'Nom du dossier'});
    const folderSave=button('Enregistrer',async()=>{
      if(!active())return;
      try{await busy(folderSave,async()=>{
        const name=folderName.value.trim();if(!name)throw new Error('Indique le nom du dossier.');
        const saved=await (await getApi()).saveLibraryFolder(name,editingFolder);if(!active())return;
        folders=[...folders.filter(f=>f.id!==saved.id),saved];folderForm.hidden=true;redraw();
        notice.textContent=editingFolder?'Dossier renommé.':'Dossier ajouté.';
      });}catch(error){if(active())showError(errors,error);}
    },'button primary');
    folderForm.append(field('Nom du dossier',folderName),el('div',{class:'library-folder-actions'},folderSave,button('Annuler',()=>{folderForm.hidden=true;})));
    const addFolder=button('＋ Dossier',()=>{editingFolder=null;folderName.value='';folderForm.hidden=false;folderName.focus();},'button secondary',{disabled:true});
    const rename=button('Renommer',()=>{const selected=folders.find(f=>f.id===folder);if(!selected)return;editingFolder=selected.id;folderName.value=selected.name;folderForm.hidden=false;folderName.focus();},'button secondary',{dataset:{action:'rename-folder'},hidden:true});
    const removeFolder=button('Supprimer le dossier',async()=>{
      const selected=folders.find(f=>f.id===folder),key=`folder:${ownerId}:${folder}`;
      if(!active()||loading||!selected||pending.has(key))return;
      pending.add(key);removeFolder.disabled=true;errors.hidden=true;
      try{
        const backend=await getApi();if(!active())return;
        const latest=(await backend.getTemplates()).filter(own);if(!active())return;
        const contents=latest.filter(t=>t.folder_id===selected.id),count=contents.length;
        const message=count?`« ${selected.name} » contient ${count} élément${count>1?'s':''} de bibliothèque, tous filtres confondus. Le dossier et TOUS les entraînements et blocs qu’il contient seront définitivement supprimés. Les séances déjà planifiées resteront intactes.`:`Le dossier vide « ${selected.name} » sera supprimé.`;
        if(!await confirmAction('Supprimer ce dossier ?',message,count?'Supprimer le dossier et son contenu':'Supprimer le dossier')||!active())return;
        await backend.deleteLibraryFolder(selected,contents);
        if(active()){templates=latest.filter(t=>t.folder_id!==selected.id);folders=folders.filter(f=>f.id!==selected.id);folder='all';folderForm.hidden=true;redraw();toast(count?'Dossier et contenu supprimés.':'Dossier supprimé.');}
      }catch(error){if(active())showError(errors,error);}finally{pending.delete(key);removeFolder.disabled=false;}
    },'button secondary',{dataset:{action:'delete-folder'},hidden:true});
    const actions=el('div',{class:'library-main-actions'},create,addFolder,rename,removeFolder);
    const toolbar=el('div',{class:'library-toolbar'},searchField,field('Dossier',folderSelect),field('Discipline',typeSelect));
    body.append(errors,actions,toolbar,folderForm,notice,grid);
    folderSelect.addEventListener('change',()=>{folder=folderSelect.value;redraw();});
    typeSelect.addEventListener('change',()=>{filter=typeSelect.value;redraw();});
    search.addEventListener('input',()=>redraw());
    const redraw=()=>{
      if(!active())return;
      if(create)create.disabled=loading;addFolder.disabled=loading;
      grid.replaceChildren();
      const choices=[['all','Toute la bibliothèque'],['unfiled','Mes entraînements (sans dossier)'],...folders.map(f=>[f.id,f.name])];
      folderSelect.replaceChildren(...choices.map(([value,label])=>el('option',{value},label)));folderSelect.value=folder;
      rename.hidden=!folders.some(f=>f.id===folder);removeFolder.hidden=rename.hidden;removeFolder.disabled=pending.has(`folder:${ownerId}:${folder}`);
      const query=normalize(search.value.trim());
      const list=templates.filter(own).sort((a,b)=>a.title.localeCompare(b.title,'fr',{numeric:true,sensitivity:'base'})).filter(t=>
        (folder==='all'||(folder==='unfiled'?!t.folder_id:t.folder_id===folder))&&
        (!kind||t.kind===kind)&&(filter==='all'||discipline(t)===filter)&&normalize(`${t.title} ${t.description||''} ${t.notes||''} ${t.workout_document?.text||''} ${JSON.stringify(t.blocks||[])}`).includes(query));
      notice.textContent=loading?'Chargement de tes entraînements…':`${list.length} résultat${list.length>1?'s':''}`;
      if(!list.length){grid.append(el('p',{class:'empty-message'},query?'Aucun entraînement correspondant.':'Aucun entraînement dans cette sélection.'));return;}
      for(const template of list){
        const summary=summarizeBlocks(template.blocks||[]);
        const sport=SPORTS.find(s=>s.id===template.sport)||SPORTS.at(-1);
        const location=folders.find(f=>f.id===template.folder_id)?.name||'Mes entraînements (sans dossier)';
        const card=el('article',{class:'template-card',dataset:{source:'personal',templateId:template.id}},
          el('p',{class:'eyebrow template-source'},`${template.kind==='block'?'BLOC RÉUTILISABLE':'SÉANCE'} · ${sport.label.toUpperCase()}`),
          el('h3',{},template.title),el('p',{class:'template-location'},location),
          el('p',{},[summary.hasTime?formatDuration(summary.duration_seconds):'',summary.hasDistance?`${summary.distance_m/1000} km`:''].filter(Boolean).join(' · ')));
        const preview=el('details',{},el('summary',{},'Aperçu du contenu')),previewBody=el('div',{class:'template-preview'});let rendered=false;
        preview.addEventListener('toggle',()=>{if(active()&&preview.open&&!rendered){
          if(template.workout_document){
            const documentView=el('div');renderTrainingDocument(documentView,template.workout_document);
            const partial=parseTrainingText(template.workout_document.text,{sport:template.sport}).errors.length>0;
            previewBody.append(documentView,renderSessionChart(template,{compact:false,partial}));
          }else renderWorkout(previewBody,template.blocks||[],{sport:template.sport});
          rendered=true;
        }});preview.append(previewBody);card.append(preview);
        const use=button(onSelect?'Utiliser':'Planifier',()=>{
          if(!active()||!onSelect&&!canAdd())return;
          const copy=copyTemplate(template);dialog.close();
          if(onSelect)onSelect(copy);else onUseTemplate?.(copy);
        },'button primary',{disabled:!onSelect&&!canAdd(),dataset:{action:'use-template'}});
        if(!onSelect&&!canAdd())use.title='Sélectionne un athlète avec la permission de planifier.';
        const itemActions=el('div',{class:'template-actions'},use);
        // Selection inside a workout never replaces its editor with another editor.
        if(onEditTemplate&&!onSelect)itemActions.append(button('Modifier',()=>edit(template),'button secondary',{disabled:loading,dataset:{action:'edit-template'}}));
        if(own(template)){
          const remove=button('Supprimer',async()=>{
            const key=`${ownerId}:${template.id}`;if(!active()||pending.has(key))return;
            pending.add(key);remove.disabled=true;
            try{
              if(!await confirmAction('Supprimer cet entraînement ?',`« ${template.title} » sera retiré de ta bibliothèque. Les séances déjà planifiées restent intactes.`,'Supprimer')||!active())return;
              await (await getApi()).deleteTemplate(template.id);
              if(active()){templates=templates.filter(t=>t.id!==template.id);redraw();toast('Entraînement supprimé.');}
            }catch(error){if(active())showError(errors,error);}finally{pending.delete(key);remove.disabled=false;}
          },'button secondary',{disabled:pending.has(`${ownerId}:${template.id}`),dataset:{action:'delete-template'}});
          itemActions.append(remove);
        }
        card.append(itemActions);grid.append(card);
      }
    };
    redraw();
    try{
      const backend=await getApi();if(!active())return;
      await backend.initializeLibrary();if(!active())return;
      const [loaded,loadedFolders]=await Promise.all([backend.getTemplates(),backend.getLibraryFolders()]);
      if(!active())return;
      templates=loaded;folders=loadedFolders.filter(f=>f.owner_id===ownerId);
      if(!['all','unfiled',...folders.map(f=>f.id)].includes(folder))folder='all';
    }catch(error){if(active())showError(errors,new Error(`La bibliothèque n’a pas pu être chargée. Ferme-la puis réessaie. ${error?.message||''}`.trim()));}
    finally{loading=false;if(active()){redraw();if(restore)dialog.scrollTop=restore.scroll||0;}}
  }
  return {open,invalidate:()=>{ticket++;workflow++;}};
}
