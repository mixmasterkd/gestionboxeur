import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { openDialog } from '../js/ui.js';

function fixture(mobile) {
  const window=new Window();window.matchMedia=()=>({matches:mobile});
  const document=window.document;document.body.innerHTML='<dialog><h2>Choisir un calendrier</h2><input type="search" autofocus></dialog>';
  const dialog=document.querySelector('dialog'),title=document.querySelector('h2'),input=document.querySelector('input');
  let initialFocus;
  dialog.showModal=()=>{dialog.open=true;initialFocus=dialog.querySelector('[autofocus]')||input;initialFocus.focus();};
  return {window,document,dialog,title,input,initialFocus:()=>initialFocus};
}
test('mobile dialogs choose their heading before opening and leave fields available for deliberate focus',async()=>{
  const f=fixture(true);try {
    openDialog(f.dialog,f.input);assert.equal(f.initialFocus(),f.title);assert.equal(f.document.activeElement,f.title);
    assert.equal(f.input.hasAttribute('autofocus'),true);assert.equal(f.title.hasAttribute('autofocus'),false);
    f.input.focus();assert.equal(f.document.activeElement,f.input);
  }finally{await f.window.happyDOM.abort();}
});
test('desktop dialogs keep the convenient requested field focus',async()=>{
  const f=fixture(false);try {openDialog(f.dialog,f.input);assert.equal(f.document.activeElement,f.input);}
  finally{await f.window.happyDOM.abort();}
});
test('replacing the contents of an open mobile dialog returns focus to the new heading',async()=>{
  const f=fixture(true);try {
    f.dialog.open=true;f.input.focus();openDialog(f.dialog,f.input);
    assert.equal(f.document.activeElement,f.title);assert.equal(f.initialFocus(),undefined);
  }finally{await f.window.happyDOM.abort();}
});
