export type RuntimeAuditSeverity = "error" | "warning";

export interface RuntimeAuditIssue {
  code: string;
  severity: RuntimeAuditSeverity;
  message: string;
  selector?: string;
}

export interface RuntimeAuditReport {
  issues: RuntimeAuditIssue[];
  stats: {
    buttons: number;
    links: number;
    forms: number;
    inputs: number;
    images: number;
  };
  viewport: { width: number; height: number; overflowX: number };
  checkedAt: number;
}

/**
 * Auditoria leve executada dentro do iframe depois da montagem do React.
 * Não clica nem envia formulários: inspeciona o DOM e os handlers registrados
 * pelo React, evitando efeitos destrutivos ou chamadas duplicadas ao backend.
 */
export function runtimeAuditSource(): string {
  return `
  function nxReactProps(el){
    try { var key=Object.keys(el).find(function(name){return name.indexOf('__reactProps$')===0;}); return key?el[key]||{}:{}; }
    catch(e){ return {}; }
  }
  function nxSelector(el){
    if(!el)return '';
    if(el.id)return '#'+String(el.id).replace(/[^a-zA-Z0-9_-]/g,'');
    var name=String(el.tagName||'element').toLowerCase();
    var label=String(el.getAttribute&&el.getAttribute('aria-label')||'').trim();
    return label?name+'[aria-label="'+label.slice(0,60).replace(/"/g,'')+'"]':name;
  }
  function nxVisible(el){
    if(!el)return false;
    var style=getComputedStyle(el), rect=el.getBoundingClientRect();
    return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
  }
  function nxRunAudit(){
    var issues=[], root=document.getElementById('root');
    function add(code,severity,message,el){
      if(issues.some(function(item){return item.code===code&&item.message===message;}))return;
      var issue={code:code,severity:severity,message:message};
      var selector=nxSelector(el); if(selector)issue.selector=selector; issues.push(issue);
    }
    var buttons=Array.from(document.querySelectorAll('button'));
    var links=Array.from(document.querySelectorAll('a'));
    var forms=Array.from(document.querySelectorAll('form'));
    var inputs=Array.from(document.querySelectorAll('input,select,textarea'));
    var images=Array.from(document.querySelectorAll('img'));
    var text=root?String(root.innerText||'').replace(/\\s+/g,' ').trim():'';
    var visual=root&&root.querySelector('img,video,canvas,svg,[role="img"]');
    if(!root||(!text&& !visual))add('empty_screen','error','A tela ficou vazia depois da montagem.',root);
    if(root&&root.querySelector('.nx-error'))add('runtime_error_screen','error','O preview exibiu a tela interna de erro.',root);
    links.forEach(function(link){
      var href=String(link.getAttribute('href')||'').trim();
      if(/^\\/(?!\\/)/.test(href))add('internal_href_navigation','error','Link interno usa URL '+href+'; neste runtime a navegação deve usar estado React.',link);
      if((!href||href==='#')&&!nxReactProps(link).onClick)add('inert_link','warning','Existe um link visível sem destino nem ação.',link);
    });
    buttons.forEach(function(button){
      if(!nxVisible(button)||button.disabled)return;
      var props=nxReactProps(button);
      var type=String(button.getAttribute('type')||'submit').toLowerCase();
      var form=button.closest('form');
      var formProps=form?nxReactProps(form):{};
      var actionable=typeof props.onClick==='function'||(form&&type==='submit'&&(typeof formProps.onSubmit==='function'||!!form.getAttribute('action')));
      if(!actionable)add('inert_button','warning','Botão visível sem ação detectável: '+String(button.innerText||button.getAttribute('aria-label')||'sem rótulo').trim().slice(0,80),button);
      if(!String(button.innerText||'').trim()&&!button.getAttribute('aria-label')&&!button.getAttribute('title'))add('unlabeled_button','warning','Botão sem texto ou rótulo acessível.',button);
    });
    inputs.forEach(function(input){
      if(!nxVisible(input)||input.getAttribute('type')==='hidden')return;
      var id=input.id, labelled=id&&document.querySelector('label[for="'+String(id).replace(/"/g,'')+'"]');
      if(!labelled&&!input.getAttribute('aria-label')&&!input.getAttribute('aria-labelledby')&&!input.getAttribute('placeholder'))add('unlabeled_field','warning','Campo de formulário sem identificação visível ou acessível.',input);
    });
    forms.forEach(function(form){
      var props=nxReactProps(form);
      var submit=form.querySelector('button[type="submit"],button:not([type]),input[type="submit"]');
      if(typeof props.onSubmit!=='function'&&!form.getAttribute('action')&&!submit)add('incomplete_form','warning','Formulário sem envio ou botão de continuação detectável.',form);
    });
    images.forEach(function(image){
      if(image.complete&&image.naturalWidth===0)add('broken_image','warning','Imagem não carregou: '+String(image.getAttribute('alt')||image.getAttribute('src')||'imagem').slice(0,100),image);
      if(!image.getAttribute('alt'))add('missing_image_alt','warning','Imagem sem texto alternativo.',image);
    });
    var seen={};
    Array.from(document.querySelectorAll('[id]')).forEach(function(el){var id=el.id;if(seen[id])add('duplicate_id','warning','O identificador #'+id+' aparece mais de uma vez.',el);seen[id]=true;});
    var overflow=Math.max(0,document.documentElement.scrollWidth-window.innerWidth);
    if(window.innerWidth<=500&&overflow>8)add('mobile_overflow','error','O layout ultrapassa a largura mobile em '+overflow+'px.',root);
    if(!document.querySelector('h1,h2,[role="heading"]'))add('missing_heading','warning','A tela não possui título semântico.',root);
    return {issues:issues,stats:{buttons:buttons.length,links:links.length,forms:forms.length,inputs:inputs.length,images:images.length},viewport:{width:window.innerWidth,height:window.innerHeight,overflowX:overflow},checkedAt:Date.now()};
  }
  var nxAuditTimer=null;
  function nxPostAudit(){
    if(nxAuditTimer)clearTimeout(nxAuditTimer);
    nxAuditTimer=setTimeout(function(){try{_nxHost.postMessage({__nx_audit:nxRunAudit()},'*');}catch(e){}},250);
  }
  window.addEventListener('resize',nxPostAudit);
  `;
}
