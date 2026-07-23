import { describe, expect, it } from "vitest";
import { buildGenerationPlan } from "./generation-plan";

describe("buildGenerationPlan", () => {
  it("cria o mesmo blueprint para o mesmo pedido", () => {
    const prompt = "Crie um portal profissional para uma concessionária com painel de clientes";
    const first = buildGenerationPlan(prompt);
    const second = buildGenerationPlan(prompt);

    expect(first.visualBlueprint).toEqual(second.visualBlueprint);
    expect(first.visualBlueprint.id).toBe("product-system-automotive");
    expect(first.visualBlueprint.segment).toBe("automotivo");
  });

  it("combina segmento e perfil sem aplicar estética genérica", () => {
    const plan = buildGenerationPlan("Site institucional premium para uma clínica odontológica");

    expect(plan.visualProfile.id).toBe("editorial-luxury");
    expect(plan.visualBlueprint.id).toBe("editorial-luxury-health");
    expect(plan.visualBlueprint.palette).toContain("azul-petróleo");
    expect(plan.visualBlueprint.mediaTreatment.join(" ")).toContain("pacientes");
  });

  it("autoriza uma única receita 3D somente quando solicitada", () => {
    const standard = buildGenerationPlan("Site profissional para uma cafeteria");
    const immersive = buildGenerationPlan("Site 3D imersivo para uma cafeteria");

    expect(standard.visualProfile.allow3D).toBe(false);
    expect(standard.visualBlueprint.threeDRecipe.join(" ")).toContain("não importar Three");
    expect(immersive.visualProfile.allow3D).toBe(true);
    expect(immersive.visualBlueprint.threeDRecipe.join(" ")).toContain("uma única cena");
  });

  it("usa vídeo enviado e placeholder seguro de forma determinística", () => {
    const withoutUpload = buildGenerationPlan("Landing com vídeo para academia");
    const withUpload = buildGenerationPlan("Landing com vídeo para academia", [
      { name: "treino.mp4", type: "video/mp4", url: "https://cdn.example/treino.mp4" },
    ]);

    expect(withoutUpload.media.videoMode).toBe("placeholder");
    expect(withUpload.media.videoMode).toBe("uploaded");
    expect(withUpload.media.videoUrls).toEqual(["https://cdn.example/treino.mp4"]);
  });
});
