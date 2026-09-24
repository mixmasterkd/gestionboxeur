import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { TrainingTextInput, normalizeTrainingDocument, renderTrainingDocument } from '../js/workout-rich-text.js';

const window=new Window({url:'http://localhost/'});
const document=window.document;
const source=(text,marks=[])=>({version:1,text,marks});
function fixture(doc=source('')) {
 document.body.replaceChildren();const node=document.createElement('div');document.body.append(node);
 const changes=[];const editor=new TrainingTextInput(node,doc,value=>changes.push(value));
 return {node,editor,changes};
}
function selectNodes(startNode,start,endNode=startNode,end=start) {
 const range=document.createRange();range.setStart(startNode,start);range.setEnd(endNode,end);
 const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
}
const input=node=>node.dispatchEvent(new window.Event('input',{bubbles:true}));

test('normalization keeps UTF16 emoji offsets, maps CRLF marks and ignores unsupported styles',()=>{
 const doc=normalizeTrainingDocument({text:'🥊\r\nSac',marks:[null,{start:4,end:7,bold:true,color:'mint',onclick:'unsafe'},{start:0,end:2,underline:true},{start:1.5,end:2,bold:true},{start:0,end:3,color:'red;position:absolute'}]});
 assert.deepEqual(doc,source('🥊\nSac',[{start:3,end:6,bold:true,color:'mint'},{start:0,end:2,underline:true}]));
});

test('renderer uses text nodes and approved styles, never HTML from the document',()=>{
 const node=document.createElement('div');renderTrainingDocument(node,source('<img src=x>\nImportant',[{start:0,end:11,bold:true,color:'coral'},{start:12,end:21,underline:true}]));
 assert.equal(node.textContent,'<img src=x>\nImportant');assert.equal(node.querySelector('img'),null);
 assert.equal(node.querySelector('[data-color=coral]').style.fontWeight,'700');assert.ok(node.querySelector('[data-underline=true]'));
});

test('formatting remains selected across a repaint that refocuses the editor',()=>{
 const {editor,node}=fixture(source('Un texte important'));editor.select(3,8);
 // Browsers may reset an old DOM range to the editor root after replaceChildren.
 node.focus=()=>{selectNodes(node,0);node.dispatchEvent(new window.Event('focus'));};
 assert.equal(editor.format('bold'),true);assert.deepEqual(editor.capture(),{start:3,end:8});
 editor.format('color','blue');assert.deepEqual(editor.capture(),{start:3,end:8});
 assert.deepEqual(editor.getValue().marks,[{start:3,end:8,bold:true,color:'blue'}]);
 editor.format('bold');assert.deepEqual(editor.getValue().marks,[{start:3,end:8,color:'blue'}]);
 editor.format('color',null);assert.deepEqual(editor.getValue().marks,[]);
});

test('selection offsets include native line breaks and block boundaries',()=>{
 const {editor,node}=fixture();node.innerHTML='Alpha<br>Beta<div>Gamma</div>';
 selectNodes(node.childNodes[2],2);input(node);
 assert.equal(editor.getValue().text,'Alpha\nBeta\nGamma');assert.deepEqual(editor.capture(),{start:8,end:8});
 selectNodes(node.lastChild.firstChild,0,node.lastChild.firstChild,5);
 editor.format('underline');assert.deepEqual(editor.getValue().marks,[{start:11,end:16,underline:true}]);
 assert.equal(window.getSelection().toString(),'Gamma');
});

test('native blank paragraphs remain separate and caret offsets follow the stored source',()=>{
 const {editor,node}=fixture();node.innerHTML='foo<div><br></div><div>bar</div>';
 selectNodes(node.lastChild.firstChild,2);input(node);
 assert.equal(editor.getValue().text,'foo\n\nbar');assert.deepEqual(editor.capture(),{start:7,end:7});
 node.innerHTML='<br>';selectNodes(node,0);input(node);assert.equal(editor.getValue().text,'');
});

test('paste inserts plain text at the selection, preserves surrounding styles and is undoable',()=>{
 const original=source('abcdef',[{start:0,end:6,bold:true,color:'mint'}]);
 const {editor,node}=fixture(original);editor.select(2,4);
 const event=new window.Event('paste',{bubbles:true,cancelable:true});
 Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/plain'?'X\r\nY':'<img src=x>'}});
 node.dispatchEvent(event);
 assert.equal(event.defaultPrevented,true);assert.equal(editor.getValue().text,'abX\nYef');assert.equal(node.querySelector('img'),null);
 assert.deepEqual(editor.getValue().marks,[{start:0,end:2,bold:true,color:'mint'},{start:5,end:7,bold:true,color:'mint'}]);
 assert.deepEqual(editor.capture(),{start:5,end:5});
 editor.undo();assert.deepEqual(editor.getValue(),original);assert.deepEqual(editor.capture(),{start:2,end:4});
 editor.undo(true);assert.equal(editor.getValue().text,'abX\nYef');assert.deepEqual(editor.capture(),{start:5,end:5});
});

test('undo after native typing restores the preceding caret, then redo restores the new caret',()=>{
 const {editor,node}=fixture(source('abcd'));editor.select(2);
 node.dispatchEvent(new window.InputEvent('beforeinput',{inputType:'insertText',data:'X',bubbles:true,cancelable:true}));
 node.firstChild.firstChild.nodeValue='abXcd';selectNodes(node.firstChild.firstChild,3);input(node);
 assert.equal(editor.getValue().text,'abXcd');editor.undo();
 assert.equal(editor.getValue().text,'abcd');assert.deepEqual(editor.capture(),{start:2,end:2});
 editor.undo(true);assert.equal(editor.getValue().text,'abXcd');assert.deepEqual(editor.capture(),{start:3,end:3});
});

test('Enter preserves a real empty line and formatting plus insertion can be undone independently',()=>{
 const {editor,node}=fixture(source('Sac'));editor.select(3);
 for(let i=0;i<2;i++) {
  const event=new window.InputEvent('beforeinput',{inputType:'insertParagraph',bubbles:true,cancelable:true});node.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 }
 editor.insert('Jog');assert.equal(editor.getValue().text,'Sac\n\nJog');
 editor.select(0,3);editor.format('bold');editor.undo();assert.equal(editor.getValue().text,'Sac\n\nJog');assert.deepEqual(editor.getValue().marks,[]);
 editor.undo();assert.equal(editor.getValue().text,'Sac\n\n');editor.undo();assert.equal(editor.getValue().text,'Sac\n');
});

test('source length limits reject a whole paste without silently truncating or shifting formatting',()=>{
 const original=source('a'.repeat(20000),[{start:19998,end:20000,color:'lavender'}]);
 const {editor,changes}=fixture(original);editor.select(20000);editor.insert('x');
 assert.deepEqual(editor.getValue(),original);assert.deepEqual(editor.capture(),{start:20000,end:20000});assert.equal(changes.length,0);
 const detached=editor.getValue();detached.marks[0].color='coral';assert.equal(editor.getValue().marks[0].color,'lavender');
 editor.select(19999,20000);editor.insert('🥊');assert.deepEqual(editor.getValue(),original);
});

test.after(async()=>{await window.happyDOM.abort();});
