"use client";

import { useState } from "react";
import { AppRunner } from "@/components/preview/app-runner";
import type { AppCode } from "@/lib/engine/app-types";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

export function GoldenRuntimeHarness({
  fixture,
}: {
  fixture: { id: string; name: string; app: AppCode };
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<RuntimeAuditReport | null>(null);
  const runtimeErrors = audit?.issues.filter((issue) => issue.severity === "error") ?? [];
  const mobileOverflow = audit?.issues.some((issue) => issue.code === "mobile_overflow") ?? false;

  return (
    <main className="h-screen min-h-[640px] bg-background">
      <div className="sr-only" aria-live="polite">
        <span data-testid="golden-case">{fixture.id}</span>
        {ready ? <span data-testid="golden-runtime-ready">preview aprovado</span> : null}
        {error ? <span data-testid="golden-runtime-error">{error}</span> : null}
        {audit ? <span data-testid="golden-runtime-audit">{runtimeErrors.length}:{mobileOverflow ? 1 : 0}</span> : null}
        {audit?.smoke ? <span data-testid="golden-runtime-smoke">{audit.smoke.attempted}:{audit.smoke.changed}:{audit.smoke.fieldsAttempted}:{audit.smoke.fieldsEditable}</span> : null}
      </div>
      <AppRunner
        code={fixture.app.code}
        files={fixture.app.files}
        entry={fixture.app.entry}
        version={`golden-${fixture.id}`}
        engineMode="real"
        onReady={() => setReady(true)}
        onError={setError}
        onAudit={setAudit}
        editorSession
      />
    </main>
  );
}
