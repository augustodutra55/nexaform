import { describe, expect, it } from "vitest";
import { hasRemoteConflict, isSyncableProjectPath, normalizeBranch, normalizeRepository, normalizeRootPath } from "./github-sync";

describe("github-sync", () => {
  it("normaliza URLs e SSH de repositório", () => {
    expect(normalizeRepository("https://github.com/acme/app.git")).toEqual({ owner: "acme", repo: "app" });
    expect(normalizeRepository("git@github.com:acme/app.git")).toEqual({ owner: "acme", repo: "app" });
    expect(normalizeRepository("acme/app")).toEqual({ owner: "acme", repo: "app" });
  });

  it("rejeita repositório e branch inseguros", () => {
    expect(normalizeRepository("acme/app/extra")).toBeNull();
    expect(normalizeBranch("feature/ok")).toBe("feature/ok");
    expect(normalizeBranch("../main")).toBeNull();
    expect(normalizeBranch("main branch")).toBeNull();
  });

  it("normaliza pasta raiz sem permitir travessia", () => {
    expect(normalizeRootPath("apps/web/")).toBe("apps/web");
    expect(normalizeRootPath("../secret")).toBeNull();
  });

  it("nunca sincroniza secrets, git ou artefatos locais", () => {
    expect(isSyncableProjectPath("src/App.tsx")).toBe(true);
    expect(isSyncableProjectPath(".env.local")).toBe(false);
    expect(isSyncableProjectPath(".git/config")).toBe(false);
    expect(isSyncableProjectPath("node_modules/pkg/index.js")).toBe(false);
    expect(isSyncableProjectPath("../secret.txt")).toBe(false);
  });

  it("detecta conflito quando remoto e local mudaram desde o último sync", () => {
    expect(hasRemoteConflict({ lastRemoteSha: "a", currentRemoteSha: "b", localChanged: true })).toBe(true);
    expect(hasRemoteConflict({ lastRemoteSha: "a", currentRemoteSha: "a", localChanged: true })).toBe(false);
    expect(hasRemoteConflict({ lastRemoteSha: "a", currentRemoteSha: "b", localChanged: false })).toBe(false);
  });
});
