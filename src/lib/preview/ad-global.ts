/**
 * Script injetado no iframe do app gerado que expõe `window.AD` — a camada de
 * dados/persistência embutida do AD Studio. Fala com /api/data/[projectId]
 * (mesmo origin, escopado por projeto). É o "backend" que os apps usam para
 * salvar dados de verdade, tanto no preview quanto no app publicado.
 */
export function adGlobalScript(
  projectId?: string | null,
  opts?: { admin?: boolean }
): string {
  const pid = JSON.stringify(projectId || "");
  const adminFlag = opts?.admin ? "true" : "false";
  return `<script>
(function(){
  var PID = ${pid};
  var HOST = window.parent, bridgeSeq = 0, pending = {};
  window.addEventListener('message', function(e){
    var d=e.data; if(e.source!==HOST || !d || d.__ad_bridge_result!==true || !pending[d.id]) return;
    var p=pending[d.id]; delete pending[d.id];
    if(d.ok) p.resolve(d.payload||{}); else {
      var error=new Error(d.error||('AD '+(d.status||500)));
      if(d.payload&&d.payload.fieldErrors)error.fieldErrors=d.payload.fieldErrors;
      error.status=d.status||500;
      p.reject(error);
    }
  });
  function bridge(kind, opts){ opts=opts||{}; var id='ad-'+Date.now()+'-'+(++bridgeSeq);
    return new Promise(function(resolve,reject){ pending[id]={resolve:resolve,reject:reject};
      HOST.postMessage({__ad_bridge:true,id:id,projectId:PID,kind:kind,method:opts.method||'GET',qs:opts.qs||'',body:opts.body,file:opts.file,fileName:opts.fileName},'*');
      setTimeout(function(){if(!pending[id])return;delete pending[id];reject(new Error('O backend do app demorou para responder.'));},30000);
    });
  }
  function noop(){ return Promise.resolve(); }
  // Guarda as funções nativas antes que apps antigos tentem alterá-las. No
  // Safari/macOS, chamar cancel() e speak() no mesmo instante pode silenciar a
  // nova fala; o pequeno intervalo abaixo deixa a fila realmente ser liberada.
  var voiceSynth=window.speechSynthesis;
  var nativeVoiceSpeak=voiceSynth&&typeof voiceSynth.speak==='function'?voiceSynth.speak.bind(voiceSynth):null;
  var nativeVoiceCancel=voiceSynth&&typeof voiceSynth.cancel==='function'?voiceSynth.cancel.bind(voiceSynth):null;
  var nativeVoiceResume=voiceSynth&&typeof voiceSynth.resume==='function'?voiceSynth.resume.bind(voiceSynth):function(){};
  var voiceRun=0, voiceCancelGeneration=0, lastVoiceCancel=0, legacyVoiceQueue=[], legacyVoiceTimer=null;
  // O Chrome costuma listar uma voz compacta antes das vozes naturais da Apple.
  // Ranqueamos por idioma e qualidade para manter a pronúncia próxima à do Safari.
  function normalizedVoiceLang(value){return String(value||'').toLowerCase().replace('_','-');}
  function voiceQualityScore(voice, requestedLang){
    if(!voice)return -100000;
    var requested=normalizedVoiceLang(requestedLang||'pt-BR');
    var requestedBase=requested.split('-')[0];
    var language=normalizedVoiceLang(voice.lang);
    var languageBase=language.split('-')[0];
    if(languageBase!==requestedBase)return -100000;
    var name=String(voice.name||'').toLowerCase();
    var score=language===requested?1000:600;
    if(voice.localService)score+=180;
    if(voice.default)score+=30;
    if(/enhanced|premium|natural|neural/.test(name))score+=180;
    if(/samantha|ava|allison|alex|victoria|karen|daniel|serena|tessa|fiona|moira|luciana|joana|felipe/.test(name))score+=150;
    if(/google.*(english|portugu|brazil)|microsoft.*natural/.test(name))score+=80;
    if(/compact|eloquence|novelty|zarvox|trinoids|whisper|boing|bubbles|cellos|organ|bells|bad news|good news/.test(name))score-=600;
    return score;
  }
  function applyPreferredVoice(utterance){
    if(!utterance||utterance.voice||!voiceSynth||typeof voiceSynth.getVoices!=='function')return;
    try {
      var voices=Array.from(voiceSynth.getVoices()||[]);
      var best=null, bestScore=-100000;
      voices.forEach(function(voice){var score=voiceQualityScore(voice,utterance.lang);if(score>bestScore){best=voice;bestScore=score;}});
      if(best&&bestScore>-100000)utterance.voice=best;
    } catch(e){}
  }
  try { if(voiceSynth&&typeof voiceSynth.getVoices==='function')voiceSynth.getVoices(); } catch(e){}
  function cancelLocalVoice(){
    voiceRun++; voiceCancelGeneration++; lastVoiceCancel=Date.now();
    if(legacyVoiceTimer)clearTimeout(legacyVoiceTimer);
    legacyVoiceTimer=null; legacyVoiceQueue=[];
    if(nativeVoiceCancel)nativeVoiceCancel();
  }
  function playLocalUtterance(utterance, onPlayed, onError){
    if(!voiceSynth||!nativeVoiceSpeak){ if(onError)onError(new Error('Leitura em voz alta não disponível neste navegador.')); return; }
    var run=++voiceRun;
    var mustReset=!!(voiceSynth.speaking||voiceSynth.pending||voiceSynth.paused);
    if(mustReset)cancelLocalVoice();
    run=++voiceRun;
    var elapsed=Date.now()-lastVoiceCancel;
    var delay=(mustReset||elapsed<120)?Math.max(60,120-elapsed):0;
    function play(){
      if(run!==voiceRun){ if(onPlayed)onPlayed(false); return; }
      try { applyPreferredVoice(utterance); nativeVoiceResume(); nativeVoiceSpeak(utterance); if(onPlayed)onPlayed(true); }
      catch(error){ if(onError)onError(error instanceof Error?error:new Error('Falha na leitura em voz alta.')); }
    }
    if(delay)setTimeout(play,delay); else play();
  }
  function queueLegacyUtterance(utterance){
    if(!voiceSynth||!nativeVoiceSpeak)return;
    var generation=voiceCancelGeneration;
    var elapsed=Date.now()-lastVoiceCancel;
    function play(){
      // Apenas cancel() invalida a fila. Várias chamadas speak() continuam sendo
      // enfileiradas na ordem nativa, como a Web Speech API especifica.
      if(generation!==voiceCancelGeneration)return;
      try { applyPreferredVoice(utterance); nativeVoiceResume(); nativeVoiceSpeak(utterance); } catch(e){}
    }
    if(elapsed<120){
      legacyVoiceQueue.push({utterance:utterance,generation:generation});
      if(!legacyVoiceTimer)legacyVoiceTimer=setTimeout(function(){
        var queued=legacyVoiceQueue; legacyVoiceQueue=[]; legacyVoiceTimer=null;
        queued.forEach(function(item){
          if(item.generation!==voiceCancelGeneration)return;
          try { applyPreferredVoice(item.utterance); nativeVoiceResume(); nativeVoiceSpeak(item.utterance); } catch(e){}
        });
      },Math.max(60,120-elapsed));
    } else play();
  }
  if(!PID){ window.AD = { list:function(){return Promise.resolve([]);}, get:function(){return Promise.resolve(null);}, count:function(){return Promise.resolve(0);}, insert:noop, update:noop, remove:noop, email:noop, payments:{checkout:noop}, voice:{listen:function(){return Promise.reject(new Error('Voz indisponível fora de um projeto.'));},speak:noop,cancel:noop}, enabled:false }; return; }
  function req(method, opts){
    opts = opts || {};
    return bridge('data',{method:method,qs:opts.qs||'',body:opts.body});
  }
  // Monta a query string de list/get/count a partir de um objeto de opções.
  // opts: { where:{campo:valor}, search, searchField, sort:'campo'|'-campo', limit, offset }
  function buildQs(collection, opts){
    var qs = '?collection=' + encodeURIComponent(collection||'default');
    opts = opts || {};
    if(opts.where && typeof opts.where === 'object') qs += '&where=' + encodeURIComponent(JSON.stringify(opts.where));
    if(opts.search){ qs += '&search=' + encodeURIComponent(opts.search); if(opts.searchField) qs += '&searchField=' + encodeURIComponent(opts.searchField); }
    if(opts.sort) qs += '&sort=' + encodeURIComponent(opts.sort);
    if(opts.limit != null) qs += '&limit=' + encodeURIComponent(opts.limit);
    if(opts.offset != null) qs += '&offset=' + encodeURIComponent(opts.offset);
    return qs;
  }
  window.AD = {
    enabled: true,
    // list(colecao) OU list(colecao, { where, search, searchField, sort, limit, offset })
    list: function(collection, opts){ return req('GET', { qs: buildQs(collection, opts) }).then(function(r){ return r.items || []; }); },
    // get(colecao, id) → um registro (ou null)
    get: function(collection, id){ return req('GET', { qs:'?collection=' + encodeURIComponent(collection||'default') + '&id=' + encodeURIComponent(id) }).then(function(r){ return r.item || null; }); },
    // count(colecao, where?) → número de registros que batem no filtro
    count: function(collection, where){ var o = where ? { where: where } : {}; return req('GET', { qs: buildQs(collection, o) + '&count=1' }).then(function(r){ return r.count || 0; }); },
    insert: function(collection, data){ return req('POST', { body:{ collection: collection||'default', data: data||{} } }).then(function(r){ return r.item; }); },
    update: function(id, data){ return req('PATCH', { body:{ id: id, data: data||{} } }).then(function(r){ return r.item; }); },
    remove: function(id){ return req('DELETE', { qs:'?id=' + encodeURIComponent(id) }).then(function(){ return true; }); },
    // Upload de arquivo/imagem (File ou Blob) → devolve a URL pública.
    upload: function(file){
      return bridge('upload',{method:'POST',file:file,fileName:file&&file.name})
        .then(function(r){ return r.url; });
    },
    // Formulário de contato: salva a mensagem no painel de Dados (coleção 'contatos')
    // e, se houver provedor de e-mail configurado, avisa o dono por e-mail.
    // Ex.: await AD.email({ name, email, subject, message }) → { ok, saved, emailed }
    email: function(payload){
      return bridge('email',{method:'POST',body:payload||{}});
    },
    // Pagamento real: o app informa somente a chave declarada no AD_BACKEND.
    // O servidor resolve o priceId e as URLs de retorno e redireciona a página.
    payments: {
      checkout: function(priceKey, opts){
        opts=opts||{};
        return bridge('integration',{method:'POST',body:{action:'stripe.checkout',priceKey:String(priceKey||''),customerEmail:opts.customerEmail}})
          .then(function(r){return r.checkout||r;});
      }
    },
    // O microfone usa a página principal, pois reconhecimento de voz costuma ser
    // bloqueado em iframes sandbox. A leitura em voz alta fica local e síncrona:
    // isso preserva o gesto do clique e impede um app de prender a fila dos demais.
    voice: {
      listen: function(opts){ opts=opts||{}; return bridge('voice',{method:'POST',body:{action:'listen',lang:opts.lang||'pt-BR'}}).then(function(r){return r.transcript||'';}); },
      speak: function(text, opts){
        opts=opts||{};
        return new Promise(function(resolve,reject){
          var synth=window.speechSynthesis, Utterance=window.SpeechSynthesisUtterance;
          var value=String(text||'').trim();
          if(!value || !synth || !Utterance){ reject(new Error('Leitura em voz alta não disponível neste navegador.')); return; }
          try {
            var utterance=new Utterance(value.slice(0,5000));
            utterance.lang=String(opts.lang||'pt-BR').slice(0,20);
            utterance.rate=Math.min(2,Math.max(0.5,Number(opts.rate)||1));
            utterance.pitch=Math.min(2,Math.max(0,Number(opts.pitch)||1));
            utterance.volume=Math.min(1,Math.max(0,opts.volume==null?1:Number(opts.volume)));
            playLocalUtterance(utterance,function(played){resolve({speaking:!!played,cancelled:!played});},reject);
          } catch(error){ reject(error instanceof Error?error:new Error('Falha na leitura em voz alta.')); }
        });
      },
      cancel: function(){
        try { cancelLocalVoice(); } catch(e){}
        return bridge('voice',{method:'POST',body:{action:'cancel'}}).catch(function(){});
      }
    }
  };

  // ── AD.settings: CONTEÚDO editável do site (admin embutido no motor) ──────
  // get(chave, padrão) é SÍNCRONO e à prova de loop: registra a chave, devolve o
  // override salvo (ou o padrão). O app gerado NÃO precisa de useEffect/estado —
  // por isso é impossível criar o loop "recarrega infinito" de antes. Um painel
  // de administração (injetado abaixo) deixa o DONO DO NEGÓCIO trocar textos,
  // cores, marcas e imagens direto no site, sem mexer no código. Igual para todos
  // os projetos do AD Studio, como o Nano Banana é para as imagens.
  var ADS = { saved:{}, reg:{}, ready:false, loading:null, admin:${adminFlag}, hasPin:false, pin:'' };
  function adsInfer(key, def){
    try{
      var k=String(key||'').toLowerCase();
      if(typeof def==='string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(def.trim())) return 'color';
      if(/(^|[_.:-])(cor|color|colour)([_.:-]|$)/.test(k)) return 'color';
      if(/(^|[_.:-])(image|imagem|img|logo|foto|photo|banner|capa|avatar|icone|icon)([_.:-]|$)/.test(k)) return 'image';
      if(typeof def==='string' && /^(https?:|data:image|ADIMG:)/i.test(def.trim())) return 'image';
      if(typeof def==='string' && def.length>60) return 'longtext';
      return 'text';
    }catch(e){ return 'text'; }
  }
  window.AD.settings = {
    get: function(key, fallback){
      try{
        if(key && !ADS.reg[key]) ADS.reg[key] = { key:key, def:fallback, type:adsInfer(key, fallback), order:Object.keys(ADS.reg).length };
      }catch(e){}
      var v = ADS.saved[key];
      return (v===undefined||v===null||v==='') ? fallback : v;
    },
    all: function(){ var o={}; try{ Object.keys(ADS.reg).forEach(function(k){ o[k]=window.AD.settings.get(k, ADS.reg[k].def); }); }catch(e){} return o; },
    ready: function(){ return ADS.loading || Promise.resolve(); }
  };
  // Carrega os overrides UMA única vez. Só dispara re-render se HOUVER override
  // salvo (caso raro) — no caso comum não há flash nem trabalho extra.
  ADS.loading = bridge('settings',{method:'GET'}).then(function(r){
    ADS.ready = true;
    if(r && r.values && typeof r.values==='object') ADS.saved = r.values;
    ADS.hasPin = !!(r && r.hasPin);
    if(Object.keys(ADS.saved).length){ try{ window.dispatchEvent(new Event('ad:settings-changed')); }catch(e){} }
  }).catch(function(){ ADS.ready = true; });

  // ── Painel de administração (injetado; nunca faz parte do código gerado) ──
  (function installAdmin(){
    var COLORS='#0b1220', btn=null, panel=null, built=false;
    function adminAllowed(){
      if(ADS.admin) return true;            // dono no preview do estúdio
      if(ADS.hasPin) return true;           // dono ativou a edição pelo cliente (definiu um PIN)
      try{ return /(^|#)(admin|editar|config)/i.test(location.hash||''); }catch(e){ return false; }
    }
    function esc(s){ return String(s==null?'':s); }
    function field(item){
      var wrap=document.createElement('label');
      wrap.style.cssText='display:block;margin:0 0 14px;font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif;color:#334155';
      var title=document.createElement('div');
      title.textContent=item.key;
      title.style.cssText='margin:0 0 6px;color:#0f172a;font-weight:600;word-break:break-all';
      wrap.appendChild(title);
      var cur=window.AD.settings.get(item.key, item.def);
      var input;
      if(item.type==='color'){
        input=document.createElement('input'); input.type='color';
        input.value=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(cur))?cur:'#000000';
        input.style.cssText='width:56px;height:34px;padding:0;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer';
      } else if(item.type==='image'){
        var box=document.createElement('div');
        input=document.createElement('input'); input.type='text'; input.value=esc(cur);
        input.placeholder='Cole uma URL, envie um arquivo ou gere abaixo';
        input.style.cssText='width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit';
        var row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;margin-top:6px;flex-wrap:wrap';
        var up=document.createElement('button'); up.type='button'; up.textContent='Enviar imagem';
        up.style.cssText='padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;cursor:pointer;font:500 12px ui-sans-serif,system-ui,sans-serif';
        var file=document.createElement('input'); file.type='file'; file.accept='image/*'; file.style.display='none';
        up.onclick=function(){ file.click(); };
        file.onchange=function(){
          var f=file.files&&file.files[0]; if(!f) return;
          up.textContent='Enviando…'; up.disabled=true;
          window.AD.upload(f).then(function(url){ input.value=url; prev.src=url; up.textContent='Enviar imagem'; up.disabled=false; })
            .catch(function(){ up.textContent='Falhou — tente de novo'; up.disabled=false; });
        };
        row.appendChild(up); row.appendChild(file);
        var prev=document.createElement('img'); prev.src=/^(https?:|data:image)/i.test(String(cur))?cur:'';
        prev.style.cssText='margin-top:8px;max-height:80px;max-width:100%;border-radius:8px;'+(prev.src?'':'display:none');
        input.addEventListener('input',function(){ if(/^(https?:|data:image)/i.test(input.value)){ prev.src=input.value; prev.style.display=''; } });
        box.appendChild(input); box.appendChild(row); box.appendChild(prev);
        wrap.appendChild(box); wrap.__adInput=input; return wrap;
      } else if(item.type==='longtext'){
        input=document.createElement('textarea'); input.value=esc(cur); input.rows=3;
        input.style.cssText='width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;resize:vertical';
      } else {
        input=document.createElement('input'); input.type='text'; input.value=esc(cur);
        input.style.cssText='width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit';
      }
      wrap.appendChild(input); wrap.__adInput=input; return wrap;
    }
    function buildPanel(){
      var items=Object.keys(ADS.reg).map(function(k){ return ADS.reg[k]; }).sort(function(a,b){ return a.order-b.order; });
      panel=document.createElement('div');
      panel.style.cssText='position:fixed;left:16px;bottom:70px;z-index:2147483000;width:340px;max-width:calc(100vw - 32px);max-height:75vh;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 20px 60px -12px rgba(2,6,23,.35);padding:16px;font:14px ui-sans-serif,system-ui,sans-serif;color:#0f172a';
      var head=document.createElement('div'); head.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
      var h=document.createElement('div'); h.textContent='Editar o site'; h.style.cssText='font-weight:700;font-size:15px';
      var x=document.createElement('button'); x.textContent='✕'; x.style.cssText='border:none;background:transparent;font-size:16px;cursor:pointer;color:#64748b';
      x.onclick=function(){ toggle(false); };
      head.appendChild(h); head.appendChild(x); panel.appendChild(head);
      if(!items.length){
        var empty=document.createElement('p'); empty.textContent='Este site ainda não tem campos editáveis.';
        empty.style.cssText='color:#64748b;font-size:13px'; panel.appendChild(empty);
      }
      var inputs={};
      items.forEach(function(it){ var f=field(it); inputs[it.key]=f.__adInput; panel.appendChild(f); });
      // PIN (quando o buyer edita pelo site publicado e há PIN configurado)
      var pinInput=null;
      if(!ADS.admin){
        var pf=document.createElement('label'); pf.style.cssText='display:block;margin:6px 0 12px;font:500 12px ui-sans-serif,system-ui,sans-serif;color:#334155';
        var pl=document.createElement('div'); pl.textContent='PIN de administração'; pl.style.cssText='margin:0 0 6px;color:#0f172a;font-weight:600'; pf.appendChild(pl);
        pinInput=document.createElement('input'); pinInput.type='password'; pinInput.inputMode='numeric'; pinInput.value=ADS.pin||'';
        pinInput.placeholder='Peça o PIN a quem criou o site';
        pinInput.style.cssText='width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit';
        pf.appendChild(pinInput); panel.appendChild(pf);
      }
      // DONO: define/altera o PIN que a dona do negócio usa no site publicado.
      var setPinInput=null;
      if(ADS.admin){
        var wrapPin=document.createElement('div');
        wrapPin.style.cssText='margin:10px 0 12px;padding:10px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc';
        var pl2=document.createElement('div'); pl2.textContent='PIN para o dono do site editar';
        pl2.style.cssText='font:600 12px ui-sans-serif,system-ui,sans-serif;color:#0f172a;margin-bottom:4px';
        var note=document.createElement('div');
        note.textContent=(ADS.hasPin?'Já existe um PIN. ':'Nenhum PIN ainda. ')+'Defina um PIN (4 a 12 dígitos) e passe ao cliente com o link do site + #editar. Assim ele edita textos, cores e imagens sozinho.';
        note.style.cssText='font:400 11px ui-sans-serif,system-ui,sans-serif;color:#64748b;margin-bottom:6px';
        setPinInput=document.createElement('input'); setPinInput.type='text'; setPinInput.inputMode='numeric';
        setPinInput.placeholder=ADS.hasPin?'Digite um novo PIN para trocar':'Ex.: 2468';
        setPinInput.style.cssText='width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit';
        wrapPin.appendChild(pl2); wrapPin.appendChild(note); wrapPin.appendChild(setPinInput);
        panel.appendChild(wrapPin);
      }
      var msg=document.createElement('div'); msg.style.cssText='min-height:16px;margin:2px 0 8px;font-size:12px';
      var save=document.createElement('button'); save.textContent='Salvar alterações';
      save.style.cssText='width:100%;padding:10px 14px;border:none;border-radius:10px;background:#e11d48;color:#fff;font-weight:600;cursor:pointer';
      save.onclick=function(){
        var values={};
        Object.keys(inputs).forEach(function(k){ var el=inputs[k]; if(el) values[k]=el.value; });
        var pin=pinInput?pinInput.value:'';
        var newPin=setPinInput?String(setPinInput.value||'').trim():'';
        save.disabled=true; save.textContent='Salvando…'; msg.textContent=''; msg.style.color='#64748b';
        var body={ values: values }; if(pin) body.adminPin=pin; if(newPin) body.setPin=newPin;
        bridge('settings',{method:'POST',body:body}).then(function(){
          ADS.saved=Object.assign({}, ADS.saved, values); if(pin) ADS.pin=pin;
          if(newPin){ ADS.hasPin=true; if(setPinInput) setPinInput.value=''; }
          try{ window.dispatchEvent(new Event('ad:settings-changed')); }catch(e){}
          msg.style.color='#16a34a'; msg.textContent=newPin?'Salvo! PIN definido — já pode passar ao cliente.':'Salvo! As mudanças já apareceram no site.';
          save.disabled=false; save.textContent='Salvar alterações';
        }).catch(function(err){
          msg.style.color='#dc2626'; msg.textContent=(err&&err.message)||'Não foi possível salvar.';
          save.disabled=false; save.textContent='Salvar alterações';
        });
      };
      panel.appendChild(msg); panel.appendChild(save);
      document.body.appendChild(panel);
    }
    function toggle(show){
      if(show){ if(!panel) buildPanel(); else panel.style.display=''; }
      else if(panel){ panel.style.display='none'; }
    }
    function ensureButton(){
      if(btn || !adminAllowed()) return;
      if(!Object.keys(ADS.reg).length) return; // nada editável → não mostra nada
      // Pontinho DISFARÇADO (estilo Airbnb): um ponto pequeno e discreto no canto.
      // O visitante comum quase não repara; quem comprou o site sabe que é ali e
      // clica para abrir o admin. Sem texto, sem chamar atenção.
      btn=document.createElement('button');
      var open=false;
      btn.type='button'; btn.setAttribute('aria-label','Editar o site'); btn.title='Editar o site';
      btn.style.cssText='position:fixed;left:12px;bottom:12px;z-index:2147483000;width:14px;height:14px;padding:0;border:1px solid rgba(255,255,255,.6);border-radius:50%;background:rgba(15,23,42,.30);box-shadow:0 1px 5px rgba(2,6,23,.35);cursor:pointer;opacity:.45;transition:opacity .2s ease,transform .2s ease';
      btn.onmouseenter=function(){ btn.style.opacity='1'; btn.style.transform='scale(1.35)'; };
      btn.onmouseleave=function(){ if(!open){ btn.style.opacity='.45'; btn.style.transform='scale(1)'; } };
      btn.onclick=function(){
        open=!open; toggle(open);
        btn.style.opacity=open?'1':'.45'; btn.style.transform=open?'scale(1.35)':'scale(1)';
      };
      document.body.appendChild(btn);
    }
    function boot(){
      // Espera o app montar para saber quais campos existem (reg preenche no render).
      var tries=0;
      var iv=setInterval(function(){ ensureButton(); if(btn || ++tries>40) clearInterval(iv); }, 400);
      try{ window.addEventListener('hashchange', ensureButton); }catch(e){}
    }
    if(document.readyState==='complete'||document.readyState==='interactive') boot();
    else window.addEventListener('DOMContentLoaded', boot);
  })();

  // ── Analytics de visita (só no site PUBLICADO, marcado por __AD_PUBLISHED) ──
  // Conta uma visita por carregamento. Agregado e anônimo. No preview do editor
  // o marcador não existe, então não conta.
  try {
    if (window.__AD_PUBLISHED && PID) {
      bridge('view',{method:'POST'}).catch(function(){});
      var telemetryBusy=false;
      function reportRuntime(kind,message,context){
        if(telemetryBusy)return;
        telemetryBusy=true;
        bridge('telemetry',{method:'POST',body:{
          kind:kind,
          message:String(message||'Erro desconhecido').slice(0,800),
          context:context||{}
        }}).catch(function(){}).then(function(){telemetryBusy=false;});
        setTimeout(function(){telemetryBusy=false;},5000);
      }
      window.addEventListener('error',function(event){
        reportRuntime('runtime_error',event&&event.message,{
          file:String(event&&event.filename||'').slice(0,240),
          line:Number(event&&event.lineno)||0,
          column:Number(event&&event.colno)||0
        });
      });
      window.addEventListener('unhandledrejection',function(event){
        var reason=event&&event.reason;
        reportRuntime('unhandled_rejection',reason&&reason.message?reason.message:String(reason||'Promise rejeitada'),{});
      });
    }
  } catch(e){}

  // ── Login de usuário final (window.AD.auth) ──────────────────────────
  var TKEY = 'adstudio:app-token:' + PID;
  function getTok(){ try { return localStorage.getItem(TKEY) || null; } catch(e){ return window.__adTok || null; } }
  function setTok(t){ try { if(t) localStorage.setItem(TKEY, t); else localStorage.removeItem(TKEY); } catch(e){ window.__adTok = t; } }
  function authFetch(opts){
    opts = opts || {};
    return bridge('auth',{method:opts.method||'POST',qs:opts.qs||'',body:opts.body});
  }
  window.AD.auth = {
    signUp: function(email, password, name){ return authFetch({ body:{ action:'signup', email:email, password:password, name:name } }).then(function(j){ setTok(j.token); return j.user; }); },
    signIn: function(email, password){ return authFetch({ body:{ action:'login', email:email, password:password } }).then(function(j){ setTok(j.token); return j.user; }); },
    signOut: function(){ return authFetch({ body:{ action:'logout' } }).catch(function(){}).then(function(){ setTok(null); return true; }); },
    me: function(){ return authFetch({ method:'GET', qs:'?me=1' }).then(function(j){ if(j.user)setTok('bridge-session'); return j.user; }).catch(function(){ return null; }); },
    token: getTok
  };

  // Compatibilidade de MICROFONE com apps já gerados que usam Web Speech API.
  // A fala nativa (speechSynthesis) não é sobrescrita: ela precisa permanecer no
  // ciclo síncrono do clique e não deve compartilhar a fila com outros previews.
  (function installVoiceCompatibility(){
    function BridgeRecognition(){
      this.lang='pt-BR'; this.interimResults=false; this.continuous=false;
      this.onstart=null; this.onresult=null; this.onerror=null; this.onend=null;
      this._run=0;
    }
    BridgeRecognition.prototype.start=function(){
      var self=this, run=++this._run;
      if(typeof self.onstart==='function') try{self.onstart({type:'start'});}catch(e){}
      window.AD.voice.listen({lang:self.lang}).then(function(transcript){
        if(run!==self._run)return;
        var alternative={transcript:transcript,confidence:1};
        var result=[alternative]; result.isFinal=true;
        var results=[result];
        if(typeof self.onresult==='function') try{self.onresult({type:'result',resultIndex:0,results:results});}catch(e){}
        if(typeof self.onend==='function') try{self.onend({type:'end'});}catch(e){}
      }).catch(function(error){
        if(run!==self._run)return;
        if(typeof self.onerror==='function') try{self.onerror({type:'error',error:'not-allowed',message:error&&error.message});}catch(e){}
        if(typeof self.onend==='function') try{self.onend({type:'end'});}catch(e){}
      });
    };
    BridgeRecognition.prototype.stop=function(){ this._run++; window.AD.voice.cancel(); if(typeof this.onend==='function') try{this.onend({type:'end'});}catch(e){} };
    BridgeRecognition.prototype.abort=BridgeRecognition.prototype.stop;
    try { window.SpeechRecognition=BridgeRecognition; window.webkitSpeechRecognition=BridgeRecognition; } catch(e){}

    // Compatibilidade de ALTO-FALANTE para projetos antigos. Eles chamam
    // speechSynthesis diretamente, sem passar por AD.voice. Mantemos a API
    // original, mas recuperamos filas presas e respeitamos o intervalo exigido
    // pelo Safari depois de cancel().
    try {
      if(voiceSynth&&nativeVoiceSpeak){
        voiceSynth.speak=function(utterance){ queueLegacyUtterance(utterance); };
        voiceSynth.cancel=function(){ cancelLocalVoice(); };
      }
    } catch(e){}
  })();
})();
</script>
<script>
/* Guard de navegação — impede o app gerado de "escapar" do preview.
   Sem isto, um <a href="/rota"> ou react-router faz o iframe carregar o
   próprio AD Studio (o app pai) no lugar do app. Aqui interceptamos:
   - cliques em links relativos / mesma-origem → bloqueados (SPA deve usar estado);
     links "#âncora" viram troca de hash (mantém no iframe);
   - links externos http(s) de outra origem → abrem em nova aba;
   - submit de formulários sem URL externa → default prevenido (nada de reload);
   - history.pushState/replaceState em srcdoc (origin null) → erro engolido. */
(function(){
  function isExternalHttp(u){ try { var url = new URL(u, location.href); return /^https?:$/.test(url.protocol) && url.origin !== location.origin; } catch(e){ return false; } }
  // ── Correção de submit em about:srcdoc (origem opaca "null") ──────────
  // No preview o app roda em about:srcdoc, cuja origem é opaca; o navegador
  // BLOQUEIA a submissão nativa de formulários (o evento 'submit' nem dispara),
  // deixando botões de login/cadastro/contato inertes. Aqui, SOMENTE no preview
  // srcdoc, interceptamos o clique num botão de submit e emitimos um 'submit' que
  // borbulha — assim o onSubmit do React roda normalmente. Em apps publicados
  // (origem http real) a submissão nativa funciona e este bloco NÃO é ativado,
  // evitando qualquer duplicação.
  var IS_SRCDOC = (location.href === 'about:srcdoc' || location.origin === 'null');
  if (IS_SRCDOC) {
    document.addEventListener('click', function(e){
      var t = e.target;
      var sb = t && t.closest ? t.closest('button[type="submit"], input[type="submit"], button:not([type])') : null;
      if(!sb || sb.disabled) return;
      var form = sb.form || (sb.closest ? sb.closest('form') : null);
      if(!form) return;
      e.preventDefault();                                  // a submissão nativa está bloqueada mesmo
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, true);
  }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if(!a) return;
    var href = a.getAttribute('href');
    if(href == null) return;
    if(href === '' || href === '#'){ e.preventDefault(); return; }
    if(/^(mailto:|tel:|sms:|whatsapp:)/i.test(href)) return;           // protocolos: deixa
    if(isExternalHttp(href)){ if(!a.target) a.target = '_blank'; return; } // externo → nova aba
    e.preventDefault();                                                 // relativo/mesma-origem → bloqueia navegação
    if(href.charAt(0) === '#'){ try { location.hash = href; } catch(_){ } } // hash → mantém SPA
  }, true);
  document.addEventListener('submit', function(e){
    var form = e.target;
    var action = (form && form.getAttribute) ? (form.getAttribute('action') || '') : '';
    if(!isExternalHttp(action)) e.preventDefault(); // evita reload/navegação; o onSubmit do React ainda roda
  }, true);
  ['pushState','replaceState'].forEach(function(m){
    var orig = history[m];
    if(orig) history[m] = function(){ try { return orig.apply(history, arguments); } catch(err){ /* srcdoc origin null: ignora */ } };
  });
})();
</script>
<script>
/* Rede de segurança de animações: o framer-motion "whileInView" (anima ao rolar)
   NÃO dispara em about:srcdoc (origem opaca), então seções inteiras ficariam
   invisíveis (presas em opacity 0). Aqui, após dar tempo às animações de montagem
   (que funcionam), revelamos qualquer elemento em fluxo que ficou preso em opacity
   baixa — sem tocar em overlays fixos (modais). Garante que nada suma. */
(function(){
  function revealStuck(){
    try{
      var els = document.querySelectorAll('section,div,article,h1,h2,h3,p,span,img,ul,li,a,button');
      for(var i=0;i<els.length;i++){
        var el = els[i];
        var cs = window.getComputedStyle(el);
        if(cs.position === 'fixed') continue;                // não revela modais/overlays fixos
        if(parseFloat(cs.opacity) < 0.35){                   // opacity baixa (inline OU via Web Animations)
          var r = el.getBoundingClientRect();
          if(r.width > 100 && r.height > 36){
            // framer-motion segura a opacity via Web Animations API — cancela a animação travada
            if(el.getAnimations){ try { el.getAnimations().forEach(function(a){ a.cancel(); }); } catch(e){} }
            // Usa prioridade !important: o framer-motion re-aplica style.opacity (inline normal)
            // a cada quadro/scroll; um inline "important" vence isso e mantém a seção visível
            // para sempre, evitando que conteúdo suma ao rolar.
            try { el.style.setProperty('opacity','1','important'); el.style.setProperty('transform','none','important'); }
            catch(e){ el.style.opacity = '1'; el.style.transform = 'none'; }
          }
        }
      }
    }catch(e){}
  }
  function schedule(){
    [300,700,1300,2200,3200].forEach(function(t){ setTimeout(revealStuck, t); });
    // Passadas iniciais frequentes (~18s) garantem revelar tudo mesmo com montagem lenta.
    var n = 0, iv = setInterval(function(){ revealStuck(); if(++n > 30) clearInterval(iv); }, 600);
    // A cada scroll (throttle via rAF) revarremos: como agora fixamos opacity/transform
    // com !important, o conteúdo revelado NÃO some mais ao rolar.
    var ticking = false;
    window.addEventListener('scroll', function(){
      if(ticking) return; ticking = true;
      requestAnimationFrame(function(){ revealStuck(); ticking = false; });
    }, { passive: true });
    // Rede final: qualquer mudança de estilo no DOM (framer re-escondendo) dispara
    // uma revarredura throttled — segura casos que o scroll/intervalo não pegariam.
    try {
      var moT = null;
      var mo = new MutationObserver(function(){
        if(moT) return; moT = setTimeout(function(){ moT = null; revealStuck(); }, 250);
      });
      mo.observe(document.body, { attributes:true, subtree:true, attributeFilter:['style'] });
    } catch(e){}
  }
  if(document.readyState === 'complete') schedule(); else window.addEventListener('load', schedule);
})();
</script>`;
}
