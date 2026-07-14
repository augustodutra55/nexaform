/**
 * Script injetado no iframe do app gerado que expõe `window.AD` — a camada de
 * dados/persistência embutida do AD Studio. Fala com /api/data/[projectId]
 * (mesmo origin, escopado por projeto). É o "backend" que os apps usam para
 * salvar dados de verdade, tanto no preview quanto no app publicado.
 */
export function adGlobalScript(projectId?: string | null): string {
  const pid = JSON.stringify(projectId || "");
  return `<script>
(function(){
  var PID = ${pid};
  var HOST = window.parent, bridgeSeq = 0, pending = {};
  window.addEventListener('message', function(e){
    var d=e.data; if(e.source!==HOST || !d || d.__ad_bridge_result!==true || !pending[d.id]) return;
    var p=pending[d.id]; delete pending[d.id];
    if(d.ok) p.resolve(d.payload||{}); else p.reject(new Error(d.error||('AD '+(d.status||500))));
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
  if(!PID){ window.AD = { list:function(){return Promise.resolve([]);}, get:function(){return Promise.resolve(null);}, count:function(){return Promise.resolve(0);}, insert:noop, update:noop, remove:noop, email:noop, voice:{listen:function(){return Promise.reject(new Error('Voz indisponível fora de um projeto.'));},speak:noop,cancel:noop}, enabled:false }; return; }
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

  // ── Analytics de visita (só no site PUBLICADO, marcado por __AD_PUBLISHED) ──
  // Conta uma visita por carregamento. Agregado e anônimo. No preview do editor
  // o marcador não existe, então não conta.
  try {
    if (window.__AD_PUBLISHED && PID) {
      bridge('view',{method:'POST'}).catch(function(){});
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
