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

  it("preserva seções obrigatórias mesmo depois de um cabeçalho longo de etapa", () => {
    const plan = buildGenerationPlan(`${"CONSTRUÇÃO POR ETAPAS — revisão final com checklist genérico de benefícios, prova social e FAQ. ".repeat(4)}
      --- ESPECIFICAÇÃO MESTRA ---
      loja com benefícios, prova social, depoimentos e FAQ.
      --- FIM DA ESPECIFICAÇÃO MESTRA ---`);

    expect(plan.requiredCapabilities).toEqual(expect.arrayContaining([
      "seção de FAQ realmente renderizada",
      "seção de prova social/depoimentos realmente renderizada",
      "seção de benefícios realmente renderizada",
    ]));
  });

  it("não confunde checklist genérico de etapa com requisito da especificação", () => {
    const plan = buildGenerationPlan(`CONSTRUÇÃO POR ETAPAS — revisão final com benefícios, prova social e FAQ.
      --- ESPECIFICAÇÃO MESTRA ---
      Crie uma agenda com login e cadastro de clientes.
      --- FIM DA ESPECIFICAÇÃO MESTRA ---`);

    expect(plan.requiredCapabilities).toContain("autenticação e estados de sessão");
    expect(plan.requiredCapabilities.some((item) => /FAQ|prova social|benefícios/.test(item))).toBe(false);
  });

  it("não confunde formulário de contato com conta de usuário", () => {
    const plan = buildGenerationPlan("Landing com formulário de contato e FAQ");
    expect(plan.requiredCapabilities).not.toContain("autenticação e estados de sessão");
  });

  it("distingue podcast de reconhecimento de voz e planeja live via OBS", () => {
    const plan = buildGenerationPlan("Site com podcast, episódios em áudio e transmissão ao vivo usando OBS no YouTube Live");
    expect(plan.requiredCapabilities).toContain("podcast com player, catálogo e fonte de áudio real");
    expect(plan.requiredCapabilities).toContain("live externa responsiva, com estados ao vivo/offline e fallback");
    expect(plan.requiredCapabilities).not.toContain("voz pelo runtime AD.voice com fallback e feedback");
  });

  it("trata site com gestão odontológica como sistema híbrido e preserva todos os módulos", () => {
    const plan = buildGenerationPlan("Site público e sistema de gestão para clínica odontológica com agenda por profissional, buffer e no-show; prontuário de pacientes e RX; financeiro com precificação, contas a pagar, fluxo de caixa e convênios; controle protético com laboratório; caixa de entrada inteligente integrada ao Gmail por webhook do Make; assistente de IA.");

    expect(plan.kind).toBe("app");
    expect(plan.requiredCapabilities).toEqual(expect.arrayContaining([
      expect.stringMatching(/agenda clínica real/),
      expect.stringMatching(/financeiro clínico real/),
      expect.stringMatching(/controle protético real/),
      expect.stringMatching(/prontuário de pacientes/),
      expect.stringMatching(/caixa de entrada inteligente/),
      expect.stringMatching(/assistente de IA/),
    ]));
    expect(plan.acceptanceCriteria).toContain("site público e painel interno permanecem jornadas distintas, sem login sobreposto ao conteúdo público");
  });
});
