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
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Monitor, Smartphone, RefreshCw, Cpu, Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineMode } from "@/lib/engine/app-types";

interface AppRunnerProps {
  code: string;
  /** chave para forçar recarregamento quando o código muda */
  version?: string | number;
  /** modo do motor que gerou este código (real/template/demo) — exibido no topo. */
  engineMode?: EngineMode | null;
  /** chamado quando o app dá erro de execução (para auto-correção). */
  onError?: (message: string) => void;
}

function buildSrcDoc(code: string): string {
  // O código do usuário vai como string JSON e é transpilado em runtime com
  // Babel no modo CLÁSSICO (React.createElement) — sem import de jsx-runtime,
  // que não existe no navegador sem bundler.
  const codeJson = JSON.stringify(code);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0b1020;color:#0f172a}
  #root{background:#ffffff}
  .nx-error{padding:20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#b91c1c;background:#fef2f2;white-space:pre-wrap;height:100%;box-sizing:border-box;overflow:auto;font-size:13px;line-height:1.5}
</style>
</head>
<body>
<div id="root"></div>
<script>
  // Guarda a referência real do topo ANTES de bloquear o acesso do código do usuário,
  // para conseguir reportar erros ao app (auto-correção).
  var _nxHost = window.parent;
  var _nxReported = false;
  function nxReport(msg){
    if (_nxReported) return; _nxReported = true;
    try { _nxHost.postMessage({ __nx_error: String(msg).slice(0, 800) }, '*'); } catch(e){}
  }
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
    } catch (err) {
      var m = (err && err.message) || String(err);
      showError(m); nxReport(m);
    }
  })();
</script>
</body>
</html>`;
}

export function AppRunner({ code, version, engineMode, onError }: AppRunnerProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const srcDoc = useMemo(() => (code ? buildSrcDoc(code) : ""), [code, version, reloadKey]);

  useEffect(() => {
    setLoading(true);
  }, [srcDoc]);

  // Escuta erros de execução vindos do iframe (para auto-correção).
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e?.data && typeof e.data === "object" && typeof e.data.__nx_error === "string") {
        onErrorRef.current?.(e.data.__nx_error);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          App em execução
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
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-secondary/40 p-4">
        {!code ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <AlertTriangle className="mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Descreva o app no chat para gerar e executar o código.</p>
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto h-full overflow-hidden rounded-xl border bg-white shadow-xl transition-all",
              device === "mobile" ? "max-w-[390px]" : "max-w-5xl"
            )}
          >
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-secondary/40">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            )}
            <iframe
              key={reloadKey}
              ref={iframeRef}
              title="Preview do app"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals"
              srcDoc={srcDoc}
              onLoad={() => setLoading(false)}
              className="h-full w-full border-0 bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}
