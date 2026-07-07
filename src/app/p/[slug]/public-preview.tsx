"use client";

import { useState } from "react";
import { AppSchema } from "@/lib/engine/types";
import { AppFile } from "@/lib/engine/app-types";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";
import { PrebuiltRunner } from "@/components/preview/prebuilt-runner";

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
