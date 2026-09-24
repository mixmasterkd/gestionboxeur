/** Limited rich text represented as plain text plus safe, positional marks. */
export const TRAINING_COLORS = ['blue','mint','coral','lavender'];
export function normalizeTrainingDocument(value) {
  const source = String(value?.text || ''),text=source.replace(/\r\n?/g,'\n');
  const normalizedOffset=source.includes('\r')?offset=>source.slice(0,offset).replace(/\r\n?/g,'\n').length:offset=>offset;
  const marks = (Array.isArray(value?.marks) ? value.marks : []).slice(0,2000).flatMap(mark => {
    if(!mark||typeof mark!=='object'||!Number.isInteger(mark.start)||!Number.isInteger(mark.end))return [];
    const start=normalizedOffset(Math.max(0,Math.min(source.length,mark.start))),end=normalizedOffset(Math.max(0,Math.min(source.length,mark.end)));
    if(end<=start)return [];
    const style={...(mark.bold===true?{bold:true}:{}),...(mark.underline===true?{underline:true}:{}),...(TRAINING_COLORS.includes(mark.color)?{color:mark.color}:{})};
    return Object.keys(style).length?[{start,end,...style}]:[];
  });
  return {version:1,text,marks};
}
function pieces(doc) {
  const points=[...new Set([0,doc.text.length,...doc.marks.flatMap(m=>[m.start,m.end])])].sort((a,b)=>a-b);
  return points.slice(0,-1).map((start,i)=>({start,end:points[i+1],style:doc.marks.filter(m=>m.start<=start&&m.end>start).reduce((s,m)=>({...s,...(m.bold?{bold:true}:{}),...(m.underline?{underline:true}:{}),...(m.color?{color:m.color}:{})}),{})}));
}
export function renderTrainingDocument(container, value) {
  const doc=normalizeTrainingDocument(value);container.replaceChildren();container.classList.add('training-document');
  for(const piece of pieces(doc)) {
    const node=container.ownerDocument.createElement('span');node.textContent=doc.text.slice(piece.start,piece.end);
    if(piece.style.bold){node.dataset.bold='true';node.style.fontWeight='700';}
    if(piece.style.underline){node.dataset.underline='true';node.style.textDecoration='underline';}
    if(piece.style.color){node.dataset.color=piece.style.color;node.classList.add(`training-color-${piece.style.color}`);}
    container.append(node);
  }
}
function readEditable(root,emptyPlaceholder=true) {
  let text='';const marks=[];
  const visit=(node,style={})=>{
    if(node.nodeType===3){const start=text.length;text+=node.nodeValue;if(Object.keys(style).length&&text.length>start)marks.push({start,end:text.length,...style});return;}
    if(node.nodeType!==1)return;
    if(node.tagName==='BR'){text+='\n';return;}
    if(['DIV','P'].includes(node.tagName)&&text&&!text.endsWith('\n'))text+='\n';
    const next={...style,...(node.dataset.bold==='true'?{bold:true}:{}),...(node.dataset.underline==='true'?{underline:true}:{}),...(TRAINING_COLORS.includes(node.dataset.color)?{color:node.dataset.color}:{})};
    for(const child of node.childNodes)visit(child,next);
  };
  if(emptyPlaceholder&&root.childNodes.length===1&&root.firstChild.nodeName==='BR')return {version:1,text:'',marks:[]};
  for(const node of root.childNodes)visit(node);
  return normalizeTrainingDocument({text,marks});
}
export class TrainingTextInput {
  constructor(node,doc,onChange) {
    this.node=node;this.document=normalizeTrainingDocument(doc);this.onChange=onChange;this.history=[];this.future=[];this.selection={start:this.document.text.length,end:this.document.text.length};
    node.contentEditable='true';node.setAttribute('role','textbox');node.setAttribute('aria-multiline','true');node.setAttribute('aria-label','Texte de l’entraînement');node.spellcheck=false;this.paint();
    node.addEventListener('input',()=>{const previous=this.beforeInputSelection||{...this.selection},selection=this.capture();this.beforeInputSelection=null;this.commit(readEditable(node),selection,false,previous);});
    node.addEventListener('beforeinput',event=>{
      this.beforeInputSelection=this.capture();
      if(['insertParagraph','insertLineBreak'].includes(event.inputType)){event.preventDefault();this.insert('\n');this.beforeInputSelection=null;}
      if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();this.undo(event.inputType==='historyRedo');this.beforeInputSelection=null;}
    });
    node.addEventListener('paste',event=>{event.preventDefault();this.insert(event.clipboardData?.getData('text/plain')||'');});
    node.addEventListener('drop',event=>event.preventDefault());
    node.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();this.undo(event.key.toLowerCase()==='y'||event.shiftKey);}if((event.ctrlKey||event.metaKey)&&['b','u'].includes(event.key.toLowerCase())){event.preventDefault();this.format(event.key.toLowerCase()==='b'?'bold':'underline');}});
    for(const name of ['keyup','mouseup','focus','touchend'])node.addEventListener(name,()=>this.capture());
  }
  capture(){
    const selection=this.node.ownerDocument.defaultView.getSelection();
    if(selection?.rangeCount){const range=selection.getRangeAt(0);if(this.node.contains(range.startContainer)&&this.node.contains(range.endContainer)){const a=range.cloneRange();a.selectNodeContents(this.node);a.setEnd(range.startContainer,range.startOffset);const b=range.cloneRange();b.selectNodeContents(this.node);b.setEnd(range.endContainer,range.endOffset);this.selection={start:readEditable(a.cloneContents(),false).text.length,end:readEditable(b.cloneContents(),false).text.length};}}
    return {...this.selection};
  }
  select(start,end=start){
    start=Math.max(0,Math.min(this.document.text.length,start));end=Math.max(start,Math.min(this.document.text.length,end));
    this.selection={start,end};const d=this.node.ownerDocument,range=d.createRange();let offset=0,a=null,b=null;
    const walk=d.createTreeWalker(this.node,4);let node;
    while((node=walk.nextNode())){const length=node.nodeValue.length;if(!a&&start<=offset+length)a=[node,Math.max(0,start-offset)];if(!b&&end<=offset+length)b=[node,Math.max(0,end-offset)];offset+=length;}
    if(!a){range.selectNodeContents(this.node);range.collapse(false);}else{range.setStart(...a);range.setEnd(...(b||a));}
    const selection=d.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  paint(focus=false){const selection={...this.selection};renderTrainingDocument(this.node,this.document);if(focus){this.node.focus();this.select(selection.start,selection.end);}}
  commit(doc,selection=this.selection,paint=true,previousSelection=this.selection){
    const next=normalizeTrainingDocument(doc);if(next.text.length>20000){this.paint(true);return;}
    if(JSON.stringify(next)===JSON.stringify(this.document))return;
    this.history.push({document:structuredClone(this.document),selection:{...previousSelection}});if(this.history.length>100)this.history.shift();this.future=[];this.document=next;this.selection=selection;if(paint)this.paint(true);this.onChange(this.getValue());
  }
  getValue(){return structuredClone(this.document);}
  setValue(doc){this.document=normalizeTrainingDocument(doc);this.selection={start:this.document.text.length,end:this.document.text.length};this.history=[];this.future=[];this.paint();}
  replace(start,end,text){
    text=String(text).replace(/\r\n?/g,'\n');
    const old=this.document,delta=text.length-(end-start),marks=[];
    for(const mark of old.marks){if(mark.end<=start)marks.push(mark);else if(mark.start>=end)marks.push({...mark,start:mark.start+delta,end:mark.end+delta});else{if(mark.start<start)marks.push({...mark,end:start});if(mark.end>end)marks.push({...mark,start:start+text.length,end:mark.end+delta});}}
    this.commit({text:old.text.slice(0,start)+text+old.text.slice(end),marks},{start:start+text.length,end:start+text.length});
  }
  insert(text){const {start,end}=this.capture();this.replace(start,end,text);}
  format(key,value){
    const {start,end}=this.capture();if(start===end)return false;
    const doc=this.document,segments=pieces({...doc,marks:[...doc.marks,{start,end}]}),selected=segments.filter(p=>p.start>=start&&p.end<=end),enable=key==='color'?value:!selected.every(p=>p.style[key]);
    const marks=segments.flatMap(p=>{const style={...p.style};if(p.start>=start&&p.end<=end){if(enable)style[key]=enable;else delete style[key];}return Object.keys(style).length?[{start:p.start,end:p.end,...style}]:[];});
    this.commit({text:doc.text,marks},{start,end});return true;
  }
  undo(redo=false){const from=redo?this.future:this.history,to=redo?this.history:this.future,item=from.pop();if(!item)return;to.push({document:this.getValue(),selection:{...this.selection}});this.document=item.document;this.selection=item.selection;this.paint(true);this.onChange(this.getValue());}
}
