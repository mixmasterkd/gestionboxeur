import { createMenuPanelLayout } from './menu-panel-layout.js';

/** Calendar selection uses the same reversible drawer as the navigation menus. */
export function mountCalendarMenu({dialog,trigger,search,beforeOpen}) {
  const doc=dialog.ownerDocument,view=doc.defaultView;
  const layout=createMenuPanelLayout({dialog,trigger,onDismiss:()=>close(),placement:'below-trigger'});
  const position=()=>{if(dialog.open)layout.position();};
  function sync(){if(!dialog.open)layout.close();trigger.setAttribute('aria-expanded',String(dialog.open));trigger.classList.toggle('is-open',dialog.open);}
  function close({restoreFocus=true}={}){
    layout.close();
    if(!dialog.open)return;
    dialog.close();sync();
    if(restoreFocus&&trigger.isConnected)trigger.focus({preventScroll:true});
  }
  function toggle(){
    if(dialog.open){close();return;}
    if(beforeOpen()===false)return;
    dialog.show();sync();position();
    // Avoid opening the software keyboard before a mobile user chooses to search.
    (view.innerWidth<=800?dialog.querySelector('h2'):search).focus({preventScroll:true});
  }
  const outside=e=>{if(dialog.open&&!dialog.contains(e.target)&&!trigger.contains(e.target)&&!e.target.closest?.('.menu-drawer-dismiss'))close({restoreFocus:false});};
  const key=e=>{if(dialog.open&&!e.defaultPrevented&&e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
  const scroll=e=>{if(!dialog.contains(e.target))position();};
  dialog.querySelector('h2').tabIndex=-1;
  trigger.addEventListener('click',toggle);dialog.addEventListener('close',sync);
  doc.addEventListener('pointerdown',outside);doc.addEventListener('focusin',outside);doc.addEventListener('keydown',key);doc.addEventListener('scroll',scroll,true);
  view.addEventListener('resize',position);view.visualViewport?.addEventListener('resize',position);view.visualViewport?.addEventListener('scroll',position);
  sync();
  return {close,destroy(){close({restoreFocus:false});layout.destroy();trigger.removeEventListener('click',toggle);dialog.removeEventListener('close',sync);doc.removeEventListener('pointerdown',outside);doc.removeEventListener('focusin',outside);doc.removeEventListener('keydown',key);doc.removeEventListener('scroll',scroll,true);view.removeEventListener('resize',position);view.visualViewport?.removeEventListener('resize',position);view.visualViewport?.removeEventListener('scroll',position);}};
}
