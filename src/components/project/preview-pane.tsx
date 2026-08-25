"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, PanelRightClose, PanelRightOpen, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

/**
 * PreviewPane — emoldura um <iframe> apontado para a rota server-side
 * /preview/[projectId]/[versionId] (Fase 4). O HTML é empacotado no servidor
 * por bundler.ts e já embute a ponte de runtime (runtime-audit.ts): o iframe
 * envia `__nx_error` a cada erro e `__nx_audit`/nxPostAudit ao montar.
 *
 * Erros de console/execução aparecem num slider lateral. Diferente do editor
 * (AppRunner), aqui o preview é uma URL navegável e compartilhável — o iframe
 * atualiza sozinho quando a versão muda (nova key remonta o frame).
 */

interface PreviewPaneProps {
  projectId: string;
  versionId: string;
  /** Rótulo opcional (ex.: nome da etapa concluída). */
  title?: string;
}

interface ConsoleEntry {
  id: number;
  message: string;
  at: number;
}

export function PreviewPane({ projectId, versionId, title }: PreviewPaneProps) {
  const src = useMemo(
    () => `/preview/${encodeURIComponent(projectId)}/${encodeURIComponent(versionId)}`,
    [projectId, versionId]
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [errors, setErrors] = useState<ConsoleEntry[]>([]);
  const [warnings, setWarnings] = useState<number>(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nextId = useRef(0);

  // Uma versão nova (ou reload manual) zera o estado e remonta o iframe.
  useEffect(() => {
    setErrors([]);
    setWarnings(0);
    setLoading(true);
  }, [src, reloadKey]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (typeof data.__nx_error === "string") {
        setErrors((prev) => [...prev, { id: nextId.current++, message: data.__nx_error, at: Date.now() }].slice(-50));
        setDrawerOpen(true);
      } else if (data.__nx_audit) {
        const report = data.__nx_audit as RuntimeAuditReport;
        const warns = report.issues?.filter((issue) => issue.severity === "warning").length ?? 0;
        const errs = report.issues?.filter((issue) => issue.severity === "error") ?? [];
        setWarnings(warns);
        if (errs.length) {
          setErrors((prev) => {
            const merged = [...prev];
            for (const issue of errs) merged.push({ id: nextId.current++, message: issue.message, at: Date.now() });
            return merged.slice(-50);
          });
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "flex h-2 w-2 rounded-full",
              errors.length ? "bg-red-500" : loading ? "animate-pulse bg-amber-400" : "bg-emerald-500"
            )}
          />
          {errors.length ? "Erros no preview" : loading ? "Carregando preview…" : "Preview pronto"}
          {title && <span className="text-foreground/70">· {title}</span>}
          {warnings > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {warnings} aviso{warnings > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="Recarregar preview"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? "Fechar painel de erros" : "Abrir painel de erros"}
            title="Erros de console"
            className={cn(
              "relative rounded-md p-1.5 transition-colors hover:bg-secondary hover:text-foreground",
              errors.length ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
            )}
          >
            {drawerOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            {errors.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {errors.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex-1 overflow-hidden bg-white">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-secondary/40">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
          <iframe
            key={`${src}#${reloadKey}`}
            ref={iframeRef}
            title="Preview do app"
            src={src}
            sandbox="allow-scripts allow-popups allow-modals allow-downloads"
            allow="microphone; autoplay; encrypted-media; picture-in-picture; clipboard-write"
            allowFullScreen
            onLoad={() => setLoading(false)}
            className="h-full w-full border-0 bg-white"
          />
        </div>

        {/* Slider lateral de erros de console/execução */}
        {drawerOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-l bg-background">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                Console ({errors.length})
              </span>
              {errors.length > 0 && (
                <button
                  onClick={() => setErrors([])}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2 scrollbar-thin">
              {errors.length === 0 ? (
                <p className="p-2 text-center text-xs text-muted-foreground">Nenhum erro registrado.</p>
              ) : (
                errors.map((entry) => (
                  <pre
                    key={entry.id}
                    className="mb-1.5 whitespace-pre-wrap break-all rounded-md bg-red-500/10 p-2 font-mono text-[11px] leading-4 text-red-700 dark:text-red-300"
                  >
                    {entry.message}
                  </pre>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
