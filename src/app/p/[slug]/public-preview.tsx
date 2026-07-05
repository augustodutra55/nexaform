"use client";

import { useState } from "react";
import { AppSchema } from "@/lib/engine/types";
import { PreviewPane } from "@/components/preview/preview-pane";

export function PublicPreview({ schema }: { schema: AppSchema }) {
  const [pageId, setPageId] = useState<string | null>(schema.pages[0]?.id ?? null);

  return (
    <div className="h-[calc(100vh-3rem)]">
      <PreviewPane schema={schema} currentPageId={pageId} onNavigate={setPageId} readOnly />
    </div>
  );
}
