import { describe, expect, it } from "vitest";
import { buildGenerationPlan } from "./generation-plan";
import { projectGenerationPlan } from "./generation-contract";

describe("projectGenerationPlan", () => {
  it("preserva o objetivo mestre durante correções curtas", () => {
    const master = buildGenerationPlan("Crie um programa odontológico completo com pacientes, agenda e prontuário");
    const refinement = buildGenerationPlan("está dando e-mail inválido resolva");

    expect(projectGenerationPlan(master, refinement, true)?.objective).toBe(master.objective);
  });

  it("usa o primeiro contrato real em um projeto novo", () => {
    const first = buildGenerationPlan("Crie uma clínica odontológica");
    expect(projectGenerationPlan(undefined, first, false)).toBe(first);
  });

  it("acumula capacidades de refinamentos sem apagar as anteriores", () => {
    const master = buildGenerationPlan("Crie uma clínica com agenda por profissional e prevenção de conflitos");
    const refinement = buildGenerationPlan("Adicione controle protético, precificação e vídeo institucional");
    const merged = projectGenerationPlan(master, refinement, true);

    expect(merged?.objective).toBe(master.objective);
    expect(merged?.requiredCapabilities).toEqual(expect.arrayContaining([
      expect.stringMatching(/agenda clínica real/),
      expect.stringMatching(/financeiro clínico real/),
      expect.stringMatching(/controle protético real/),
      expect.stringMatching(/vídeo responsiva/),
    ]));
    expect(merged?.visualProfile.allowVideo).toBe(true);
  });

  it("preserva mídias e critérios de aceite cumulativos", () => {
    const master = buildGenerationPlan("Crie um site profissional", [
      { name: "fachada.jpg", type: "image/jpeg", url: "https://cdn.example/fachada.jpg" },
    ]);
    const refinement = buildGenerationPlan("Adicione um vídeo", [
      { name: "clinica.mp4", type: "video/mp4", url: "https://cdn.example/clinica.mp4" },
    ]);
    const merged = projectGenerationPlan(master, refinement, true);

    expect(merged?.media.imageCount).toBe(1);
    expect(merged?.media.videoMode).toBe("uploaded");
    expect(merged?.media.videoUrls).toEqual(["https://cdn.example/clinica.mp4"]);
    expect(merged?.acceptanceCriteria).toEqual(expect.arrayContaining(master.acceptanceCriteria));
    expect(merged?.acceptanceCriteria).toEqual(expect.arrayContaining(refinement.acceptanceCriteria));
  });
});
