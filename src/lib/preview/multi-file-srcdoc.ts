/**
 * Runtime multi-arquivo do preview (server-safe).
 *
 * Extraído de AppRunner para ser reutilizado tanto pelo editor (client) quanto
 * pela rota server-side /preview/[projectId]/[versionId] — o bundler esbuild
 * (bundler.ts) é browser-only ("use client"), então o preview navegável usa
 * este runtime Babel, que compila os arquivos DENTRO do iframe (sem wasm e sem
 * build no servidor). Consome os mesmos runtime-audit.ts e ad-global.ts.
 */
import type { AppFile } from "@/lib/engine/app-types";
import { adGlobalScript } from "@/lib/preview/ad-global";
import { runtimeAuditSource } from "@/lib/preview/runtime-audit";
import { visualSelectionSource } from "@/lib/preview/visual-selection";

/**
 * Bibliotecas externas suportadas via CDN (UMD/global), sem npm install.
 * Detectamos quais são importadas e injetamos SÓ essas — mantém o preview leve.
 * `deps` são carregadas antes (ex.: recharts precisa de prop-types).
 */
const EXTERNAL_LIBS: Record<string, { url: string; deps?: string[] }> = {
  "prop-types": { url: "https://unpkg.com/prop-types@15/prop-types.min.js" },
  recharts: { url: "https://unpkg.com/recharts@2/umd/Recharts.js", deps: ["prop-types"] },
  lodash: { url: "https://unpkg.com/lodash@4/lodash.min.js" },
  clsx: { url: "https://unpkg.com/clsx@2/dist/clsx.min.js" },
  "lucide-react": { url: "https://unpkg.com/lucide@latest/dist/umd/lucide.js" },
};

/** Detecta imports de libs externas conhecidas no código dos arquivos. */
export function detectExternals(files: AppFile[]): string[] {
  const all = files.map((f) => f.content).join("\n");
  const found = new Set<string>();
  for (const name of Object.keys(EXTERNAL_LIBS)) {
    if (name === "prop-types") continue; // só como dependência
    const re = new RegExp(`from\\s+['"]${name.replace(/[/-]/g, "\\$&")}['"]`);
    if (re.test(all)) found.add(name);
  }
  // adiciona dependências (ex.: prop-types p/ recharts), preservando ordem (deps antes)
  const ordered: string[] = [];
  const add = (n: string) => {
    if (ordered.includes(n)) return;
    (EXTERNAL_LIBS[n].deps ?? []).forEach(add);
    ordered.push(n);
  };
  found.forEach(add);
  return ordered;
}

/**
 * HTML do iframe: cada arquivo vira um módulo CommonJS (Babel), com um `require`
 * que resolve imports relativos (./ ../, extensões, /index) contra um registro
 * de módulos. React/ReactDOM (e libs externas via CDN) são "externals". É um
 * bundler mínimo rodando no próprio navegador — sem servidor, sem npm.
 */
export function buildMultiFileSrcDoc(
  files: AppFile[],
  entry: string,
  projectId?: string | null,
  editorSession = false
): string {
  const map: Record<string, string> = {};
  for (const f of files) map[f.path.replace(/^\.?\//, "")] = f.content;
  const filesJson = JSON.stringify(map);
  const entryJson = JSON.stringify(entry.replace(/^\.?\//, ""));
  const adScript = adGlobalScript(projectId, { admin: editorSession });
  const auditSource = runtimeAuditSource();
  const selectionSource = editorSession ? visualSelectionSource() : "";
  const externals = detectExternals(files);
  const extScripts = externals
    .map((n) => `<script src="${EXTERNAL_LIBS[n].url}" crossorigin></script>`)
    .join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin></script>
<script src="https://cdn.tailwindcss.com"></script>
${extScripts}
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0b1020;color:#0f172a}
  #root{background:#ffffff}
  .nx-error{padding:20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#b91c1c;background:#fef2f2;white-space:pre-wrap;height:100%;box-sizing:border-box;overflow:auto;font-size:13px;line-height:1.5}
</style>
</head>
<body>
<div id="root"></div>
${adScript}
<script>
  var _nxHost = window.parent;
  var _nxReported = false;
  function nxReady(){ if(_nxReported) return; try { _nxHost.postMessage({ __nx_ready: true }, '*'); } catch(e){} }
  function nxReport(msg){ if(_nxReported) return; _nxReported=true; try{ _nxHost.postMessage({ __nx_error:String(msg).slice(0,800) }, '*'); }catch(e){} }
  ${auditSource}
  ${selectionSource}
  try { Object.defineProperty(window, 'parent', { get: function(){ return window; } }); } catch(e){}
  try { Object.defineProperty(window, 'top', { get: function(){ return window; } }); } catch(e){}
  window.addEventListener('error', function(e){ showError(e.message); nxReport(e.message); });
  window.addEventListener('unhandledrejection', function(e){ var m=(e.reason && e.reason.message) || String(e.reason); showError(m); nxReport(m); });
  function showError(msg){ var r=document.getElementById('root'); if(r) r.innerHTML='<div class="nx-error">⚠ Erro ao executar o app:\\n\\n'+String(msg).replace(/</g,'&lt;')+'</div>'; }
</script>
<script>
  (function(){
    var FILES = ${filesJson};
    var ENTRY = ${entryJson};
    var __src = {};
    try {
      Object.keys(FILES).forEach(function(p){
        __src[p] = Babel.transform(FILES[p], {
          presets: [['react', { runtime: 'classic' }], 'typescript'],
          plugins: ['transform-modules-commonjs'],
          filename: p
        }).code;
      });
    } catch(e){ var mc='Erro de compilação: '+((e && e.message) || e); showError(mc); nxReport(mc); return; }

    var __cache = {};

    // ── Bibliotecas externas (CDN globals) ────────────────────────────────
    var __lucideCache = null;
    var __framerMotionCache = null;
    function lucideShim(){
      if(__lucideCache) return __lucideCache;
      var L = window.lucide;
      var out = {};
      function make(node){
        return function(props){
          props = props || {};
          var kids = (node||[]).map(function(n,i){ return React.createElement(n[0], Object.assign({key:i}, n[1])); });
          return React.createElement('svg', {
            xmlns:'http://www.w3.org/2000/svg', width:props.size||24, height:props.size||24,
            viewBox:'0 0 24 24', fill:'none', stroke:props.color||'currentColor',
            strokeWidth:props.strokeWidth||2, strokeLinecap:'round', strokeLinejoin:'round',
            className:props.className, style:props.style, onClick:props.onClick
          }, kids);
        };
      }
      if(L && L.icons){ Object.keys(L.icons).forEach(function(name){ out[name] = make(L.icons[name]); }); }
      var fallback = out.Gauge || out.Circle || make([['circle',{cx:12,cy:12,r:9}]]);
      __lucideCache = typeof Proxy === 'function'
        ? new Proxy(out, { get: function(target, key){ return target[key] || fallback; } })
        : out;
      return __lucideCache;
    }
    // Fallback resiliente para quando o bundler real/esbuild fica
    // indisponível. Mantém o contrato mais usado de framer-motion e renderiza
    // o estilo final da animação, sem esconder ou quebrar o conteúdo.
    function framerMotionShim(){
      if(__framerMotionCache)return __framerMotionCache;
      function finalStyle(value){
        if(!value||typeof value!=='object')return {};
        var style={}, transforms=[];
        Object.keys(value).forEach(function(key){
          var item=value[key];
          if(key==='x')transforms.push('translateX('+(typeof item==='number'?item+'px':item)+')');
          else if(key==='y')transforms.push('translateY('+(typeof item==='number'?item+'px':item)+')');
          else if(key==='scale'||key==='scaleX'||key==='scaleY'||key==='rotate')transforms.push(key+'('+(key==='rotate'&&typeof item==='number'?item+'deg':item)+')');
          else if(key!=='transition')style[key]=item;
        });
        if(transforms.length)style.transform=transforms.join(' ');
        return style;
      }
      function component(tag){
        return React.forwardRef(function(props,ref){
          props=props||{};
          var children=props.children, animate=props.animate, variants=props.variants;
          var target=typeof animate==='string'&&variants?variants[animate]:animate;
          var clean={};
          Object.keys(props).forEach(function(key){
            if(['children','initial','animate','exit','variants','transition','whileHover','whileTap','whileFocus','whileInView','viewport','layout','layoutId'].indexOf(key)<0)clean[key]=props[key];
          });
          clean.ref=ref;
          clean.style=Object.assign({},props.style||{},finalStyle(target));
          return React.createElement(tag,clean,children);
        });
      }
      var motion=typeof Proxy==='function'
        ? new Proxy({}, {get:function(target,key){if(!target[key])target[key]=component(key);return target[key];}})
        : {div:component('div'),span:component('span'),section:component('section'),button:component('button'),a:component('a'),img:component('img')};
      __framerMotionCache={motion:motion,AnimatePresence:function(props){return React.createElement(React.Fragment,null,props&&props.children);},MotionConfig:function(props){return React.createElement(React.Fragment,null,props&&props.children);}};
      return __framerMotionCache;
    }
    function external(spec){
      if(spec==='react') return React;
      if(spec==='react-dom'||spec==='react-dom/client') return ReactDOM;
      if(spec==='recharts') return window.Recharts;
      if(spec==='lodash') return window._;
      if(spec==='clsx') return window.clsx;
      if(spec==='prop-types') return window.PropTypes;
      if(spec==='lucide-react') return lucideShim();
      if(spec==='framer-motion'||spec==='motion/react') return framerMotionShim();
      return undefined;
    }

    function norm(path){
      var parts=path.split('/'), out=[];
      for(var i=0;i<parts.length;i++){ var s=parts[i]; if(s===''||s==='.')continue; if(s==='..')out.pop(); else out.push(s); }
      return out.join('/');
    }
    function candidates(base){
      return [base, base+'.jsx', base+'.tsx', base+'.js', base+'.ts', base+'/index.jsx', base+'/index.tsx', base+'/index.js', base+'/index.ts'];
    }
    function resolve(from, spec){
      var target;
      if(spec.charAt(0)==='.'){ var dir = from.indexOf('/')>=0 ? from.replace(/\\/[^/]*$/,'') : ''; target = norm((dir?dir+'/':'')+spec); }
      else { target = spec; }
      var cand = candidates(target);
      for(var i=0;i<cand.length;i++){ if(__src[cand[i]]!=null) return cand[i]; }
      return null;
    }
    function req(from, spec){
      var ex = external(spec);
      if(ex !== undefined){
        if(ex === null) throw new Error('A biblioteca "'+spec+'" não carregou (CDN). Tente recarregar o preview.');
        return ex;
      }
      var key = resolve(from, spec);
      if(!key) throw new Error('Módulo não encontrado: "'+spec+'" (só são suportados imports relativos e as libs: react, react-dom, recharts, lucide-react, framer-motion, motion/react, lodash, clsx).');
      if(__cache[key]) return __cache[key].exports;
      var module = { exports: {} };
      __cache[key] = module;
      var factory = new Function('module','exports','require','React','ReactDOM',
        'var {useState,useEffect,useRef,useMemo,useCallback,useReducer,useContext,createContext,Fragment}=React;\\n' + __src[key]);
      factory(module, module.exports, function(s){ return req(key, s); }, React, ReactDOM);
      return module.exports;
    }
    try {
      var mod = req('', ENTRY);
      var App = mod && (mod.default || mod.App);
      if(typeof App !== 'function'){ var m2='O arquivo de entrada ('+ENTRY+') precisa ter um export default de um componente React.'; showError(m2); nxReport(m2); return; }
      var __adRoot = ReactDOM.createRoot(document.getElementById('root'));
      window.__adRerender = function(){ try { __adRoot.render(React.createElement(App)); } catch(e){} };
      window.addEventListener('ad:settings-changed', window.__adRerender);
      __adRoot.render(React.createElement(App));
      setTimeout(function(){ nxPostAudit(); nxReady(); }, 500);
    } catch(err){ var m=(err && err.message) || String(err); showError(m); nxReport(m); }
  })();
</script>
</body>
</html>`;
}
