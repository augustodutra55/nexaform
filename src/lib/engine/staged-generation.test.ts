import { describe, expect, it } from "vitest";
import {
  buildMasterPrompt,
  buildStagePrompt,
  isValidStagedBuildJob,
  sanitizeGenerationPrompt,
  shouldStageInitialBuild,
  stagedBuildStages,
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
  it("remove erro operacional e a especificação duplicada do prompt", () => {
    const request = `${"Crie uma esmalteria com agenda, notificações, paleta de cores e experiência elegante. ".repeat(4)}Inclua cadastro de clientes, horários disponíveis e confirmação pelo WhatsApp.`.trim();
    const polluted = `${request} Ops — Não foi possível reservar sua geração. Tente novamente. ${request}`;
    expect(sanitizeGenerationPrompt(polluted)).toBe(request);
    expect(buildMasterPrompt(polluted, [])).not.toContain("Ops —");
    expect(shouldStageInitialBuild(polluted, [], false)).toBe(true);
  });

  it("divide produto operacional curto mesmo sem superprompt longo", () => {
    const agenda = "Crie um app SaaS de agendamento para uma clínica: login, cadastro, agenda por dia e horário, cadastro de clientes, confirmação, reagendamento, cancelamento e estados de vazio, carregando e erro. Precisa funcionar bem no celular.";
    const dashboard = "Crie um dashboard de gestão B2B para equipe comercial com KPIs, clientes, funil, tarefas, filtros e navegação responsiva. Deve ser um sistema profissional, rápido, com estados operacionais claros e sem botões decorativos.";
    expect(shouldStageInitialBuild(agenda, [], false)).toBe(true);
    expect(shouldStageInitialBuild(dashboard, [], false)).toBe(true);
  });

  it("mantém landing simples em geração única", () => {
    const landing = "Crie uma landing page profissional e vendável para uma consultoria empresarial, com hero forte, benefícios, prova social, formulário de contato, FAQ e CTA recorrente. Visual premium, moderno e responsivo.";
    expect(shouldStageInitialBuild(landing, [], false)).toBe(false);
  });

  it("limpa também trabalhos já persistidos antes de montar a etapa", () => {
    const request = "Crie uma esmalteria com agenda e notificações para clientes.";
    const prompt = buildStagePrompt(
      `${request} Ops — A geração passou do tempo limite. ${request}`,
      stagedBuildStages()[0],
      0,
      7
    );
    expect(prompt).toContain(request);
    expect(prompt).not.toContain("Ops —");
    expect(prompt).toContain("no máximo 3 arquivos");
  });

  it("limita a etapa de dados a um fluxo vertical curto", () => {
    const stage = stagedBuildStages()[1];
    expect(stage.id).toBe("core-data");
    expect(stage.instruction).toContain("no máximo 3 arquivos");
    expect(stage.instruction).toContain("abaixo de 120 linhas");
    expect(stage.instruction).toContain("entidade central");
  });

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
