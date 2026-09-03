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
  smoke?: {
    attempted: number;
    changed: number;
    labels: string[];
    fieldsAttempted: number;
    fieldsEditable: number;
    fieldLabels: string[];
    completedAt: number;
  };
  checkedAt: number;
}

/**
 * Auditoria leve executada dentro do iframe depois da montagem do React.
 * A auditoria automática apenas inspeciona o DOM. O smoke test, disparado
 * explicitamente pelo editor, percorre somente controles de navegação seguros
 * e comprova que campos visíveis aceitam edição. Nunca envia formulários,
 * dispara eventos de mudança nem aciona operações destrutivas.
 */
export function runtimeAuditSource(): string {
  return `
  var nxSmokeResult=null;
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
    Array.from(document.querySelectorAll('input[type="password"]')).filter(nxVisible).forEach(function(password){
      var overlay=password.parentElement;
      while(overlay&&overlay!==document.body){
        var overlayStyle=getComputedStyle(overlay), overlayRect=overlay.getBoundingClientRect();
        if(overlayStyle.position==='fixed'&&overlayRect.width>=window.innerWidth*.65&&overlayRect.height>=window.innerHeight*.65)break;
        overlay=overlay.parentElement;
      }
      if(!overlay||overlay===document.body)return;
      var publicContent=Array.from(document.querySelectorAll('main,header,section')).some(function(el){
        return !overlay.contains(el)&&nxVisible(el)&&String(el.innerText||'').trim().length>20;
      });
      var dismiss=Array.from(overlay.querySelectorAll('button,[role="button"]')).some(function(el){
        return nxVisible(el)&&/^(fechar|close|cancelar|voltar|×|x)$/i.test(nxControlLabel(el));
      });
      if(publicContent&&!dismiss)add('blocking_auth_overlay','error','O login está bloqueando conteúdo público sem controle visível para fechar.',overlay);
      var dialog=password.closest('form,[role="dialog"]')||password.parentElement;
      var dialogRect=dialog&&dialog.getBoundingClientRect();
      if(dialogRect&&(dialogRect.top < -8||dialogRect.bottom > window.innerHeight+8))add('clipped_auth_dialog','error','O formulário de login está cortado e não cabe na tela.',dialog);
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
    return {issues:issues,stats:{buttons:buttons.length,links:links.length,forms:forms.length,inputs:inputs.length,images:images.length},viewport:{width:window.innerWidth,height:window.innerHeight,overflowX:overflow},smoke:nxSmokeResult||undefined,checkedAt:Date.now()};
  }
  var nxAuditTimer=null;
  function nxPostAudit(){
    if(nxAuditTimer)clearTimeout(nxAuditTimer);
    nxAuditTimer=setTimeout(function(){try{_nxHost.postMessage({__nx_audit:nxRunAudit()},'*');}catch(e){}},250);
  }
  window.addEventListener('resize',nxPostAudit);
  function nxControlLabel(el){
    return String(el.innerText||el.getAttribute('aria-label')||el.getAttribute('title')||'').replace(/\\s+/g,' ').trim().slice(0,80);
  }
  function nxScreenSignature(){
    var root=document.getElementById('root');
    if(!root)return '';
    var headings=Array.from(root.querySelectorAll('h1,h2,[role="heading"]')).filter(nxVisible).map(nxControlLabel).join('|');
    var landmarks=Array.from(root.querySelectorAll('main,[data-testid$="-screen"],[role="main"]')).filter(nxVisible).map(function(el){return String(el.getAttribute('data-testid')||nxControlLabel(el)).slice(0,100);}).join('|');
    return (headings+'#'+landmarks+'#'+String(root.innerText||'').replace(/\\s+/g,' ').trim().slice(0,240)).slice(0,900);
  }
  function nxInteractionState(){
    return {
      screen:nxScreenSignature(),
      scroll:Math.max(0,Number(window.scrollY||document.documentElement.scrollTop||document.body&&document.body.scrollTop||0)),
      url:String(location.pathname||'')+String(location.search||'')+String(location.hash||'')
    };
  }
  function nxInteractionChanged(previous,next){
    return !!next.screen&&(next.screen!==previous.screen||next.url!==previous.url||Math.abs(next.scroll-previous.scroll)>16);
  }
  function nxSafeNavigationControls(){
    var destructive=/\\b(excluir|remover|apagar|deletar|delete|comprar|pagar|checkout|enviar|salvar|criar|adicionar|confirmar|sair|logout|cancelar|entrar|login|acessar|cadastro|cadastrar|conta)\\b/i;
    return Array.from(document.querySelectorAll('nav button,nav a,[role="navigation"] button,[role="navigation"] a,[role="tab"],header button,header a'))
      .filter(function(el){
        if(!nxVisible(el)||el.disabled||el.closest('form'))return false;
        var label=nxControlLabel(el);
        if(!label||destructive.test(label))return false;
        var props=nxReactProps(el), href=String(el.getAttribute('href')||'');
        return typeof props.onClick==='function'||href==='#'||href.indexOf('javascript:')===0;
      })
      .filter(function(el,index,list){
        var label=nxControlLabel(el).toLowerCase();
        return list.findIndex(function(item){return nxControlLabel(item).toLowerCase()===label;})===index;
      })
      .slice(0,12);
  }
  function nxWait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function nxFieldLabel(el){
    var id=String(el.id||''), label=id?document.querySelector('label[for="'+id.replace(/"/g,'')+'"]'):null;
    return String(label&&label.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('name')||el.tagName||'campo').replace(/\s+/g,' ').trim().slice(0,80);
  }
  function nxSafeEditableFields(){
    return Array.from(document.querySelectorAll('form input,form textarea,form select'))
      .filter(function(el){
        var type=String(el.getAttribute('type')||'text').toLowerCase();
        return nxVisible(el)&&!el.disabled&&!el.readOnly&&['hidden','password','file','submit','button','reset','image','checkbox','radio','color','range'].indexOf(type)<0;
      });
  }
  function nxProbeFields(seen,result){
    nxSafeEditableFields().forEach(function(el){
      var label=nxFieldLabel(el), key=String(el.tagName)+'#'+label.toLowerCase();
      if(seen[key])return; seen[key]=true;
      var original=String(el.value||''), sample='Teste AD Studio';
      var type=String(el.getAttribute('type')||'text').toLowerCase();
      if(el.tagName==='SELECT'){
        var option=Array.from(el.options||[]).find(function(item){return !item.disabled&&String(item.value)!==original;});
        if(!option)return; sample=String(option.value);
      }else if(type==='email')sample='qa+fluxo@adstudio.local';
      else if(type==='number')sample='1';
      else if(type==='date')sample='2026-01-15';
      else if(type==='datetime-local')sample='2026-01-15T10:00';
      else if(type==='month')sample='2026-01';
      else if(type==='time')sample='10:00';
      else if(type==='tel')sample='21999999999';
      else if(type==='url')sample='https://example.com';
      result.fieldsAttempted+=1; result.fieldLabels.push(label);
      try{
        el.value=sample;
        if(String(el.value||'')===sample)result.fieldsEditable+=1;
        el.value=original;
      }catch(e){try{el.value=original;}catch(ignore){}}
    });
  }
  async function nxRunSmoke(){
    var controls=nxSafeNavigationControls(), attempted=0, changed=0, labels=[];
    var fields={fieldsAttempted:0,fieldsEditable:0,fieldLabels:[]}, seenFields={};
    nxProbeFields(seenFields,fields);
    var previous=nxInteractionState();
    for(var index=0;index<controls.length;index++){
      var original=controls[index], label=nxControlLabel(original);
      var current=Array.from(document.querySelectorAll('button,a,[role="tab"]')).find(function(el){return nxVisible(el)&&nxControlLabel(el)===label;});
      if(!current)continue;
      attempted+=1; labels.push(label);
      try{current.click();}catch(e){}
      await nxWait(180);
      var next=nxInteractionState();
      if(nxInteractionChanged(previous,next))changed+=1;
      previous=next.screen?next:previous;
      nxProbeFields(seenFields,fields);
      if(document.querySelector('.nx-error'))break;
    }
    nxSmokeResult={attempted:attempted,changed:changed,labels:labels,fieldsAttempted:fields.fieldsAttempted,fieldsEditable:fields.fieldsEditable,fieldLabels:fields.fieldLabels.slice(0,20),completedAt:Date.now()};
    try{_nxHost.postMessage({__nx_audit:nxRunAudit()},'*');}catch(e){}
  }
  window.addEventListener('message',function(event){
    if(event.data&&event.data.__nx_run_smoke===true)nxRunSmoke();
  });
  `;
}
