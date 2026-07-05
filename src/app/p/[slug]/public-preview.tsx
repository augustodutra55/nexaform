"use client";

import { useState } from "react";
import { AppSchema } from "@/lib/engine/types";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";

export function PublicPreview({ schema, appCode }: { schema: AppSchema | null; appCode?: string | null }) {
  const [pageId, setPageId] = useState<string | null>(schema?.pages[0]?.id ?? null);

  if (appCode) {
    return (
      <div className="h-[calc(100vh-3rem)]">
        <AppRunner code={appCode} />
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
