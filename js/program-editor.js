import { BLOCK_TYPES, BLOCK_TYPE_GROUPS, makeBlock, summarizeBlocks, formatDuration } from './domain.js';
import { parseTrainingText, serializeTrainingDocument, reconcileTrainingBlocks } from './workout-document.js';
import { parseEffort, formatEffort } from './workout-effort.js';
import { TrainingTextInput, normalizeTrainingDocument } from './workout-rich-text.js';
import { renderSessionChart } from './session-chart.js';
import { el, button, field, input, textarea, select, errorBox, showError } from './ui.js';

const clone=value=>structuredClone(value);
const blockIndex=blocks=>{const result=new Map();const visit=list=>list.forEach(block=>{result.set(block.id,block);if(block.kind==='repeat')visit(block.children);});visit(blocks);return result;};
const inline=value=>String(value||'').replace(/[\r\n]+/g,' / ').trim();
const meaning=blocks=>blocks.map(block=>block.kind==='repeat'?{kind:'repeat',count:block.repeat_count,unit:block.repeat_unit||'repetitions',children:meaning(block.children)}:{
  kind:block.kind,type:block.type,...(block.type==='other'?{title:inline(block.title)}:{}),description:inline(block.description),
  duration:block.duration_seconds===''?null:block.duration_seconds??null,distance:block.distance_m===''?null:block.distance_m??null,
  effort:formatEffort(block.effort||(block.zone?{kind:'zone',min:block.zone,max:block.zone}:null)),
  ...(block.rounds&&block.work_seconds>0?{rounds:block.rounds,work:block.work_seconds,rest:block.rest_seconds||0}:{}),
});
const sameMeaning=(left,right)=>JSON.stringify(meaning(left))===JSON.stringify(meaning(right));
function knownAliasBaseline(blocks,parsed){
  const candidate=clone(blocks);let changed=false;
  const visit=(old,next)=>old.length===next.length&&old.every((block,index)=>{
    const source=next[index];if(block.kind!==source.kind)return false;
    if(block.kind==='repeat')return visit(block.children,source.children);
    if(block.type==='other'&&source.type!=='other'){
      const probe=parseTrainingText(`- ${inline(block.title)} 1s`),alias=probe.blocks[0];
      if(probe.errors.length||probe.blocks.length!==1||alias.kind!=='step'||alias.type!==source.type||alias.duration_seconds!==1||alias.distance_m||alias.description||alias.effort)return false;
      block.type=source.type;block.title=source.title;changed=true;
    }
    return true;
  });
  return visit(candidate,parsed)&&changed&&sameMeaning(candidate,parsed)?candidate:null;
}
function keepSourceMeaning(blocks,source){
  blocks.forEach((block,index)=>{const parsed=source[index];if(block.kind==='repeat'){
    block.repeat_count=parsed.repeat_count;if(parsed.repeat_unit)block.repeat_unit=parsed.repeat_unit;else delete block.repeat_unit;keepSourceMeaning(block.children,parsed.children);
  }else if(!sameMeaning([block],[parsed])){
    for(const key of ['type','title','description','duration_seconds','distance_m','rounds','work_seconds','rest_seconds','zone','effort'])block[key]=clone(parsed[key]);
  }});
}
const label=type=>BLOCK_TYPES.find(t=>t.id===type)?.label||({walk:'Marche'}[type])||type||'Autre';
const choose=(name,options,value)=>select(name,options.map(([value,label])=>({value,label})),value);
const icons={step:'<path d="M5 6h14M5 12h9M5 18h6m7-5v8m-4-4h8"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',round:'<circle cx="12" cy="13" r="8"/><path d="M9 2h6m-3 0v3m0 8 3-3"/>',library:'<path d="M4 4h6v16H4zM14 4h6v16h-6zM6 8h2m8 0h2"/>'};
function icon(name){const span=el('span',{class:'pe-tool-icon','aria-hidden':'true'});span.innerHTML=`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;return span;}
function timeText(seconds){if(seconds==null)return '';const min=Math.floor(seconds/60),sec=seconds%60;return `${min?`${min}'`:''}${sec?`${sec}"`:''}`||'0s';}
function typeSelect(name,value,sport,rounds=false,hybrid=false){
  const control=el('select',{name,'data-field':'type'});
  if(hybrid)control.append(el('option',{value:'hybrid'},'Hybride'));
  const groups=[...BLOCK_TYPE_GROUPS];if(sport==='running'&&!rounds)groups.sort((a,b)=>Number(b.types.some(t=>t[0]==='run'))-Number(a.types.some(t=>t[0]==='run')));
  for(const group of groups){if(rounds&&!group.types.some(t=>t[0]==='shadow')&&group.label!=='Autres')continue;const types=rounds&&group.label==='Autres'?group.types.filter(([id])=>id==='other'):group.types;control.append(el('optgroup',{label:group.label},types.map(([id,text])=>el('option',{value:id},text))));}

  if(value&&!Array.from(control.options).some(o=>o.value===value))control.append(el('option',{value},label(value)));
  control.value=value;return control;
}
function readQuantity(value,kind){
  const text=kind==='distance'?`${value}mtr`:value;
  const result=parseTrainingText(`- Autre ${text}`);const block=result.blocks[0];
  if(result.errors.length||!block||!(kind==='distance'?block.distance_m>0:block.duration_seconds>0)||kind==='time'&&block.distance_m)throw new Error(kind==='distance'?'Indique une distance valide en mètres.':'Indique une durée valide.');
  return kind==='distance'?block.distance_m:block.duration_seconds;
}
function effortControl(source,name){
  const initial=source.effort|| (source.zone?{kind:'zone',min:source.zone,max:source.zone}:null);
  const initialKind=initial?.kind==='recovery'?initial.label.toLocaleLowerCase('fr'):initial?.kind||'';
  const kind=choose(`${name}_effort_kind`,[['','Non précisé'],['zone','Zone'],['rpe','RPE'],['color','Vert · Jaune · Rouge'],['repos','Repos'],['marche','Marche'],['repos actif','Repos actif'],['bpm','Fréquence cardiaque'],['pace','Allure'],['custom','Autre terme']],initialKind);
  kind.dataset.field='effort-kind';
  const values=el('div',{class:'pe-effort-values'});let low,high;
  const clock=n=>`${Math.floor(n/60)}:${String(Math.round(n%60)).padStart(2,'0')}`;
  const draw=()=>{
    const k=kind.value;values.replaceChildren();low=null;high=null;
    if(['zone','rpe','color'].includes(k)){
      const options=k==='color'?[[1,'Vert'],[2,'Jaune'],[3,'Rouge']]:Array.from({length:k==='zone'?7:10},(_,i)=>[i+1,k==='zone'?`Z${i+1}`:String(i+1)]);
      low=choose(`${name}_effort_min`,options,initial?.kind===k?initial.min:options[0][0]);high=choose(`${name}_effort_max`,[['','—'],...options],initial?.kind===k&&initial.max!==initial.min?initial.max:'');
    }else if(['bpm','pace'].includes(k)){
      low=input(`${name}_effort_min`,initial?.kind===k?(k==='pace'?clock(initial.min):initial.min):'',k==='bpm'?'number':'text');high=input(`${name}_effort_max`,initial?.kind===k&&initial.max!==initial.min?(k==='pace'?clock(initial.max):initial.max):'',k==='bpm'?'number':'text');
    }else if(k==='custom'){low=input(`${name}_effort_label`,initial?.kind==='custom'?initial.label:'','text',{maxLength:120});values.append(field('Terme',low));}
    if(high){low.dataset.field='effort-min';high.dataset.field='effort-max';values.append(field(k==='bpm'?'BPM':k==='pace'?'Allure · min/km':'Valeur',low),field('Jusqu’à (facultatif)',high));}
  };
  kind.addEventListener('change',draw);draw();
  return {node:el('div',{class:'pe-effort-control'},field('Effort',kind),values),read(){
    const k=kind.value;if(!k)return null;if(['repos','marche','repos actif'].includes(k))return parseEffort(k);
    if(k==='custom')return parseEffort(low.value.trim());
    const from=low.value,to=high?.value;if(!from)throw new Error('Précise la valeur de l’effort.');
    const range=to?`${from}-${to}`:from;
    const effort=parseEffort(k==='zone'?`Z${from}${to?`-Z${to}`:''}`:k==='rpe'?`RPE ${range}`:k==='color'?`${['','Vert','Jaune','Rouge'][from]}${to?`-${['','Vert','Jaune','Rouge'][to]}`:''}`:k==='bpm'?`${range} bpm`:`${range}/km`);if(k==='zone'&&initial?.kind==='zone'&&initial.basis)effort.basis=initial.basis;return effort;
  }};
}

/** One source document, optional forms, and an always-current chart. */
export class ProgramEditor {
  constructor(container,{blocks=[],notes='',sport='other',document:doc=null,onChange=()=>{},onSaveBlock=null,onLibrary=null}={}){
    Object.assign(this,{container,sport,onChange,onSaveBlock,onLibrary,mini:null,destroyed:false});this.load(blocks,notes,doc);this.render();
  }
  load(blocks,notes,doc){
    this.originalBlocks=clone(blocks);this.originalNotes=notes;this.originalDocument=doc?normalizeTrainingDocument(doc):null;this.blocks=clone(blocks);this.lockedReason='';this.sourceChanged=false;this.pendingModel=null;this.modelHistory=new Map();
    try{
      if(doc){
        this.document=normalizeTrainingDocument(doc);const parsed=parseTrainingText(this.document.text,{sport:this.sport});
        // Stored text is authoritative, including syntax newly understood by
        // the parser. Matching shape alone does not imply matching activity or dose.
        const unchanged=sameMeaning(blocks,parsed.blocks),aliases=unchanged?null:knownAliasBaseline(blocks,parsed.blocks);let baseline;
        if(unchanged)baseline={blocks:clone(blocks),text:this.document.text};
        else if(aliases)baseline={blocks:aliases,text:this.document.text};
        else baseline=serializeTrainingDocument(blocks);
        this.result=reconcileTrainingBlocks(parsed,baseline.blocks,baseline.text);
        keepSourceMeaning(this.result.blocks,parsed.blocks);
        this.blocks=unchanged?clone(blocks):clone(this.result.blocks);
      }else{
        const converted=serializeTrainingDocument(blocks),prose=parseTrainingText(notes||'',{sport:this.sport});
        if(prose.blocks.length||prose.errors.length)throw new Error('Les anciennes notes ressemblent à des étapes.');
        this.document=normalizeTrainingDocument({text:[notes,converted.text].filter(Boolean).join('\n\n'),marks:[]});
        const parsed=parseTrainingText(this.document.text,{sport:this.sport});
        if(parsed.errors.length)throw new Error('Les anciennes consignes ne peuvent pas être converties sans perte.');
        this.result=reconcileTrainingBlocks(parsed,converted.blocks,converted.text);
      }
      this.reconcileBlocks=clone(this.result.blocks);this.reconcileText=this.document.text;
      // Without a stored document, merely opening or formatting preserves the legacy model.
      this.lines=this.result.lines;this.textErrors=doc?this.result.errors:[];
      this.modelHistory.set(this.document.text,{blocks:clone(this.blocks),result:clone(this.result)});
    }catch(error){this.document=normalizeTrainingDocument(doc||{text:notes,marks:[]});this.result=null;this.lockedReason='Cette ancienne séance est trop complexe pour être convertie sans perte. Son déroulement est conservé.';this.lines=[];this.textErrors=[];}
  }
  getValue(){if(this.mini)throw new Error('Valide ou annule le formulaire avant de continuer.');return clone(this.blocks);}
  getNotes(){return this.lockedReason?this.originalNotes:'';}
  getDocument(){this.getValue();return this.lockedReason?clone(this.originalDocument):clone(this.document);}
  hasDraft(){return !!this.mini;}
  setValue(blocks,notes='',doc=null){this.load(blocks,notes,doc);this.mini=null;this.render();this.emit();}
  setSport(sport){this.sport=sport;this.updatePreview();}
  appendBlock(block){this.getValue();if(this.lockedReason)throw new Error(this.lockedReason);const copied=clone(block),renew=value=>{value.id=makeBlock().id;(value.children||[]).forEach(renew);};renew(copied);const model=serializeTrainingDocument([copied]);this.insertFragment(model.text,true,false,model);}
  onDocument(doc){
    const changed=doc.text!==this.document.text;this.document=doc;
    if(changed){
      const previous=this.pendingModel?null:this.modelHistory.get(doc.text);
      if(previous){this.result=clone(previous.result);this.blocks=clone(previous.blocks);}
      else{
        this.result=reconcileTrainingBlocks(parseTrainingText(doc.text,{sport:this.sport}),this.reconcileBlocks,this.reconcileText);
        if(this.pendingModel)this.mergeInsertedModel(this.pendingModel);
        this.blocks=this.result.blocks;
      }
      this.lines=this.result.lines;this.textErrors=this.result.errors;this.sourceChanged=true;this.reconcileBlocks=clone(this.result.blocks);this.reconcileText=doc.text;
      this.modelHistory.set(doc.text,{blocks:clone(this.blocks),result:clone(this.result)});if(this.modelHistory.size>101)this.modelHistory.delete(this.modelHistory.keys().next().value);
    }
    this.emit();
  }
  mergeInsertedModel({model,start}){
    const desired=blockIndex(model.blocks),current=blockIndex(this.result.blocks),matched=[];
    for(const source of model.lines){if(!source.blockId)continue;const line=this.result.lines.find(line=>line.start===start+source.start&&line.kind===source.kind&&line.blockId);if(line)matched.push({line,block:current.get(line.blockId),source:desired.get(source.blockId)});}
    const occupied=new Set([...current.keys()].filter(id=>!matched.some(item=>item.block?.id===id)));
    for(const item of matched){if(!item.block||!item.source)continue;const id=occupied.has(item.source.id)?makeBlock().id:item.source.id||makeBlock().id;occupied.add(id);const children=item.block.children;Object.assign(item.block,clone(item.source),{id,children});item.line.blockId=id;}
  }
  replaceFragment(start,end,text,model=null,offset=0){
    this.pendingModel=model?{model,start:start+offset}:null;
    try{this.textInput.replace(start,end,text);}finally{this.pendingModel=null;}
  }
  emit(){this.updatePreview();this.onChange(clone(this.blocks),summarizeBlocks(this.blocks));}
  destroy(){this.destroyed=true;this.container.replaceChildren();}
  render(){
    this.container.classList.add('program-editor');this.container.replaceChildren(el('header',{class:'pe-heading'},el('h3',{},'Entraînement')));
    const tools=el('div',{class:'pe-tools',role:'group','aria-label':'Ajouter à l’entraînement'});
    for(const [action,title,name] of [['add-step','Étape','step'],['add-repeat','Répétition','repeat'],['add-rounds','Round','round'],['library','Bibliothèque','library']]){
      const b=button('',()=>{if(action==='library'){this.textInput.capture();this.onLibrary?.();}else this.openMini(action);},'pe-button pe-tool',{dataset:{action},disabled:!!this.lockedReason||action==='library'&&!this.onLibrary});b.append(icon(name),el('span',{},title));tools.append(b);
    }
    const formatting=el('div',{class:'pe-formatbar',role:'group','aria-label':'Mise en forme du texte'});
    const format=(text,key,value,title)=>{const b=button(text,()=>{if(!this.textInput.format(key,value))this.status.textContent='Sélectionne le texte à mettre en forme.';},'pe-button pe-format',{title,'aria-label':title});b.addEventListener('mousedown',e=>e.preventDefault());formatting.append(b);return b;};
    format('G','bold',null,'Gras').style.fontWeight='700';format('S','underline',null,'Souligné').style.textDecoration='underline';
    for(const [color,title] of [['blue','Bleu'],['mint','Menthe'],['coral','Corail'],['lavender','Lavande']]){const b=format('●','color',color,`Texte ${title.toLowerCase()}`);b.classList.add(`training-color-${color}`);}
    format('A','color',null,'Couleur normale');
    for(const [text,redo,title] of [['↶',false,'Annuler la modification'],['↷',true,'Rétablir la modification']]){const b=button(text,()=>this.textInput.undo(redo),'pe-button pe-format',{'aria-label':title,title});b.addEventListener('mousedown',e=>e.preventDefault());formatting.append(b);}
    this.surface=el('div',{class:'pe-text-input'});this.status=el('div',{class:'pe-text-status',role:'status'});this.miniMount=el('div');this.graph=el('div',{class:'session-program-preview'});this.summary=el('p',{class:'pe-summary'});
    this.container.append(tools,this.help(),formatting,this.surface,this.status,this.miniMount,this.graph,this.summary);
    this.textInput=new TrainingTextInput(this.surface,this.document,doc=>this.onDocument(doc));
    if(this.lockedReason){this.surface.contentEditable='false';this.status.textContent=this.lockedReason;formatting.hidden=true;}
    this.updatePreview();
  }
  help(){
    const table=(rows)=>el('table',{},el('tbody',{},rows.map(([a,b])=>el('tr',{},el('th',{scope:'row'},a),el('td',{},b)))));
    const section=(title,...children)=>el('details',{},el('summary',{},title),...children);
    return el('details',{class:'pe-help'},el('summary',{},'ⓘ Aide · écrire un entraînement'),
      el('p',{},'Écris librement. Les boutons insèrent des étapes dans le texte. Une ligne non reconnue reste enregistrable; le graphique indique les parties reconnues.'),
      section('Durées et distances',table([["3m · 3 min · 3 minutes · 3'",'Minutes. Le m signifie toujours minutes, avec ou sans espace.'],['30s · 30 sec · 30 secondes · 30"','Secondes.'],["1m30s · 1 min 30 sec · 1'30\"",'Durée combinée.'],['400mtr · 400 mtr · 400 mètres','Mètres. Écris MTR pour éviter toute confusion avec les minutes.'],['2km · 2 km','Kilomètres.']]),el('p',{},'Majuscules, minuscules, singulier, pluriel, mots sans accents et guillemets de téléphone sont acceptés. Une distance n’est jamais convertie en durée sans données.')),
      section('Étapes, titres et consignes',el('p',{},'Un titre est facultatif et ne définit pas l’activité des étapes suivantes. Commence une étape par un tiret, puis indique son activité et sa durée ou sa distance. Pour une activité connue, les deux ordres fonctionnent : Shadow 30s ou 30s Shadow; Repos 30 secondes ou 30 secondes Repos. Le nom d’une activité Autre personnalisée reste avant la mesure. @ introduit l’effort facultatif. Un tiret après l’effort introduit la consigne; le retour à la ligne termine l’étape.'),el('pre',{},'- Sac 3\' @ RPE 6 - Jab et retour en garde\n- 30 secondes Burpees - Garder le dos droit\n- Course 400mtr @ Z2-Z4'),el('p',{},'Le tiret entre deux valeurs appartient à une fourchette. Écris toujours une consigne après un tiret; un texte inconnu après la mesure ne devient pas une activité. Une puce sans mesure reste visible, mais n’a pas de largeur dans le graphique sans durée ou distance.')),
      section('Efforts et fourchettes',table([['@ Z3 · @ Z2-Z4','Zones 1 à 7. Tu peux préciser FC ou Allure après la zone.'],['@ RPE 6 · @ RPE 6/10 · @ RPE 4-6','Effort demandé de 1 à 10, indépendant du bilan après séance.'],['@ Vert · @ Vert-Jaune · @ Rouge','Trois niveaux d’effort croissants.'],['@ Repos · @ Marche · @ Repos actif','Récupération ou marche.'],['@ 120-150 bpm','Fréquence cardiaque demandée.'],['@ 5:30/km · @ 5:30-6:30/km','Allure ou fourchette en minutes par kilomètre.']]),el('p',{},'@Z3 et @ Z3 sont équivalents. Un terme personnalisé reste visible sans intensité inventée. Une fourchette utilise la même échelle aux deux bornes.')),
      section('Répétitions et rounds',el('p',{},'3x, 3 x, 3rounds et 3 rounds répètent les étapes qui suivent. Une vraie ligne vide termine le groupe. Le retour automatique à la ligne sur téléphone ne termine rien. Un seul niveau de répétition est proposé. Toutes les étapes sont répétées, y compris le dernier repos.'),el('p',{},'Tu peux préciser l’activité dans le groupe : Shadow Boxing 3 rounds ou 3 rounds de Shadow. Les lignes sans activité utilisent alors Shadow; une activité écrite sur une ligne remplace ce choix pour cette ligne seulement. Jog 3x et 3x de Jog fonctionnent de la même façon.'),el('pre',{},'Shadow Boxing 3 rounds\n- 2min - Jab et déplacements\n- Burpees 30s\n- 1min @ Repos\n\n3x de Jog\n- 2min @ Z2\n- 1min @ Z1\n\n- Marche 30"'),el('p',{},'Un titre ordinaire, comme Shadow Boxing sans nombre de répétitions, reste du texte libre. Un titre ou une consigne dans le groupe ne change pas son activité. Une ligne vide termine le groupe et son activité implicite.')),
      section('Lire le graphique et mettre en forme',el('p',{},'La largeur suit la durée connue, ou la distance lorsque toute la séance est en distance. Une fourchette superpose ses deux bornes, sans bandes intermédiaires : Z2 devant Z4, par exemple. Les zones et le RPE ont leurs propres échelles. Les BPM et allures sans repères personnels restent indiqués sans conversion inventée.'),el('p',{},'Touche une portion du graphique pour revoir l’étape. Gras, souligné et couleurs du texte servent uniquement à la mise en forme; colorier une phrase ne change pas l’effort. Les anciennes séances conservent leur déroulement.')));
  }
  updatePreview(){
    if(!this.graph)return;
    if(!this.lockedReason){this.status.replaceChildren();if(this.textErrors.length)this.status.append(el('p',{},'Graphique partiel · le texte peut être enregistré.'),el('ul',{},this.textErrors.slice(0,8).map(e=>el('li',{},`Ligne ${e.line} : ${e.message}`))));}
    const previewBlocks=this.lockedReason?this.blocks:this.result?.blocks||this.blocks;
    this.graph.replaceChildren(renderSessionChart({blocks:previewBlocks,sport:this.sport},{compact:false,partial:!!this.textErrors.length,onSelect:id=>this.editStep(id)}));
    const s=summarizeBlocks(this.blocks);this.summary.textContent=[s.hasTime?formatDuration(s.duration_seconds):'',s.hasDistance?`${s.distance_m.toLocaleString('fr-CA')} mètres`:'',s.hasUnquantified||s.hasDistanceOnly||this.textErrors.length?'Totaux partiels':''].filter(Boolean).join(' · ');
  }
  locate(id){const visit=list=>{for(const b of list){if(b.id===id)return b;const found=visit(b.children||[]);if(found)return found;}return null;};return visit(this.blocks);}
  editStep(id){
    if(this.mini||this.lockedReason)return;
    const line=this.lines.find(l=>l.blockId===id);if(!line)return;
    const block=this.result.blocks.flatMap(b=>b.kind==='repeat'?b.children:[b]).find(b=>b.id===id)||this.locate(id);if(!block||block.kind==='repeat')return;
    this.openMini('edit',block,{start:line.start,end:line.end});
  }
  setEditing(value){this.surface.contentEditable=String(!value&&!this.lockedReason);this.surface.setAttribute('aria-readonly',String(value));for(const b of this.container.querySelectorAll('.pe-tools button,.pe-formatbar button'))b.disabled=value||!!this.lockedReason||b.dataset.action==='library'&&!this.onLibrary;}
  openMini(action,source=null,range=null){
    if(this.mini||this.lockedReason)return;this.textInput.capture();
    this.mini={action,source,range,selection:{...this.textInput.selection}};this.setEditing(true);
    const repeated=['add-repeat','add-rounds'].includes(action),rounds=action==='add-rounds';
    const panel=el('section',{class:'pe-mini','aria-label':repeated?'Ajouter un groupe':source?'Modifier une étape':'Ajouter une étape'});
    panel.append(el('h4',{},source?'Modifier une étape':rounds?'Ajouter des rounds':repeated?'Ajouter une répétition':'Ajouter une étape'));
    const heading=input('optional_heading','','text',{maxLength:500});
    let count,common;const rows=[],rowHost=el('div',{class:'pe-sequence-lines'});
    if(repeated){count=input('block_count',rounds?3:2,'number',{min:1,max:100,step:1,'data-field':'repeat_count'});common=typeSelect('repeat_type',rounds||this.sport==='boxing'?'shadow':this.sport==='running'?'run':'other',this.sport,rounds,true);panel.append(el('div',{class:'pe-repeat-settings'},field('Nombre',count),field('Type du groupe',common)));}
    panel.append(field('Titre (facultatif)',heading));
    const refresh=()=>rows.forEach((row,i)=>{row.title.textContent=`Étape ${i+1}`;row.up.disabled=i===0;row.down.disabled=i===rows.length-1;row.remove.disabled=rows.length===1;row.updateType();rowHost.append(row.node);});
    const addRow=(initial)=>{
      const row=this.stepForm(initial,common,rounds);row.title=el('strong');
      const move=n=>{const i=rows.indexOf(row);[rows[i],rows[i+n]]=[rows[i+n],rows[i]];refresh();};
      row.up=button('↑',()=>move(-1),'pe-button',{'aria-label':'Monter cette ligne'});row.down=button('↓',()=>move(1),'pe-button',{'aria-label':'Descendre cette ligne'});row.remove=button('×',()=>{rows.splice(rows.indexOf(row),1);row.node.remove();refresh();},'pe-button',{'aria-label':'Supprimer cette ligne'});
      if(repeated)row.node.prepend(el('header',{class:'pe-sequence-head'},row.title,el('div',{class:'pe-sequence-actions'},row.up,row.down,row.remove)));
      rows.push(row);refresh();
    };
    addRow(source||makeBlock(repeated?common.value:this.sport==='running'?'run':this.sport==='boxing'?'shadow':'other'));panel.append(rowHost);
    if(common)common.addEventListener('change',refresh);
    if(repeated)panel.append(button('＋ Ajouter une ligne',()=>{if(rows.length<100)addRow(makeBlock(common.value==='hybrid'?'other':common.value));},'pe-button',{dataset:{action:'add-repeat-line'}}),el('p',{class:'pe-hint'},'Toutes les lignes sont répétées, dernier repos inclus.'));
    const errors=errorBox();const cancel=()=>{this.mini=null;this.miniMount.replaceChildren();this.setEditing(false);this.surface.focus();this.textInput.select(this.textInput.selection.start,this.textInput.selection.end);};
    const apply=()=>{try{
      let blocks=rows.map(row=>row.read());if(repeated){const n=Number(count.value);if(!Number.isInteger(n)||n<1||n>100)throw new Error('Indique un nombre entier de 1 à 100.');blocks=[{...makeBlock('repeat'),repeat_count:n,...(rounds?{repeat_unit:'rounds'}:{}),children:blocks}];}
      const errors=summarizeBlocks(blocks).errors;if(errors.length)throw new Error(errors.join(' '));
      const title=heading.value.trim(),parsedTitle=parseTrainingText(title);if(parsedTitle.blocks.length||parsedTitle.errors.length)throw new Error('Ce titre ressemble à une étape ou une répétition. Écris-le comme un titre libre.');
      // Existing notes already occupy their own lines in the document. Keep
      // their data, but never duplicate them into the edited step's instruction.
      const draft=this.mini,serialized=serializeTrainingDocument(draft.range?blocks.map(block=>({...block,notes:''})):blocks);
      const model={...serialized,blocks:draft.range?blocks:serialized.blocks},fragment=[title,serialized.text].filter(Boolean).join('\n'),offset=title?title.length+1:0;cancel();
      if(draft.range)this.replaceFragment(draft.range.start,draft.range.end,fragment,model,offset);else{this.textInput.selection=draft.selection;this.insertFragment(fragment,repeated,!!title,model,offset);}
    }catch(error){showError(errors,error);}};
    panel.append(errors,el('div',{class:'pe-mini-actions'},button('Annuler',cancel,'pe-button'),button(source?'Appliquer':'Ajouter',apply,'pe-button pe-primary',{dataset:{action:'apply-mini'}})));
    panel.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT')event.preventDefault();});
    this.miniMount.replaceChildren(panel);(count||panel.querySelector('select,input'))?.focus();
  }
  stepForm(source,common,rounds){
    const node=el('article',{class:'pe-sequence-row'}),type=typeSelect('block_type',source.type,this.sport,rounds),typeField=field('Type',type);
    const name=input('block_title',source.type==='other'?source.title:'','text',{maxLength:500,'data-field':'title'}),nameField=field('Nom',name);
    const initialFormat=source.distance_m!=null?source.duration_seconds!=null?'mixed':'distance':source.duration_seconds!=null?'time':'free';
    const format=choose('block_format',[['time','Durée'],['distance','Distance'],['mixed','Durée et distance'],['free','Sans mesure']],this.mini?.action==='edit'||source.id&&this.locate(source.id)?initialFormat:'time');format.dataset.field='format';
    const time=input('block_duration',timeText(source.duration_seconds),'text',{'data-field':'duration'}),meters=input('block_distance',source.distance_m??'','text',{inputMode:'decimal','data-field':'distance'});
    const timeField=field('Durée',time),distanceField=field('Distance · mètres',meters);
    const instruction=textarea('block_description',source.description||'',{rows:2,maxLength:10000,'data-field':'description'});
    const effort=effortControl(source,source.id);
    const updateFormat=()=>{timeField.hidden=!['time','mixed'].includes(format.value);distanceField.hidden=!['distance','mixed'].includes(format.value);};format.addEventListener('change',updateFormat);updateFormat();
    const updateType=()=>{typeField.hidden=!!common&&common.value!=='hybrid';nameField.hidden=(common&&common.value!=='hybrid'?common.value:type.value)!=='other';};type.addEventListener('change',updateType);updateType();
    node.append(el('div',{class:'pe-sequence-fields'},typeField,nameField,field('Mesure',format),timeField,distanceField),effort.node,field('Consigne',instruction));
    return {node,updateType,read:()=>{
      const actualType=common&&common.value!=='hybrid'?common.value:type.value;if(!actualType)throw new Error('Choisis une activité.');if(actualType==='other'&&!name.value.trim())throw new Error('Indique le nom de l’activité.');
      const next={...clone(source),type:actualType,title:actualType==='other'?name.value.trim():label(actualType),description:instruction.value,duration_seconds:null,distance_m:null,rounds:null,work_seconds:null,rest_seconds:null,zone:null,effort:effort.read()};
      if(['time','mixed'].includes(format.value))next.duration_seconds=readQuantity(time.value,'time');if(['distance','mixed'].includes(format.value))next.distance_m=readQuantity(meters.value,'distance');
      if(next.effort?.kind==='zone'&&next.effort.min===next.effort.max)next.zone=next.effort.min;return next;
    }};
  }
  insertFragment(fragment,group=false,heading=false,model=null,modelOffset=0){
    const {start,end}=this.textInput.selection,text=this.document.text;
    // Insert whole lines. A group gets its own blank-line boundaries; one step can join the current group.
    const from=text.lastIndexOf('\n',Math.max(0,start-1))+1,found=text.indexOf('\n',end),to=found<0?text.length:found;
    // Adding never deletes selected text. Only the graph's explicit Edit action
    // replaces a source line; insertion follows the selected complete lines.
    let at=start===end?(start===from?from:to):(end>0&&text[end-1]==='\n'?end:to),finish=at;
    if(group||heading){
      let current=null;
      for(const line of this.lines){if(line.start>at)break;if(line.kind==='blank')current=null;else if(line.kind==='repeat'&&line.blockId)current=line;}
      if(current&&at>current.start){const boundary=this.lines.find(line=>line.start>at&&line.kind==='blank');at=boundary?boundary.start:text.length;finish=at;}
    }
    const before=text.slice(0,at),after=text.slice(finish),separator=group||heading?'\n\n':'\n';
    const prefix=before&&!before.endsWith(separator)?separator.slice(before.endsWith('\n')?1:0):'';
    const suffix=after&&!after.startsWith(separator)?separator.slice(after.startsWith('\n')?1:0):group?'\n\n':'';
    this.replaceFragment(at,finish,prefix+fragment+suffix,model,prefix.length+modelOffset);
  }
}
