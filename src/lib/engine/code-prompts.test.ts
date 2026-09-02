import { describe, expect, it } from "vitest";
import { CODE_SYSTEM_PROMPT, CODE_REFINE_SYSTEM_PROMPT, buildCodeUserPrompt } from "./code-prompts";

describe("religar edição do dono automaticamente no refinamento", () => {
  const semSettings = [{ path: "components/Hero.jsx", content: "export default () => <h1>Esmalteria</h1>;" }];
  const comSettings = [
    { path: "components/Hero.jsx", content: "export default () => <h1>{AD.settings.get('hero.titulo','Esmalteria')}</h1>;" },
  ];

  it("injeta a instrução de liberar edição quando o site ainda não usa AD.settings", () => {
    const prompt = buildCodeUserPrompt("mude a cor do botão", semSettings);
    expect(prompt).toMatch(/LIBERAR EDIÇÃO PELO DONO/);
    expect(prompt).toContain("AD.settings.get");
  });

  it("NÃO injeta de novo quando o site já usa AD.settings", () => {
    const prompt = buildCodeUserPrompt("mude a cor do botão", comSettings);
    expect(prompt).not.toMatch(/LIBERAR EDIÇÃO PELO DONO/);
  });

  it("não injeta na primeira geração (sem arquivos atuais)", () => {
    const prompt = buildCodeUserPrompt("site de barbearia", null);
    expect(prompt).not.toMatch(/LIBERAR EDIÇÃO PELO DONO/);
  });
});

describe("prompt do motor — admin embutido (AD.settings) e imagens", () => {
  it("ensina funções HTTP declarativas sem expor segredos", () => {
    expect(CODE_SYSTEM_PROMPT).toContain("AD.actions.run");
    expect(CODE_SYSTEM_PROMPT).toContain("Nunca use fetch cru");
  });
  it("ensina o modelo a usar AD.settings.get para conteúdo editável", () => {
    expect(CODE_SYSTEM_PROMPT).toContain("AD.settings.get");
    // reforça que é síncrono e sem efeito (evita o loop de recarregamento)
    expect(CODE_SYSTEM_PROMPT).toMatch(/sem useEffect|SÍNCRONA|síncrono/i);
  });

  it("proíbe desenhar ilustração/pessoa/mão em SVG como imagem de conteúdo", () => {
    expect(CODE_SYSTEM_PROMPT).toMatch(/ilustração em svg|ilustração em SVG|SVG/i);
    expect(CODE_SYSTEM_PROMPT).toMatch(/ADIMG/);
  });

  it("proíbe simulador que pinta SVG ou sobrepõe formas em foto; manda grade de amostras", () => {
    expect(CODE_SYSTEM_PROMPT).toMatch(/SIMULADOR|PROVADOR/i);
    expect(CODE_SYSTEM_PROMPT).toMatch(/GRADE DE AMOSTRAS|amostras de cor|backgroundColor/i);
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/amostras|MOSTRU/i);
  });

  it("o prompt de refinamento preserva AD.settings e não recria painel de admin", () => {
    expect(CODE_REFINE_SYSTEM_PROMPT).toContain("AD.settings");
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/não crie painel de admin|__settings/i);
  });

  it("trata podcast e live via OBS sem inventar mídia ou transmissão no navegador", () => {
    expect(CODE_SYSTEM_PROMPT).toMatch(/PODCAST E TRANSMISSÃO AO VIVO/);
    expect(CODE_SYSTEM_PROMPT).toMatch(/OBS transmite por RTMP/);
    expect(CODE_SYSTEM_PROMPT).toMatch(/estados claros "ao vivo", "offline\/próxima transmissão"/);
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/PODCAST\/LIVE/);
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/não finja transmitir pelo navegador/);
  });

  it("ensina automações agendadas idempotentes no manifesto do backend", () => {
    expect(CODE_SYSTEM_PROMPT).toMatch(/AUTOMAÇÕES AGENDADAS/);
    expect(CODE_SYSTEM_PROMPT).toContain('"automations"');
    expect(CODE_SYSTEM_PROMPT).toContain('"leadMinutes":1440');
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/AUTOMAÇÕES:/);
  });

  it("mantém login e manifesto do backend coerentes", () => {
    expect(CODE_SYSTEM_PROMPT).toMatch(/nunca deixe uma coleção "authenticated".*signIn \+ signUp/i);
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/ao remover login.*me\/signOut.*profile:"private"/i);
  });

  it("fixa as assinaturas reais de dados também durante refinamentos", () => {
    expect(CODE_REFINE_SYSTEM_PROMPT).toContain("AD.list('colecao', opcoes?)");
    expect(CODE_REFINE_SYSTEM_PROMPT).toContain("AD.update(id, dados)");
    expect(CODE_REFINE_SYSTEM_PROMPT).toContain("AD.remove(id)");
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/Nunca use AD\.get\('colecao', \{\}\)/);
  });

  it("proíbe overflow horizontal em 320px na geração e no refinamento", () => {
    expect(CODE_SYSTEM_PROMPT).toMatch(/320px sem rolagem horizontal/);
    expect(CODE_SYSTEM_PROMPT).toMatch(/flex-col sm:flex-row|flex-wrap/);
    expect(CODE_REFINE_SYSTEM_PROMPT).toMatch(/320px sem overflow horizontal/);
  });
});
