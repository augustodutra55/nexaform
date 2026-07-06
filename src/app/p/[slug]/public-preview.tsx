"use client";

import { useState } from "react";
import { AppSchema } from "@/lib/engine/types";
import { AppFile } from "@/lib/engine/app-types";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";

export function PublicPreview({
  schema,
  appCode,
  appFiles,
  appEntry,
}: {
  schema: AppSchema | null;
  appCode?: string | null;
  appFiles?: AppFile[] | null;
  appEntry?: string | null;
}) {
  const [pageId, setPageId] = useState<string | null>(schema?.pages[0]?.id ?? null);

  if ((appFiles && appFiles.length) || appCode) {
    return (
      <div className="h-[calc(100vh-3rem)]">
        <AppRunner code={appCode ?? ""} files={appFiles} entry={appEntry} />
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
