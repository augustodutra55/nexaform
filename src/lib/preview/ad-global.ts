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
})();
</script>`;
}
