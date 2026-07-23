"use client";

/**
 * AppRunner — executa código React arbitrário no navegador, com segurança.
 *
 * O código gerado (um componente `App`) é injetado em um <iframe sandbox>
 * que carrega React 18 (UMD), Babel Standalone (transpila JSX/TSX em runtime)
 * e Tailwind (Play CDN). É assim que um clone do Lovable renderiza apps
 * funcionais de verdade — jogos, ferramentas, lógica — sem servidor de build.
 *
 * O iframe roda com sandbox="allow-scripts" (sem allow-same-origin), então
 * o código do usuário fica isolado da app e dos cookies/sessão.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Monitor, Smartphone, RefreshCw, Cpu, Layout, Maximize2, Minimize2, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppFile, EngineMode } from "@/lib/engine/app-types";
import { bundleApp, buildBundledSrcDoc } from "@/lib/preview/bundler";
import { adGlobalScript } from "@/lib/preview/ad-global";
import { runtimeAuditSource, type RuntimeAuditReport } from "@/lib/preview/runtime-audit";
import { usePreviewBridge } from "@/components/preview/use-preview-bridge";
import {
  normalizePreviewSelection,
  visualSelectionSource,
  type PreviewElementSelection,
} from "@/lib/preview/visual-selection";

interface AppRunnerProps {
  /** Single-file (legado): código de um componente App. */
  code?: string;
  /** Multi-arquivo: vários módulos com imports reais. Tem prioridade sobre code. */
  files?: AppFile[] | null;
  /** Arquivo de entrada do projeto multi-arquivo. */
  entry?: string | null;
  /** chave para forçar recarregamento quando o código muda */
  version?: string | number;
  /** modo do motor que gerou este código (real/template/demo) — exibido no topo. */
  engineMode?: EngineMode | null;
  /** id do projeto — habilita a camada de dados AD (persistência) no app. */
  projectId?: string | null;
  /** chamado quando o app dá erro de execução (para auto-correção). */
  onError?: (message: string) => void;
  /** chamado somente depois que o React montou sem erro no iframe. */
  onReady?: () => void;
  /** relatório de interações, acessibilidade básica e responsividade. */
  onAudit?: (report: RuntimeAuditReport) => void;
  editorSession?: boolean;
  /** Elemento escolhido diretamente dentro do preview. */
  onElementSelect?: (selection: PreviewElementSelection) => void;
}

function buildSrcDoc(code: string, projectId?: string | null, editorSession = false): string {
  // O código do usuário vai como string JSON e é transpilado em runtime com
  // Babel no modo CLÁSSICO (React.createElement) — sem import de jsx-runtime,
  // que não existe no navegador sem bundler.
  const codeJson = JSON.stringify(code);
  const adScript = adGlobalScript(projectId);
  const auditSource = runtimeAuditSource();
  const selectionSource = editorSession ? visualSelectionSource() : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin></script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
<script>window.tailwind={config:{theme:{extend:{fontFamily:{sans:['Inter','ui-sans-serif','system-ui','sans-serif'],display:['Sora','Inter','ui-sans-serif','system-ui','sans-serif'],serif:['Fraunces','ui-serif','Georgia','serif'],grotesk:['Space Grotesk','Inter','ui-sans-serif','sans-serif']}}}}};</script>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:'Inter',ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:#0b1020;color:#0f172a}
  h1,h2,h3,.font-display{font-family:'Sora','Inter',ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em}
  #root{background:#ffffff}
  .nx-error{padding:20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#b91c1c;background:#fef2f2;white-space:pre-wrap;height:100%;box-sizing:border-box;overflow:auto;font-size:13px;line-height:1.5}
</style>
</head>
<body>
<div id="root"></div>
${adScript}
<script>
  // Guarda a referência real do topo ANTES de bloquear o acesso do código do usuário,
  // para conseguir reportar erros ao app (auto-correção).
  var _nxHost = window.parent;
  var _nxReported = false;
  function nxReady(){ if(_nxReported) return; try { _nxHost.postMessage({ __nx_ready: true }, '*'); } catch(e){} }
  function nxReport(msg){
    if (_nxReported) return; _nxReported = true;
    try { _nxHost.postMessage({ __nx_error: String(msg).slice(0, 800) }, '*'); } catch(e){}
  }
  ${auditSource}
  ${selectionSource}
  // Proteção: impede o código do preview de tocar na página pai / storage do app.
  try { Object.defineProperty(window, 'parent', { get: function(){ return window; } }); } catch(e){}
  try { Object.defineProperty(window, 'top', { get: function(){ return window; } }); } catch(e){}
  window.addEventListener('error', function(e){ showError(e.message); nxReport(e.message); });
  window.addEventListener('unhandledrejection', function(e){ var m=(e.reason && e.reason.message) || String(e.reason); showError(m); nxReport(m); });
  function showError(msg){
    var r = document.getElementById('root');
    if(r) r.innerHTML = '<div class="nx-error">⚠ Erro ao executar o app:\\n\\n' + String(msg).replace(/</g,'&lt;') + '</div>';
  }
</script>
<script>
  (function(){
    var USERCODE = ${codeJson};
    try {
      var out = Babel.transform(USERCODE, {
        presets: [['react', { runtime: 'classic' }], 'typescript'],
        filename: 'app.tsx'
      }).code;
      var factory = new Function('React', 'ReactDOM',
        'var {useState,useEffect,useRef,useMemo,useCallback,useReducer,useContext,createContext,Fragment} = React;'
        + out + '\\n; return typeof App !== "undefined" ? App : null;');
      var App = factory(React, ReactDOM);
      if (!App) { showError('O código não definiu um componente App.'); nxReport('O código não definiu um componente App.'); return; }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
      setTimeout(function(){ nxPostAudit(); nxReady(); }, 500);
    } catch (err) {
      var m = (err && err.message) || String(err);
      showError(m); nxReport(m);
    }
  })();
</script>
</body>
</html>`;
}

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
function detectExternals(files: AppFile[]): string[] {
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
 * Runtime multi-arquivo: cada arquivo vira um módulo CommonJS (Babel), com um
 * `require` que resolve imports relativos (./ ../, extensões, /index) contra um
 * registro de módulos. React/ReactDOM (e libs externas via CDN) são "externals".
 * É como um bundler mínimo rodando no próprio navegador — sem servidor, sem npm.
 */
function buildSrcDocMulti(files: AppFile[], entry: string, projectId?: string | null, editorSession = false): string {
  const map: Record<string, string> = {};
  for (const f of files) map[f.path.replace(/^\.?\//, "")] = f.content;
  const filesJson = JSON.stringify(map);
  const entryJson = JSON.stringify(entry.replace(/^\.?\//, ""));
  const adScript = adGlobalScript(projectId);
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
      // Mesmo no runtime Babel de contingência, um nome inventado pela IA não
      // pode derrubar o app inteiro. O Proxy devolve um ícone neutro e mantém a
      // interface funcional até a edição seguinte substituir o nome.
      var fallback = out.Gauge || out.Circle || make([['circle',{cx:12,cy:12,r:9}]]);
      __lucideCache = typeof Proxy === 'function'
        ? new Proxy(out, { get: function(target, key){ return target[key] || fallback; } })
        : out;
      return __lucideCache;
    }
    function external(spec){
      if(spec==='react') return React;
      if(spec==='react-dom'||spec==='react-dom/client') return ReactDOM;
      if(spec==='recharts') return window.Recharts;
      if(spec==='lodash') return window._;
      if(spec==='clsx') return window.clsx;
      if(spec==='prop-types') return window.PropTypes;
      if(spec==='lucide-react') return lucideShim();
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
      if(!key) throw new Error('Módulo não encontrado: "'+spec+'" (só são suportados imports relativos e as libs: react, react-dom, recharts, lucide-react, lodash, clsx).');
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
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
      setTimeout(function(){ nxPostAudit(); nxReady(); }, 500);
    } catch(err){ var m=(err && err.message) || String(err); showError(m); nxReport(m); }
  })();
</script>
</body>
</html>`;
}

export function AppRunner({
  code,
  files,
  entry,
  version,
  engineMode,
  projectId,
  onError,
  onReady,
  onAudit,
  editorSession = false,
  onElementSelect,
}: AppRunnerProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [srcDoc, setSrcDoc] = useState("");
  const [bundling, setBundling] = useState(false);
  const [health, setHealth] = useState<"checking" | "healthy" | "error">("checking");
  const [auditPhase, setAuditPhase] = useState<"desktop" | "mobile" | "done">("desktop");
  const [auditReport, setAuditReport] = useState<RuntimeAuditReport | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const onAuditRef = useRef(onAudit);
  const desktopAuditRef = useRef<RuntimeAuditReport | null>(null);
  const mobileAuditRef = useRef<RuntimeAuditReport | null>(null);
  const pendingReadyRef = useRef(false);
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  onAuditRef.current = onAudit;
  const reportPreviewError = useCallback((message: string) => {
    setHealth("error");
    onErrorRef.current?.(message);
  }, []);
  const reportPreviewReady = useCallback(() => {
    if (!desktopAuditRef.current || !mobileAuditRef.current) {
      pendingReadyRef.current = true;
      return;
    }
    setHealth("healthy");
    onReadyRef.current?.();
  }, []);
  const reportPreviewAudit = useCallback((report: RuntimeAuditReport) => {
    if (report.viewport.width > 500 && !desktopAuditRef.current) {
      desktopAuditRef.current = report;
      setAuditPhase("mobile");
      return;
    }
    if (report.viewport.width <= 500) mobileAuditRef.current = report;
    else if (!desktopAuditRef.current) desktopAuditRef.current = report;

    if (!desktopAuditRef.current || !mobileAuditRef.current) return;
    const issueMap = new Map<string, RuntimeAuditReport["issues"][number]>();
    for (const issue of desktopAuditRef.current.issues.concat(mobileAuditRef.current.issues)) {
      issueMap.set(`${issue.severity}:${issue.code}:${issue.message}`, issue);
    }
    const combined: RuntimeAuditReport = {
      ...desktopAuditRef.current,
      issues: Array.from(issueMap.values()),
      viewport: mobileAuditRef.current.viewport,
      checkedAt: Math.max(desktopAuditRef.current.checkedAt, mobileAuditRef.current.checkedAt),
    };
    setAuditReport(combined);
    setAuditPhase("done");
    onAuditRef.current?.(combined);
    if (pendingReadyRef.current && !combined.issues.some((issue) => issue.severity === "error")) {
      pendingReadyRef.current = false;
      setHealth("healthy");
      onReadyRef.current?.();
    }
  }, []);
  usePreviewBridge(iframeRef, projectId, reportPreviewError, editorSession, reportPreviewReady, reportPreviewAudit);

  useEffect(() => {
    if (!editorSession || !onElementSelect) return;
    const receiveSelection = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.__nx_visual_selected !== true) return;
      const selection = normalizePreviewSelection(data.selection);
      if (!selection) return;
      setSelectionMode(false);
      onElementSelect(selection);
    };
    window.addEventListener("message", receiveSelection);
    return () => window.removeEventListener("message", receiveSelection);
  }, [editorSession, onElementSelect]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      __nx_visual_mode: true,
      enabled: selectionMode,
    }, "*");
  }, [selectionMode, srcDoc, reloadKey]);

  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasContent = hasFiles || !!code;

  // Monta o preview: multi-arquivo passa pelo bundler esbuild (npm arbitrário via
  // esm.sh); se o esbuild falhar, cai no runtime Babel. Single-file legado usa Babel.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHealth("checking");
    setAuditPhase("desktop");
    setAuditReport(null);
    desktopAuditRef.current = null;
    mobileAuditRef.current = null;
    pendingReadyRef.current = false;
    if (hasFiles) {
      setBundling(true);
      const list = files!;
      const ent = entry || list[0].path;
      bundleApp(list, ent)
        .then(({ code: bundled }) => {
          if (cancelled) return;
          setSrcDoc(buildBundledSrcDoc(bundled, projectId, { editorSession }));
        })
        .catch(() => {
          // Fallback resiliente: runtime Babel (React + libs via CDN).
          if (cancelled) return;
          setSrcDoc(buildSrcDocMulti(list, ent, projectId, editorSession));
        })
        .finally(() => {
          if (!cancelled) setBundling(false);
        });
    } else if (code) {
      setBundling(false);
      setSrcDoc(buildSrcDoc(code, projectId, editorSession));
    } else {
      setBundling(false);
      setSrcDoc("");
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, files, entry, version, reloadKey, projectId, editorSession]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <div className={cn("flex flex-col", expanded ? "fixed inset-0 z-50 bg-background" : "h-full")}>
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="fixed right-4 top-4 z-[60] inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow-lg backdrop-blur transition-transform hover:scale-105"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Sair da tela cheia (Esc)
        </button>
      )}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn(
            "flex h-2 w-2 rounded-full",
            health === "healthy" ? "bg-emerald-500" : health === "error" ? "bg-red-500" : "animate-pulse bg-amber-400"
          )} />
          {health === "healthy" ? "Preview aprovado" : health === "error" ? "Erro no preview" : "Verificando preview…"}
          {auditReport && auditReport.issues.some((issue) => issue.severity === "warning") && (
            <span
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
              title={auditReport.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message).join("\n")}
            >
              {auditReport.issues.filter((issue) => issue.severity === "warning").length} avisos de qualidade
            </span>
          )}
          {engineMode && (
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                engineMode === "real"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : engineMode === "template"
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                  : "bg-red-500/15 text-red-600 dark:text-red-300"
              )}
              title="Modo do motor que gerou este código"
            >
              {engineMode === "real" ? (
                <>
                  <Cpu className="h-3 w-3" /> Código real
                </>
              ) : engineMode === "template" ? (
                <>
                  <Layout className="h-3 w-3" /> Template
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3" /> Demo
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editorSession && onElementSelect && (
            <button
              onClick={() => setSelectionMode((active) => !active)}
              aria-label={selectionMode ? "Cancelar seleção visual" : "Selecionar elemento no preview"}
              title={selectionMode ? "Clique novamente para cancelar" : "Clique e escolha um texto, botão, imagem ou seção"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                selectionMode
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <ScanSearch className="h-4 w-4" />
              <span className="hidden sm:inline">{selectionMode ? "Clique no elemento" : "Selecionar"}</span>
            </button>
          )}
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="Recarregar app"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDevice("desktop")}
            aria-label="Desktop"
            className={cn("rounded-md p-1.5 transition-colors", device === "desktop" ? "bg-secondary text-foreground" : "text-muted-foreground")}
          >
            <Monitor className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDevice("mobile")}
            aria-label="Mobile"
            className={cn("rounded-md p-1.5 transition-colors", device === "mobile" ? "bg-secondary text-foreground" : "text-muted-foreground")}
          >
            <Smartphone className="h-4 w-4" />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Sair da tela cheia" : "Ver em tela cheia"}
            title={expanded ? "Sair da tela cheia (Esc)" : "Ver em tela cheia"}
            className={cn(
              "rounded-md p-1.5 transition-colors hover:bg-secondary hover:text-foreground",
              expanded ? "bg-secondary text-foreground" : "text-muted-foreground"
            )}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-secondary/40 p-4">
        {!hasContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <AlertTriangle className="mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Descreva o app no chat para gerar e executar o código.</p>
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto h-full overflow-hidden rounded-xl border bg-white shadow-xl transition-all",
              auditPhase === "mobile" || (auditPhase === "done" && device === "mobile") ? "max-w-[390px]" : "max-w-5xl"
            )}
          >
            {(loading || bundling) && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-secondary/40">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                {bundling && <span className="text-xs text-muted-foreground">Empacotando (npm)…</span>}
              </div>
            )}
            <iframe
              key={reloadKey}
              ref={iframeRef}
              title="Preview do app"
              sandbox="allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
              allow="microphone; autoplay; clipboard-write"
              srcDoc={srcDoc}
              onLoad={() => {
                setLoading(false);
                iframeRef.current?.contentWindow?.postMessage({
                  __nx_visual_mode: true,
                  enabled: selectionMode,
                }, "*");
              }}
              allowFullScreen
              className="h-full w-full border-0 bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}
