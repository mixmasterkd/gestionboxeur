import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makeBlock, summarizeBlocks } from '../js/domain.js';

const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const { ProgramEditor } = await import('../js/program-editor.js');
const editors = new Set();
function fixture(options = {}) {
  const mount = document.createElement('div'); document.body.append(mount);
  let changes = 0;
  const editor = new ProgramEditor(mount, { ...options, onChange() { changes++; } }); editors.add(editor);
  return { editor, mount, changes: () => changes };
}
function change(node, value) {
  assert.ok(node, 'The requested form field exists');
  node.value = String(value); node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
const click = (mount, action) => { const node=mount.querySelector(`[data-action="${action}"]`); assert.ok(node,`Action ${action} exists`);node.click(); };
const fill = (mount, field, value) => change(mount.querySelector(`.pe-mini [data-field="${field}"]`), value);
const rows = mount => [...mount.querySelectorAll('.pe-sequence-row')];
const cancel = mount => [...mount.querySelectorAll('.pe-mini-actions button')].find(button => button.textContent === 'Annuler').click();
function write(editor, text) {
  editor.surface.textContent=text; editor.textInput.select(text.length);
  editor.surface.dispatchEvent(new window.Event('input',{bubbles:true}));
}
function effort(row,kind,min,max='') {
  change(row.querySelector('[data-field="effort-kind"]'),kind);
  if(min!=null)change(row.querySelector('[data-field="effort-min"]'),min);
  if(max!=='')change(row.querySelector('[data-field="effort-max"]'),max);
}
const sessionStep = (type, values={}) => ({...makeBlock(type),...values});
test.afterEach(() => { for (const editor of editors) editor.destroy(); editors.clear(); document.body.replaceChildren(); window.getSelection().removeAllRanges(); });
test.after(async () => { await window.happyDOM.abort(); });

test('a new workout has one empty editor, four add tools, no example in its text, and a permanent empty plan',()=>{
  const {editor,mount}=fixture({onLibrary(){}});
  assert.equal(editor.getDocument().text,'');assert.equal(editor.getDocument().marks.length,0);
  assert.equal(mount.querySelectorAll('[role=textbox]').length,1);assert.equal(mount.querySelector('[data-mode]'),null);
  assert.deepEqual([...mount.querySelectorAll('.pe-tools button')].map(button=>button.textContent),['Étape','Répétition','Round','Bibliothèque']);
  assert.equal(mount.querySelector('[role=textbox]').getAttribute('aria-multiline'),'true');
  assert.match(mount.querySelector('.session-program-preview').textContent,/Aucune étape structurée/);
  assert.equal(mount.querySelector('[placeholder]'),null);assert.deepEqual(editor.getValue(),[]);
});

test('a pyramid form repeats every free-named step and the final recovery exactly five times',()=>{
  const {editor,mount}=fixture({sport:'running'});click(mount,'add-repeat');
  assert.equal(mount.querySelector('.pe-mini input').name,'block_count');fill(mount,'repeat_count',5);
  for(let i=0;i<2;i++)click(mount,'add-repeat-line');
  const sequence=rows(mount);['2m','1m','30s','3m'].forEach((value,index)=>change(sequence[index].querySelector('[data-field=duration]'),value));
  [2,3,4].forEach((zone,index)=>effort(sequence[index],'zone',zone));
  change(sequence[3].querySelector('[data-field=title]'),'Repos');effort(sequence[3],'repos');click(mount,'apply-mini');
  const [group]=editor.getValue();assert.equal(group.repeat_count,5);
  assert.deepEqual(group.children.map(block=>[block.type,block.duration_seconds,block.zone]),[['run',120,2],['run',60,3],['run',30,4],['recovery',180,null]]);
  const summary=summarizeBlocks([group]);assert.equal(summary.duration_seconds,1950);assert.equal(summary.segments.length,20);
  for(let i=0;i<5;i++)assert.deepEqual(summary.segments.slice(i*4,i*4+4).map(block=>block.duration_seconds),[120,60,30,180]);
  assert.match(editor.getDocument().text,/^5x\n- 2min/);assert.match(editor.getDocument().text,/- Repos 3min/);
  assert.equal(mount.querySelectorAll('.session-chart-segment').length,20);
});

test('Round and Répétition produce the same sequence mechanics and include the final rest',()=>{
  for(const action of ['add-rounds','add-repeat']){
    const {editor,mount}=fixture({sport:'boxing'});click(mount,action);fill(mount,'repeat_count',3);
    const sequence=rows(mount);change(sequence[0].querySelector('[data-field=title]'),'Sac');change(sequence[0].querySelector('[data-field=duration]'),"3'");
    effort(sequence[0],'color',1,2);change(sequence[1].querySelector('[data-field=title]'),'Shadow');change(sequence[1].querySelector('[data-field=duration]'),'1 min');effort(sequence[1],'repos actif');
    assert.equal(mount.querySelector('[data-field=recovery]'),null);click(mount,'apply-mini');
    const [group]=editor.getValue();assert.equal(group.kind,'repeat');assert.equal(group.repeat_unit,action==='add-rounds'?'rounds':undefined);
    assert.equal(summarizeBlocks([group]).duration_seconds,720);assert.equal(summarizeBlocks([group]).segments.length,6);
    assert.deepEqual(group.children.map(block=>block.type),['bag','shadow']);assert.equal(group.children[1].effort.label,'Repos actif');assert.match(editor.getDocument().text,action==='add-rounds'?/^3 rounds\n/:/^3x\n/);
  }
});

test('new rounds put an optional activity title above the count and keep unnamed steps compact when edited',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-rounds');
  change(mount.querySelector('[name=optional_heading]'),'Shadow Boxing');
  assert.equal(rows(mount)[0].querySelector('[data-field=duration]').value,'3 MIN');assert.equal(rows(mount)[1].querySelector('[data-field=duration]').value,'1 MIN');
  effort(rows(mount)[0],'rpe',4,6);fill(mount,'description','Jab et déplacement');click(mount,'apply-mini');
  assert.equal(editor.getDocument().text,'Shadow Boxing\n3 rounds\n- 3min @ RPE 4-6/10 - Jab et déplacement\n- 1min @ Repos\n\n');
  const [group]=editor.getValue();assert.equal(group.repeat_count,3);assert.deepEqual(group.children.map(block=>block.type),['shadow','shadow']);assert.equal(summarizeBlocks([group]).duration_seconds,720);
  assert.deepEqual(editor.lines.filter(line=>line.kind==='step').map(line=>line.blockId),group.children.map(block=>block.id));
  const saved=fixture({blocks:editor.getValue(),document:editor.getDocument(),sport:'boxing'}).editor;assert.deepEqual(saved.getValue(),editor.getValue());
  editor.editStep(group.children[1].id);assert.equal(mount.querySelector('[data-field=title]').value,'');fill(mount,'duration','90s');click(mount,'apply-mini');
  assert.equal(editor.getValue()[0].children[1].id,group.children[1].id);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,810);assert.match(editor.getDocument().text,/^Shadow Boxing\n3 rounds\n- 3min @ RPE 4-6\/10 - Jab et déplacement\n- 1min30s @ Repos/);
  assert.deepEqual(fixture({blocks:editor.getValue(),document:editor.getDocument(),sport:'boxing'}).editor.getValue(),editor.getValue());
});

test('known titles inherit activity and unknown or absent titles keep unnamed steps stable across saving',()=>{
  for(const [title,type,name] of [['Shadow Boxing','shadow','Shadow'],['Échauffement technique','other','Boxe'],['','other','Boxe']]){
    const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-rounds');change(mount.querySelector('[name=optional_heading]'),title);click(mount,'apply-mini');
    assert.equal(editor.getDocument().text,`${title?`${title}\n`:''}3 rounds\n- 3min\n- 1min @ Repos\n\n`);
    assert.ok(editor.getValue()[0].children.every(block=>block.type===type&&block.title===name));assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,720);
    const saved={blocks:editor.getValue(),document:editor.getDocument(),sport:'boxing'};assert.deepEqual(fixture(saved).editor.getValue(),saved.blocks);
  }
});

test('a freely named step overrides a group title only for that step',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-rounds');change(mount.querySelector('[name=optional_heading]'),'Shadow');
  change(rows(mount)[1].querySelector('[data-field=title]'),'Burpees');effort(rows(mount)[1],'');click(mount,'apply-mini');
  assert.deepEqual(editor.getValue()[0].children.map(block=>block.type),['shadow','burpees']);assert.match(editor.getDocument().text,/Shadow\n3 rounds\n- 3min\n- Burpees 1min/);
});

test('an optional name with no measure still creates an unquantified step',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-step');fill(mount,'title','Shadow');fill(mount,'format','free');click(mount,'apply-mini');
  assert.equal(editor.getDocument().text,'- Shadow');assert.equal(editor.getValue().length,1);assert.equal(editor.getValue()[0].duration_seconds,null);
  assert.equal(editor.getValue()[0].effort,null);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,0);
});

test('forms use optional free names and two initial steps without activity dropdowns or default titles',()=>{
  for(const sport of ['running','boxing']){
    const {editor,mount}=fixture({sport});click(mount,'add-step');
    assert.equal(rows(mount).length,1);assert.equal(mount.querySelector('[name=block_title]').value,'');assert.equal(mount.querySelector('[name=block_duration]').value,'');
    assert.equal(mount.querySelector('[name=block_type],[name=repeat_type]'),null);assert.equal(mount.querySelector('[name=optional_heading]').value,'');
    assert.equal(mount.querySelector('[name=block_title]').closest('label').hidden,false);cancel(mount);
    for(const action of ['add-repeat','add-rounds']){
      click(mount,action);const sequence=rows(mount),rounds=action==='add-rounds';assert.equal(sequence.length,2);
      assert.equal(mount.querySelector('[name=block_type],[name=repeat_type]'),null);assert.equal(mount.querySelector('[name=optional_heading]').value,'');
      assert.deepEqual(sequence.map(row=>row.querySelector('[data-field=title]').value),['','']);
      assert.deepEqual(sequence.map(row=>row.querySelector('[data-field=duration]').value),rounds?['3 MIN','1 MIN']:['','']);
      assert.deepEqual(sequence.map(row=>row.querySelector('[data-field=effort-kind]').value),rounds?['','repos']:['','']);
      assert.equal(mount.querySelector('[data-field=repeat_count]').value,rounds?'3':'2');assert.equal(mount.querySelector('[data-action=add-repeat-line]').textContent,'＋ Ajouter une étape');
      cancel(mount);
    }
    assert.deepEqual(editor.getValue(),[]);
  }
});

test('round and repetition count controls increment within the allowed bounds',()=>{
  const {mount}=fixture({sport:'boxing'});
  for(const [action,name] of [['add-rounds','rounds'],['add-repeat','répétitions']]){
    click(mount,action);const count=mount.querySelector('[data-field=repeat_count]'),down=mount.querySelector(`[aria-label="Diminuer le nombre de ${name}"]`),up=mount.querySelector(`[aria-label="Augmenter le nombre de ${name}"]`);
    assert.ok(down);assert.ok(up);change(count,1);down.click();assert.equal(count.value,'1');up.click();assert.equal(count.value,'2');
    change(count,100);up.click();assert.equal(count.value,'100');down.click();assert.equal(count.value,'99');cancel(mount);
  }
});

test('sport changes preserve typed source and pending free-name form data',()=>{
  const {editor,mount}=fixture({sport:'running'});write(editor,'Consigne libre\n- Course 5min @ Z2');const original=editor.getDocument();
  click(mount,'add-step');fill(mount,'title','Mon atelier');fill(mount,'duration','30s');
  editor.setSport('boxing');assert.equal(mount.querySelector('[data-field=title]').value,'Mon atelier');
  assert.throws(()=>editor.getValue(),/Valide ou annule/);assert.throws(()=>editor.appendBlock(makeBlock('bag')),/Valide ou annule/);
  cancel(mount);assert.deepEqual(editor.getDocument(),original);click(mount,'add-step');assert.equal(mount.querySelector('[data-field=title]').value,'');
});

test('free prose and malformed structured text remain saveable, with an up-to-date partial plan',()=>{
  const {editor,mount,changes}=fixture({sport:'boxing'});
  write(editor,'Mon entraînement libre.\n- Garder les mains hautes\n\n- Sac 3min @ RPE 6');
  assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,180);
  assert.match(editor.getDocument().text,/Garder les mains hautes/);
  write(editor,'Mon entraînement libre.\n- Sac 3min @ Z9\n- Shadow 30sec @ Vert');
  assert.doesNotThrow(()=>editor.getValue());assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,30);
  assert.equal(mount.querySelectorAll('.session-chart-segment').length,1);
  assert.match(mount.querySelector('.pe-text-status').textContent,/Graphique partiel.*enregistré.*Ligne 2/s);
  assert.match(mount.querySelector('.session-chart').textContent,/Profil partiel/);assert.match(editor.getDocument().text,/@ Z9/);
  assert.equal(changes(),2);
  write(editor,'Séance entièrement libre, à adapter sur place.');
  assert.deepEqual(editor.getValue(),[]);assert.equal(mount.querySelector('.session-chart svg'),null);
  assert.match(mount.querySelector('.session-chart').textContent,/Aucune étape structurée/);
});

test('a group inserted between existing steps has blank boundaries and cannot absorb the following workout',()=>{
  const {editor,mount}=fixture({sport:'running'});
  write(editor,'- Jog 10min\n- Marche 5min');editor.textInput.select(editor.getDocument().text.indexOf('- Marche'));
  click(mount,'add-repeat');fill(mount,'repeat_count',2);fill(mount,'duration','1min');change(rows(mount)[1].querySelector('[data-field=duration]'),'30s');click(mount,'apply-mini');
  const document=editor.getDocument().text,blocks=editor.getValue();
  assert.match(document,/- Jog 10min\n\n2x\n- 1min\n- 30s\n\n- Marche 5min/);
  assert.deepEqual(blocks.map(block=>block.kind),['step','repeat','step']);assert.equal(blocks[1].children.length,2);
  assert.equal(summarizeBlocks(blocks).duration_seconds,1080);
});

test('adding a step inside an existing repetition joins that group without moving its following section',()=>{
  const {editor,mount}=fixture({sport:'boxing'});
  write(editor,"3 rounds\n- Sac 3min\n\nRetour au calme\n- Marche 2min");
  editor.textInput.select(editor.getDocument().text.indexOf('\n\n'));
  click(mount,'add-step');fill(mount,'title','Shadow');fill(mount,'duration','1min');click(mount,'apply-mini');
  const blocks=editor.getValue();assert.equal(blocks.length,2);assert.equal(blocks[0].children.length,2);
  assert.deepEqual(blocks[0].children.map(block=>block.type),['bag','shadow']);assert.equal(blocks[1].type,'walk');
  assert.equal(summarizeBlocks(blocks).duration_seconds,840);
});

test('an optional heading and a visible instruction are inserted without making the heading an activity',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-step');
  change(mount.querySelector('[name=optional_heading]'),'Échauffement');fill(mount,'title','Shadow');fill(mount,'duration','3 minutes');fill(mount,'description','Jab, déplacement, retour en garde');
  effort(rows(mount)[0],'rpe',6);assert.equal(mount.querySelector('[name=block_description]').closest('details'),null);click(mount,'apply-mini');
  const [block]=editor.getValue();assert.equal(block.type,'shadow');assert.equal(block.duration_seconds,180);assert.equal(block.effort.min,6);
  assert.equal(block.description,'Jab, déplacement, retour en garde');assert.match(editor.getDocument().text,/^Échauffement\n- Shadow 3min @ ?RPE/);
  assert.match(editor.getDocument().text,/- Jab, déplacement, retour en garde/);
});

test('a free optional activity name preserves custom names and treats markup as text',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-step');
  assert.equal(mount.querySelector('[name=block_title]').closest('label').hidden,false);
  fill(mount,'title','<img src=x>');fill(mount,'duration','1min');fill(mount,'description','<script>texte</script>');click(mount,'apply-mini');
  assert.equal(editor.getValue()[0].title,'<img src=x>');assert.equal(editor.getValue()[0].description,'<script>texte</script>');
  assert.equal(mount.querySelector('img,script'),null);assert.match(editor.getDocument().text,/<img src=x>/);
});

test('distance forms use metres and do not invent a duration, including within repetitions',()=>{
  const {editor,mount}=fixture({sport:'running'});click(mount,'add-repeat');fill(mount,'repeat_count',3);
  rows(mount).forEach((row,index)=>{change(row.querySelector('[data-field=format]'),'distance');change(row.querySelector('[data-field=distance]'),index?200:400);effort(row,'zone',2,4);});click(mount,'apply-mini');
  const [block]=editor.getValue();assert.equal(block.children[0].duration_seconds,null);assert.equal(block.children[0].distance_m,400);assert.equal(block.children[1].distance_m,200);
  assert.equal(summarizeBlocks([block]).distance_m,1800);assert.equal(summarizeBlocks([block]).duration_seconds,0);
  assert.match(editor.getDocument().text,/400mtr/);assert.match(mount.querySelector('.session-chart svg').getAttribute('aria-label'),/Largeur : distance/);
});

test('step duration fields accept minute variants, plain minutes and combined seconds',()=>{
  for(const sport of ['boxing','running'])for(const [value,seconds] of [['10M',600],['10 M',600],['10 MIN',600],['10',600],['2,5',150],['2M 30SC',150],["2'30\"",150]]){
    const {editor,mount}=fixture({sport});click(mount,'add-step');
    change(mount.querySelector('[name=optional_heading]'),'Échauffement');fill(mount,'duration',value);click(mount,'apply-mini');
    assert.equal(editor.mini,null,`${sport}: ${value}`);assert.equal(editor.getValue()[0].duration_seconds,seconds);
    assert.match(editor.getDocument().text,/^Échauffement\n/);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,seconds);
  }
});

test('a rejected duration can be corrected and applied without reopening the step',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-step');
  for(const value of ['0','-10','10xyz','400mtr']){
    fill(mount,'duration',value);click(mount,'apply-mini');
    assert.ok(editor.mini);assert.equal(mount.querySelector('.pe-mini .form-error').hidden,false);
  }
  fill(mount,'duration','10 M');click(mount,'apply-mini');assert.equal(editor.mini,null);assert.equal(editor.getValue()[0].duration_seconds,600);
});

test('mini validation and cancelling preserve source without partial writes',()=>{
  const {editor,mount,changes}=fixture({sport:'running'});write(editor,'Préparation libre');const original=editor.getDocument();
  click(mount,'add-repeat');fill(mount,'repeat_count','2.5');fill(mount,'duration','1min');change(rows(mount)[1].querySelector('[data-field=duration]'),'30s');click(mount,'apply-mini');
  assert.match(mount.querySelector('.pe-mini .form-error').textContent,/entier/);assert.equal(changes(),1);assert.throws(()=>editor.getDocument(),/Valide ou annule/);
  cancel(mount);assert.deepEqual(editor.getDocument(),original);
  click(mount,'add-step');fill(mount,'duration','400 mètres');click(mount,'apply-mini');assert.match(mount.querySelector('.pe-mini .form-error').textContent,/durée/);
  assert.equal(changes(),1);cancel(mount);assert.deepEqual(editor.getDocument(),original);
});

test('repeat rows can be reordered and removed while keeping each row target and instruction',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-repeat');fill(mount,'repeat_count',2);
  let sequence=rows(mount);change(sequence[0].querySelector('[data-field=duration]'),'2min');change(sequence[0].querySelector('[data-field=description]'),'Première');effort(sequence[0],'zone',2);
  sequence=rows(mount);change(sequence[1].querySelector('[data-field=duration]'),'30s');change(sequence[1].querySelector('[data-field=description]'),'Deuxième');effort(sequence[1],'color',3);
  sequence[1].querySelector('[aria-label="Monter cette étape"]').click();sequence=rows(mount);
  assert.equal(sequence[0].querySelector('[data-field=description]').value,'Deuxième');assert.equal(sequence[0].querySelector('[data-field=effort-kind]').value,'color');
  sequence[1].querySelector('[aria-label="Supprimer cette étape"]').click();assert.equal(mount.querySelector('[aria-label="Supprimer cette étape"]').disabled,true);
  click(mount,'apply-mini');assert.equal(editor.getValue()[0].children.length,1);assert.equal(editor.getValue()[0].children[0].description,'Deuxième');assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,60);
});

test('the graph edits its source line without replacing free headings or neighbouring steps',()=>{
  const {editor,mount}=fixture({sport:'boxing'});write(editor,'Mon titre\n- Shadow 1min @ Z2 - Fluide\n\nDernière partie\n- Sac 2min');
  mount.querySelector('.session-chart-segment[role=button]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
  assert.equal(mount.querySelector('[name=block_title]').value,'Shadow');assert.equal(mount.querySelector('[name=block_description]').value,'Fluide');
  fill(mount,'duration','90s');fill(mount,'description','Relâcher les épaules');click(mount,'apply-mini');
  assert.equal(editor.getValue()[0].duration_seconds,90);assert.equal(editor.getValue()[1].duration_seconds,120);
  assert.match(editor.getDocument().text,/^Mon titre\n- Shadow/);assert.match(editor.getDocument().text,/Relâcher les épaules\n\nDernière partie\n- Sac 2min$/);
});

test('library insertion respects the captured cursor and its group boundaries',()=>{
  let calls=0;const {editor,mount}=fixture({sport:'running',onLibrary(){calls++;}});
  write(editor,'Avant\n\nAprès');editor.textInput.select('Avant\n\n'.length);click(mount,'library');assert.equal(calls,1);
  const block={...makeBlock('repeat'),repeat_count:2,children:[sessionStep('jog',{duration_seconds:60})]};editor.appendBlock(block);
  assert.match(editor.getDocument().text,/Avant\n\n2x\n- Jog 1min\n\nAprès/);assert.equal(editor.getValue()[0].repeat_count,2);
});

test('new nested groups are not offered and nested text produces a visible warning while preserving the text',()=>{
  const {editor,mount}=fixture({sport:'boxing'});click(mount,'add-repeat');
  assert.equal(mount.querySelectorAll('.pe-mini [data-action=add-repeat], .pe-mini [data-action=add-rounds]').length,0);
  assert.ok([...mount.querySelectorAll('.pe-tools button')].every(button=>button.disabled));cancel(mount);
  const source='2x\n- Sac 1min\n3x\n- Shadow 30s';write(editor,source);
  assert.match(mount.querySelector('.pe-text-status').textContent,/imbriqu/);assert.equal(editor.getDocument().text,source);assert.doesNotThrow(()=>editor.getValue());
  assert.ok(editor.getValue().every(block=>block.kind!=='repeat'||block.children.every(child=>child.kind==='step')));
});

test('help documents the agreed units, effort ranges, blank group boundary, final rest and formatting meaning',()=>{
  const {mount}=fixture();const help=mount.querySelector('.pe-help');assert.equal(help.open,false);
  for(const pattern of [/m signifie toujours minutes/,/400mtr/,/1'30"/,/120-150 bpm/,/5:30-6:30\/km/,/Z2-Z4/,/RPE 6\/10/,/Vert-Jaune/,/vraie ligne vide/,/dernier repos/,/Un seul niveau/,/sans bandes intermédiaires/,/colorier une phrase ne change pas l’effort/,/ligne juste avant le nombre/,/Shadow\n3 rounds\n- 3min/])assert.match(help.textContent,pattern);
  assert.equal(mount.querySelector('.pe-text-input').textContent,'');
});

test('opening and formatting a legacy round session never adds its historically omitted final rest',()=>{
  const original=sessionStep('bag',{title:'Travail du sac',rounds:3,work_seconds:60,rest_seconds:30,description:'Jab',notes:'Gants',repetitions:8,intensity:'hard',future:{target:'keep'}});
  const {editor,mount}=fixture({blocks:[original],notes:'Prévoir les gants.',sport:'boxing'});
  assert.deepEqual(editor.getValue(),[original]);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,240);
  const text=editor.getDocument().text;assert.match(text,/Prévoir les gants/);
  editor.textInput.select(0,'Prévoir les gants.'.length);mount.querySelector('[aria-label=Gras]').click();
  assert.deepEqual(editor.getValue(),[original]);assert.equal(editor.getDocument().text,text);assert.ok(editor.getDocument().marks.some(mark=>mark.bold));
  editor.setSport('running');assert.deepEqual(editor.getValue(),[original]);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,240);
});

test('legacy nested blocks and additional fields are preserved simply by opening the editor',()=>{
  const original={...makeBlock('repeat'),repeat_count:2,children:[sessionStep('bag',{duration_seconds:60,notes:'Garder',future:{x:2}}),{...makeBlock('repeat'),repeat_count:3,children:[sessionStep('run',{duration_seconds:30})]}]};
  const {editor}=fixture({blocks:[original],sport:'boxing'});assert.deepEqual(editor.getValue(),[original]);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,300);
});

test('formatting remains independent from effort and undo restores inserted text and its previous plan',()=>{
  const {editor,mount}=fixture({sport:'boxing'});write(editor,'Conseil important\n- Sac 3min @ RPE 6');const initial=editor.getValue();
  editor.textInput.select(0,'Conseil important'.length);mount.querySelector('[aria-label="Texte corail"]').click();mount.querySelector('[aria-label=Gras]').click();
  assert.deepEqual(editor.getValue(),initial);assert.ok(editor.getDocument().marks.some(mark=>mark.bold&&mark.color==='coral'));
  const styled=editor.getDocument();editor.textInput.select(styled.text.length);click(mount,'add-step');fill(mount,'duration','1min');click(mount,'apply-mini');
  assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,240);
  mount.querySelector('[aria-label="Annuler la modification"]').click();assert.deepEqual(editor.getDocument(),styled);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,180);
  mount.querySelector('[aria-label="Rétablir la modification"]').click();assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,240);
});

test('ambiguous names and entirely unspecified steps are rejected without writing partial text',()=>{
  const {editor,mount,changes}=fixture({sport:'boxing'});write(editor,'Consigne conservée');const original=editor.getDocument();click(mount,'add-step');fill(mount,'duration','1min');
  for(const name of ['3min','Sac @ Z3','Shadow - Relâcher']){
    fill(mount,'title',name);click(mount,'apply-mini');assert.ok(editor.mini,name);assert.equal(changes(),1);assert.equal(mount.querySelector('.pe-mini .form-error').hidden,false);
  }
  fill(mount,'title','');fill(mount,'format','free');fill(mount,'description','Jab et déplacement');click(mount,'apply-mini');
  assert.ok(editor.mini);assert.match(mount.querySelector('.pe-mini .form-error').textContent,/au moins un nom, une mesure ou un effort/);assert.equal(changes(),1);
  cancel(mount);assert.deepEqual(editor.getDocument(),original);
  click(mount,'add-step');fill(mount,'title','Shadow Boxing');fill(mount,'duration','1min');click(mount,'apply-mini');assert.equal(editor.mini,null);assert.equal(editor.getValue()[0].type,'shadow');
  editor.editStep(editor.getValue()[0].id);assert.equal(mount.querySelector('[data-field=title]').value,'Shadow Boxing');cancel(mount);
});
