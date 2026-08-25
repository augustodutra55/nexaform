export type PreviewGateAction = "wait" | "block" | "run-smoke" | "approve";

/** Decisão pura do gate de preview. Uma versão só é aprovada depois de ter
 * auditoria desktop + mobile, zero erro bloqueante e smoke test concluído. */
export function previewGateAction(input: {
  pendingReady: boolean;
  hasDesktopAudit: boolean;
  hasMobileAudit: boolean;
  hasBlockingIssue: boolean;
  hasSmokeResult: boolean;
  smokeTriggered: boolean;
}): PreviewGateAction {
  if (!input.pendingReady || !input.hasDesktopAudit || !input.hasMobileAudit) return "wait";
  if (input.hasBlockingIssue) return "block";
  if (input.hasSmokeResult) return "approve";
  return input.smokeTriggered ? "wait" : "run-smoke";
}
