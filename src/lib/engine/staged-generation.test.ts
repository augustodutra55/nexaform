import { describe, expect, it } from "vitest";
import {
  isValidStagedBuildJob,
  stagedJobForCloud,
  STAGED_BUILD_VERSION,
  type StagedBuildJob,
} from "./staged-generation";

const job: StagedBuildJob = {
  version: STAGED_BUILD_VERSION,
  projectId: "project-1",
  threadId: "thread-1",
  originalPrompt: "Crie um aplicativo",
  masterPrompt: "Crie um aplicativo completo",
  kind: "initial",
  imageAttachments: [{
    id: "attachment-1",
    kind: "image",
    name: "referencia.png",
    type: "image/png",
    size: 4,
    content: "data:image/png;base64,AAAA",
  }],
  visualRefinement: {
    selection: {
      tag: "button",
      selector: "button.cta",
      label: "Comprar",
      text: "Comprar",
      role: "button",
      nearbyText: "Plano Pro Comprar",
    },
    sourceCandidates: [{
      path: "components/Pricing.jsx",
      score: 18,
      evidence: "<button>Comprar</button>",
    }],
    baseline: [{
      path: "components/Pricing.jsx",
      signature: "25:abc123",
    }],
  },
  nextStage: 2,
  startedAt: "2026-07-23T12:00:00.000Z",
};

describe("retomada da geração por etapas", () => {
  it("aceita um trabalho compatível com o projeto e a conversa", () => {
    expect(isValidStagedBuildJob(job, "project-1", "thread-1")).toBe(true);
  });

  it("rejeita trabalho de outro projeto ou já concluído", () => {
    expect(isValidStagedBuildJob(job, "project-2", "thread-1")).toBe(false);
    expect(isValidStagedBuildJob({ ...job, nextStage: 7 }, "project-1", "thread-1")).toBe(false);
  });

  it("remove imagens pesadas da cópia persistida na nuvem", () => {
    const cloud = stagedJobForCloud(job);
    expect(cloud.imageAttachments).toBeUndefined();
    expect(cloud.nextStage).toBe(2);
    expect(cloud.visualRefinement).toEqual(job.visualRefinement);
    expect(job.imageAttachments).toHaveLength(1);
  });

  it("rejeita um contrato visual corrompido", () => {
    expect(isValidStagedBuildJob({
      ...job,
      visualRefinement: { ...job.visualRefinement, baseline: "inválida" },
    }, "project-1", "thread-1")).toBe(false);
  });
});
