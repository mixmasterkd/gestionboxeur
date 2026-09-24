import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makeBlock, summarizeBlocks } from '../js/domain.js';
import { parseTrainingText } from '../js/workout-document.js';

const window=new Window({url:'http://localhost/'});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','CustomEvent'])Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:window[name]});
globalThis.getComputedStyle=window.getComputedStyle.bind(window);
const {ProgramEditor}=await import('../js/program-editor.js');
const editors=[];
const step=values=>({...makeBlock('bag'),title:'Sac',...values});
function fixture(options={}){const mount=document.createElement('div');document.body.append(mount);const editor=new ProgramEditor(mount,options);editors.push(editor);return {editor,mount};}
function change(node,value){node.value=value;node.dispatchEvent(new window.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));}
test.afterEach(()=>{editors.splice(0).forEach(editor=>editor.destroy());document.body.replaceChildren();});
test.after(async()=>{await window.happyDOM.abort();});

test('editing a developed legacy round uses its duration, keeps extras and does not duplicate existing notes',()=>{
 const original=step({rounds:3,work_seconds:120,rest_seconds:60,description:'Jab',notes:'Gants légers',intensity:'hard',repetitions:12,future:{preserve:42}});
 const {editor,mount}=fixture({blocks:[original],sport:'boxing'});
 assert.deepEqual(editor.getValue(),[original]);const initialText=editor.getDocument().text,noteCount=initialText.split('Gants légers').length;
 editor.editStep(editor.result.blocks[0].id);
 assert.equal(mount.querySelector('[name=block_format]').value,'time');assert.equal(mount.querySelector('[name=block_duration]').value,"2'");
 assert.equal(mount.querySelector('[name=block_description]').value,'Jab');change(mount.querySelector('[name=block_duration]'),'1min');mount.querySelector('[data-action=apply-mini]').click();
 assert.equal(editor.mini,null);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,420);
 assert.deepEqual(editor.getValue()[0].future,{preserve:42});assert.equal(editor.getValue()[0].repetitions,12);assert.equal(editor.getValue()[0].notes,'Gants légers');
 assert.equal(editor.getDocument().text.split('Gants légers').length,noteCount);
 editor.textInput.undo();assert.deepEqual(editor.getValue(),[original]);assert.equal(editor.getDocument().text,initialText);
 editor.textInput.undo(true);assert.equal(summarizeBlocks(editor.getValue()).duration_seconds,420);assert.equal(editor.getValue()[0].future.preserve,42);
});

test('an existing source document opens without trying to serialize unrelated historical notes',()=>{
 const original=step({duration_seconds:60,notes:'- Jog 10min',future:{version:2}}),doc={version:1,text:'Mon texte\n- Sac 1min',marks:[{start:0,end:9,bold:true}]};
 const {editor}=fixture({blocks:[original],document:doc});assert.equal(editor.lockedReason,'');assert.deepEqual(editor.getValue(),[original]);
 editor.textInput.replace(0,0,'Un autre titre\n');assert.equal(editor.getValue()[0].id,original.id);assert.equal(editor.getValue()[0].notes,original.notes);assert.deepEqual(editor.getValue()[0].future,original.future);
});

test('old session notes that resemble new steps cannot silently change a workout',()=>{
 const original=step({duration_seconds:60}),notes='- Jog 10min';const {editor}=fixture({blocks:[original],notes});
 assert.ok(editor.lockedReason);assert.deepEqual(editor.getValue(),[original]);assert.equal(editor.getNotes(),notes);assert.equal(editor.getDocument(),null);
});

test('protected legacy sessions retain an already stored rich document during unrelated changes',()=>{
 const inner={...makeBlock('repeat'),repeat_count:100,children:[step({duration_seconds:1}),step({duration_seconds:2})]};
 const original={...makeBlock('repeat'),repeat_count:1,children:[inner]},doc={version:1,text:'Consignes conservées',marks:[{start:0,end:9,bold:true}]};
 const {editor}=fixture({blocks:[original],document:doc,notes:'Anciennes notes'});assert.ok(editor.lockedReason);
 assert.deepEqual(editor.getDocument(),doc);assert.deepEqual(editor.getValue(),[original]);assert.equal(editor.getNotes(),'Anciennes notes');
});

test('adding a group from inside another group preserves all of the original repetitions',()=>{
 const text='2x\n- Sac 1min\n- Shadow 30s\n\n- Marche 20s',blocks=parseTrainingText(text).blocks;
 const {editor}=fixture({blocks,document:{text,marks:[]},sport:'boxing'});
 const position=text.indexOf('Sac')+2;editor.textInput.selection={start:position,end:position};editor.insertFragment('3 rounds\n- Shadow 10s',true);
 const result=editor.getValue();assert.equal(result[0].repeat_count,2);assert.equal(result[0].children.length,2);assert.equal(result[1].repeat_count,3);assert.equal(result[2].type,'walk');
 assert.deepEqual(editor.textErrors,[]);assert.equal(summarizeBlocks(result).duration_seconds,230);
});

test('step insertion joins a current group and adding after a selection never deletes existing text',()=>{
 const text='2x\n- Sac 1min\n- Shadow 30s',blocks=parseTrainingText(text).blocks;
 const {editor}=fixture({blocks,document:{text,marks:[]}});const point=text.indexOf('Sac')+2;
 editor.textInput.selection={start:point,end:point};editor.insertFragment('- Corde 10s');assert.equal(editor.getValue()[0].children.length,3);
 const source=editor.document.text,start=source.indexOf('Sac')+1;editor.textInput.selection={start,end:start+2};editor.insertFragment('- Jog 20s');
 assert.deepEqual(editor.textErrors,[]);assert.deepEqual(editor.getValue()[0].children.map(block=>block.type),['bag','jog','jump_rope','shadow']);
 assert.equal(editor.getValue()[0].children[0].duration_seconds,60);assert.equal(editor.getValue()[0].children[1].duration_seconds,20);assert.ok(editor.document.text.includes('- Sac 1min'));
});

test('library insertion preserves metadata and gives repeated insertions independent IDs',()=>{
 const original=step({duration_seconds:60,notes:'Gants',repetitions:8,future:{keep:true}}),{editor}=fixture();
 editor.appendBlock(original);editor.appendBlock(original);const blocks=editor.getValue();assert.equal(blocks.length,2);assert.notEqual(blocks[0].id,blocks[1].id);
 for(const block of blocks){assert.equal(block.notes,'Gants');assert.equal(block.repetitions,8);assert.deepEqual(block.future,{keep:true});}
});

test('new rounds offer boxing and Other types only',()=>{
 const {editor,mount}=fixture({sport:'boxing'});editor.openMini('add-rounds');
 const values=Array.from(mount.querySelector('[name=repeat_type]').options).map(option=>option.value);
 assert.ok(values.includes('bag'));assert.ok(values.includes('other'));for(const value of ['run','walk','recovery','active_recovery'])assert.ok(!values.includes(value),value);
});
