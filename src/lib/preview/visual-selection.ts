export interface PreviewElementSelection {
  tag: string;
  label: string;
  text: string;
  selector: string;
  role: string;
  nearbyText: string;
}

function clean(value: unknown, max = 240): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizePreviewSelection(value: unknown): PreviewElementSelection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const tag = clean(raw.tag, 40).toLowerCase();
  const selector = clean(raw.selector, 300);
  if (!tag || !selector) return null;
  return {
    tag,
    selector,
    label: clean(raw.label, 160) || clean(raw.text, 160) || tag,
    text: clean(raw.text),
    role: clean(raw.role, 80),
    nearbyText: clean(raw.nearbyText, 360),
  };
}

export function buildVisualSelectionContext(selection: PreviewElementSelection): string {
  const details = [
    `Elemento selecionado no preview: <${selection.tag}>`,
    `Identificação aproximada: ${selection.selector}`,
    selection.role ? `Função: ${selection.role}` : "",
    selection.text ? `Texto do elemento: "${selection.text}"` : "",
    selection.nearbyText ? `Contexto visual próximo: "${selection.nearbyText}"` : "",
    "Altere somente este elemento ou o componente que o contém. Preserve o restante do projeto e use edição cirúrgica em ops.",
  ].filter(Boolean);
  return `[CONTEXTO DA SELEÇÃO VISUAL]\n${details.join("\n")}\n[FIM DO CONTEXTO]`;
}

/**
 * Executado somente no preview autenticado do editor. O modo começa desligado
 * e só intercepta cliques depois de uma ordem explícita da interface.
 */
export function visualSelectionSource(): string {
  return `
(function(){
  var nxVisualEnabled=false, nxVisualHover=null, nxVisualSelected=null;
  var nxVisualStyle=document.createElement('style');
  nxVisualStyle.textContent='[data-nx-visual-hover]{outline:2px dashed #7c3aed!important;outline-offset:2px!important;cursor:crosshair!important}[data-nx-visual-selected]{outline:3px solid #7c3aed!important;outline-offset:2px!important}';
  document.head.appendChild(nxVisualStyle);
  function nxClear(attr, el){if(el&&el.removeAttribute)el.removeAttribute(attr);}
  function nxEligible(el){
    if(!el||!el.tagName)return null;
    if(el.closest&&el.closest('.nx-error'))return null;
    var tag=String(el.tagName).toLowerCase();
    if(tag==='html'||tag==='body'||tag==='script'||tag==='style')return null;
    return el;
  }
  function nxText(el,limit){
    var text=String((el&&el.innerText)||'').replace(/\\s+/g,' ').trim();
    return text.slice(0,limit||240);
  }
  function nxSelector(el){
    var tag=String(el.tagName||'element').toLowerCase();
    if(el.id)return tag+'#'+String(el.id).replace(/[^a-zA-Z0-9_-]/g,'');
    var test=el.getAttribute&&el.getAttribute('data-testid');
    if(test)return tag+'[data-testid="'+String(test).replace(/"/g,'')+'"]';
    var classes=String(el.className||'').split(/\\s+/).filter(function(name){
      return name&&name.length<48&&!/[:\\[\\]\\/]/.test(name);
    }).slice(0,3);
    var descriptor=tag+(classes.length?'.'+classes.join('.'):'');
    var parent=el.parentElement;
    if(parent){
      var siblings=Array.from(parent.children||[]).filter(function(item){return item.tagName===el.tagName;});
      if(siblings.length>1)descriptor+=':nth-of-type('+(siblings.indexOf(el)+1)+')';
    }
    return descriptor.slice(0,300);
  }
  function nxDescribe(el){
    var container=el.closest&&el.closest('section,article,header,footer,nav,form,li,[role="dialog"],[role="region"]');
    var alt=el.getAttribute&&el.getAttribute('alt');
    var aria=el.getAttribute&&el.getAttribute('aria-label');
    var title=el.getAttribute&&el.getAttribute('title');
    var own=nxText(el,240);
    return {
      tag:String(el.tagName||'').toLowerCase(),
      selector:nxSelector(el),
      role:String((el.getAttribute&&el.getAttribute('role'))||''),
      text:own,
      label:String(aria||alt||title||own||el.tagName||'elemento').slice(0,160),
      nearbyText:nxText(container||el.parentElement,360)
    };
  }
  function nxSetMode(enabled){
    nxVisualEnabled=!!enabled;
    if(!nxVisualEnabled){
      nxClear('data-nx-visual-hover',nxVisualHover);nxVisualHover=null;
    }
    document.documentElement.style.cursor=nxVisualEnabled?'crosshair':'';
  }
  window.addEventListener('message',function(event){
    var data=event.data;
    if(event.source!==_nxHost||!data||data.__nx_visual_mode!==true)return;
    nxSetMode(data.enabled);
  });
  document.addEventListener('pointerover',function(event){
    if(!nxVisualEnabled)return;
    var el=nxEligible(event.target);if(!el)return;
    nxClear('data-nx-visual-hover',nxVisualHover);
    nxVisualHover=el;el.setAttribute('data-nx-visual-hover','');
  },true);
  document.addEventListener('click',function(event){
    if(!nxVisualEnabled)return;
    var el=nxEligible(event.target);if(!el)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    nxClear('data-nx-visual-selected',nxVisualSelected);
    nxClear('data-nx-visual-hover',nxVisualHover);
    nxVisualSelected=el;el.setAttribute('data-nx-visual-selected','');
    nxSetMode(false);
    try{_nxHost.postMessage({__nx_visual_selected:true,selection:nxDescribe(el)},'*');}catch(error){}
  },true);
})();`;
}
