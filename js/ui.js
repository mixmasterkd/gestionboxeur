export const $ = id => document.getElementById(id);
export function el(tag, attrs={}, ...children) {
  const node=document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if(value===undefined || value===null) continue;
    if(key==='class') node.className=value;
    else if(key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if(key==='dataset') Object.assign(node.dataset,value);
    else if(key in node && !key.startsWith('aria')) node[key]=value;
    else node.setAttribute(key,value);
  }
  node.append(...children.flat().filter(v=>v!==null && v!==undefined)); return node;
}
export function button(text, action, className='button secondary', attrs={}) { return el('button',{type:'button',class:className,onclick:action,...attrs},text); }
export function field(label, control, hint='') { return el('label',{class:'form-field'},el('span',{},label),control,hint?el('small',{class:'muted'},hint):null); }
export function input(name,value='',type='text',attrs={}) { return el('input',{type,name,value:value??'',...attrs}); }
export function textarea(name,value='',attrs={}) { return el('textarea',{name,value:value??'',rows:3,...attrs}); }
export function select(name,options,value,attrs={}) { const s=el('select',{name,...attrs},options.map(o=>el('option',{value:o.value},o.label)));s.value=value;return s; }
export function heading(title,eyebrow,dialog,id) { return el('header',{class:'dialog-heading'},el('div',{},el('p',{class:'eyebrow'},eyebrow),el('h2',{id},title)),button('×',()=>dialog.close(),'close-button',{'aria-label':'Fermer'})); }
export function errorBox(){return el('p',{class:'form-error',role:'alert',hidden:true});}
export function showError(node,error){ node.textContent=error?.message||String(error);node.hidden=false; }
let toastTimer;
export function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
export async function busy(button,fn){const label=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');try{return await fn();}finally{button.disabled=false;button.textContent=label;button.removeAttribute('aria-busy');}}
export function confirmAction(title,text,label='Confirmer') {
  return new Promise(resolve=>{ const d=$('confirmDialog');$('confirmTitle').textContent=title;$('confirmText').textContent=text;$('confirmYes').textContent=label;d.returnValue='cancel';d.addEventListener('close',()=>resolve(d.returnValue==='confirm'),{once:true});d.showModal(); });
}
export function displayName(a){return [a?.first_name,a?.last_name].filter(Boolean).join(' ')||'Athlète';}
export function initials(a){return [a?.first_name?.[0],a?.last_name?.[0]].filter(Boolean).join('').toUpperCase()||'A';}
