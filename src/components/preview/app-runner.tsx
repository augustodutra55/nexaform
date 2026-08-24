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
import { AlertTriangle, Loader2, Monitor, Smartphone, RefreshCw, Cpu, Layout, Maximize2, Minimize2, ScanSearch, TestTube2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppFile, EngineMode } from "@/lib/engine/app-types";
import { bundleApp, buildBundledSrcDoc } from "@/lib/preview/bundler";
import { buildMultiFileSrcDoc } from "@/lib/preview/multi-file-srcdoc";
import { adGlobalScript } from "@/lib/preview/ad-global";
import { runtimeAuditSource, type RuntimeAuditReport } from "@/lib/preview/runtime-audit";
import { previewGateAction } from "@/lib/preview/quality-gate";
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
  const adScript = adGlobalScript(projectId, { admin: editorSession });
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
      var __adRoot = ReactDOM.createRoot(document.getElementById('root'));
      window.__adRerender = function(){ try { __adRoot.render(React.createElement(App)); } catch(e){} };
      window.addEventListener('ad:settings-changed', window.__adRerender);
      __adRoot.render(React.createElement(App));
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
  const [smokeRunning, setSmokeRunning] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const onAuditRef = useRef(onAudit);
  const desktopAuditRef = useRef<RuntimeAuditReport | null>(null);
  const mobileAuditRef = useRef<RuntimeAuditReport | null>(null);
  const pendingReadyRef = useRef(false);
  const autoSmokeTriggeredRef = useRef(false);
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  onAuditRef.current = onAudit;
  const reportPreviewError = useCallback((message: string) => {
    setHealth("error");
    onErrorRef.current?.(message);
  }, []);
  const reportPreviewReady = useCallback(() => {
    // A montagem do React é somente o primeiro sinal. A aprovação acontece no
    // callback de auditoria, depois de desktop, mobile e smoke automático.
    pendingReadyRef.current = true;
  }, []);
  const reportPreviewAudit = useCallback((report: RuntimeAuditReport) => {
    const firstDesktop = report.viewport.width > 500 && !desktopAuditRef.current;
    if (report.viewport.width > 500) desktopAuditRef.current = report;
    else mobileAuditRef.current = report;
    if (firstDesktop && !mobileAuditRef.current) {
      setAuditPhase("mobile");
      return;
    }

    if (!desktopAuditRef.current || !mobileAuditRef.current) return;
    const issueMap = new Map<string, RuntimeAuditReport["issues"][number]>();
    for (const issue of desktopAuditRef.current.issues.concat(mobileAuditRef.current.issues)) {
      issueMap.set(`${issue.severity}:${issue.code}:${issue.message}`, issue);
    }
    const combined: RuntimeAuditReport = {
      ...desktopAuditRef.current,
      issues: Array.from(issueMap.values()),
      smoke: report.smoke ?? desktopAuditRef.current.smoke ?? mobileAuditRef.current.smoke,
      viewport: mobileAuditRef.current.viewport,
      checkedAt: Math.max(desktopAuditRef.current.checkedAt, mobileAuditRef.current.checkedAt),
    };
    setAuditReport(combined);
    if (combined.smoke) setSmokeRunning(false);
    setAuditPhase("done");
    onAuditRef.current?.(combined);
    const gate = previewGateAction({
      pendingReady: pendingReadyRef.current,
      hasDesktopAudit: !!desktopAuditRef.current,
      hasMobileAudit: !!mobileAuditRef.current,
      hasBlockingIssue: combined.issues.some((issue) => issue.severity === "error"),
      hasSmokeResult: !!combined.smoke,
      smokeTriggered: autoSmokeTriggeredRef.current,
    });
    if (gate === "run-smoke") {
      autoSmokeTriggeredRef.current = true;
      setSmokeRunning(true);
      iframeRef.current?.contentWindow?.postMessage({ __nx_run_smoke: true }, "*");
      return;
    }
    if (gate === "approve") {
      pendingReadyRef.current = false;
      setHealth("healthy");
      onReadyRef.current?.();
    }
  }, []);

  const runSmokeTest = useCallback(() => {
    setSmokeRunning(true);
    iframeRef.current?.contentWindow?.postMessage({ __nx_run_smoke: true }, "*");
  }, []);

  useEffect(() => {
    if (!smokeRunning) return;
    const timeout = window.setTimeout(() => {
      setSmokeRunning(false);
      if (autoSmokeTriggeredRef.current && !auditReport?.smoke) {
        reportPreviewError("O teste automático de navegação não terminou dentro do limite.");
      }
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, [auditReport?.smoke, reportPreviewError, smokeRunning]);
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
    autoSmokeTriggeredRef.current = false;
    setSmokeRunning(false);
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
          setSrcDoc(buildMultiFileSrcDoc(list, ent, projectId, editorSession));
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
          {editorSession && (
            <button
              type="button"
              onClick={runSmokeTest}
              disabled={smokeRunning || health === "error" || loading}
              aria-label="Testar navegação do aplicativo"
              title="Percorre menus e abas sem enviar formulários nem executar ações destrutivas"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {smokeRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{smokeRunning ? "Testando…" : "Testar fluxos"}</span>
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
