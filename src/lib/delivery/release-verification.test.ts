import { describe, expect, it } from "vitest";
import {
  RELEASE_PROBE_CHANNEL,
  parseReleaseProbeMessage,
  releaseProbeUrl,
  runtimeProbeMessage,
} from "./release-verification";

describe("verificação da publicação", () => {
  it("converte somente sinais reais do runtime", () => {
    expect(runtimeProbeMessage({ __nx_ready: true })).toEqual({
      channel: RELEASE_PROBE_CHANNEL,
      status: "ready",
    });
    expect(runtimeProbeMessage({ __nx_error: "Falha no bundle" })).toMatchObject({
      status: "error",
      message: "Falha no bundle",
    });
    expect(runtimeProbeMessage({ qualquer: true })).toBeNull();
  });

  it("rejeita mensagens sem o canal de publicação", () => {
    expect(parseReleaseProbeMessage({ channel: "outro", status: "ready" })).toBeNull();
    expect(parseReleaseProbeMessage({ channel: RELEASE_PROBE_CHANNEL, status: "ready" }))
      .toMatchObject({ status: "ready" });
  });

  it("monta uma URL de prova sem permitir injeção no caminho", () => {
    expect(releaseProbeUrl("cliente final", "abc/123"))
      .toBe("/p/cliente%20final?releaseProbe=abc%2F123");
  });
});
