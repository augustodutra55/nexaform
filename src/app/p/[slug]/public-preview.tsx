"use client";

import { useEffect, useState } from "react";
import { AppSchema } from "@/lib/engine/types";
import { AppFile } from "@/lib/engine/app-types";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";
import { PrebuiltRunner } from "@/components/preview/prebuilt-runner";
import { runtimeProbeMessage } from "@/lib/delivery/release-verification";

export function PublicPreview({
  schema,
  appCode,
  appFiles,
  appEntry,
  projectId,
  bundle,
}: {
  schema: AppSchema | null;
  appCode?: string | null;
  appFiles?: AppFile[] | null;
  appEntry?: string | null;
  projectId?: string | null;
  bundle?: string | null;
}) {
  const [pageId, setPageId] = useState<string | null>(schema?.pages[0]?.id ?? null);

  useEffect(() => {
    // Quando a publicação é aberta no verificador oculto do estúdio, repassa
    // somente o sinal de montagem/erro emitido pelo runtime isolado. A página
    // pública é same-origin; o iframe do app continua sandboxed e sem cookies.
    function forwardRuntimeProbe(event: MessageEvent) {
      if (window.parent === window || event.source === window) return;
      const message = runtimeProbeMessage(event.data);
      if (!message) return;
      window.parent.postMessage(message, window.location.origin);
    }
    window.addEventListener("message", forwardRuntimeProbe);
    return () => window.removeEventListener("message", forwardRuntimeProbe);
  }, []);

  if ((appFiles && appFiles.length) || appCode) {
    return (
      <div className="h-[calc(100vh-3rem)]">
        {bundle ? (
          // Caminho rápido: bundle pré-compilado na publicação (sem Babel/esbuild no visitante).
          <PrebuiltRunner bundle={bundle} projectId={projectId} />
        ) : (
          // Fallback: apps publicados antes do build de produção usam o runtime completo.
          <AppRunner code={appCode ?? ""} files={appFiles} entry={appEntry} projectId={projectId} />
        )}
      </div>
    );
  }

  if (!schema) return null;

  return (
    <div className="h-[calc(100vh-3rem)]">
      <PreviewPane schema={schema} currentPageId={pageId} onNavigate={setPageId} readOnly />
    </div>
  );
}
