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
  function noop(){ return Promise.resolve(); }
  if(!PID){ window.AD = { list:function(){return Promise.resolve([]);}, insert:noop, update:noop, remove:noop, enabled:false }; return; }
  var base = '/api/data/' + PID;
  function req(method, opts){
    opts = opts || {};
    return fetch(base + (opts.qs||''), {
      method: method,
      headers: opts.body ? { 'content-type':'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(r){ if(!r.ok) throw new Error('AD data ' + r.status); return r.json(); });
  }
  window.AD = {
    enabled: true,
    list: function(collection){ return req('GET', { qs:'?collection=' + encodeURIComponent(collection||'default') }).then(function(r){ return r.items || []; }); },
    insert: function(collection, data){ return req('POST', { body:{ collection: collection||'default', data: data||{} } }).then(function(r){ return r.item; }); },
    update: function(id, data){ return req('PATCH', { body:{ id: id, data: data||{} } }).then(function(r){ return r.item; }); },
    remove: function(id){ return req('DELETE', { qs:'?id=' + encodeURIComponent(id) }).then(function(){ return true; }); },
    // Upload de arquivo/imagem (File ou Blob) → devolve a URL pública.
    upload: function(file){
      var fd = new FormData();
      fd.append('file', file);
      return fetch('/api/upload/' + PID, { method:'POST', body: fd })
        .then(function(r){ if(!r.ok) return r.json().then(function(e){ throw new Error(e.error||('upload '+r.status)); }); return r.json(); })
        .then(function(r){ return r.url; });
    }
  };

  // ── Login de usuário final (window.AD.auth) ──────────────────────────
  var TKEY = 'adstudio:app-token:' + PID;
  function getTok(){ try { return localStorage.getItem(TKEY) || null; } catch(e){ return window.__adTok || null; } }
  function setTok(t){ try { if(t) localStorage.setItem(TKEY, t); else localStorage.removeItem(TKEY); } catch(e){ window.__adTok = t; } }
  function authFetch(opts){
    opts = opts || {};
    var h = { 'content-type':'application/json' };
    var tok = getTok(); if(tok) h['authorization'] = 'Bearer ' + tok;
    return fetch('/api/app-auth/' + PID + (opts.qs||''), { method: opts.method||'POST', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error || ('auth '+r.status)); return j; }); });
  }
  window.AD.auth = {
    signUp: function(email, password, name){ return authFetch({ body:{ action:'signup', email:email, password:password, name:name } }).then(function(j){ setTok(j.token); return j.user; }); },
    signIn: function(email, password){ return authFetch({ body:{ action:'login', email:email, password:password } }).then(function(j){ setTok(j.token); return j.user; }); },
    signOut: function(){ return authFetch({ body:{ action:'logout' } }).catch(function(){}).then(function(){ setTok(null); return true; }); },
    me: function(){ if(!getTok()) return Promise.resolve(null); return authFetch({ method:'GET', qs:'?me=1' }).then(function(j){ return j.user; }).catch(function(){ return null; }); },
    token: getTok
  };
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
</script>`;
}
