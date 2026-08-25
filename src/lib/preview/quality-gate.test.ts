import { describe, expect, it } from "vitest";
import { previewGateAction } from "./quality-gate";

const ready = {
  pendingReady: true,
  hasDesktopAudit: true,
  hasMobileAudit: true,
  hasBlockingIssue: false,
  hasSmokeResult: false,
  smokeTriggered: false,
};

describe("previewGateAction", () => {
  it("exige auditoria nos dois breakpoints antes do smoke", () => {
    expect(previewGateAction({ ...ready, hasMobileAudit: false })).toBe("wait");
  });

  it("bloqueia erro de runtime ou responsividade", () => {
    expect(previewGateAction({ ...ready, hasBlockingIssue: true })).toBe("block");
  });

  it("dispara smoke uma única vez e só aprova com o resultado", () => {
    expect(previewGateAction(ready)).toBe("run-smoke");
    expect(previewGateAction({ ...ready, smokeTriggered: true })).toBe("wait");
    expect(previewGateAction({ ...ready, smokeTriggered: true, hasSmokeResult: true })).toBe("approve");
  });
});
