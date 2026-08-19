import { describe, expect, it } from "vitest";
import { adGlobalScript } from "./ad-global";

const PID = "11111111-1111-1111-1111-111111111111";

describe("adGlobalScript — primitivo AD.settings (admin no motor)", () => {
  it("expõe window.AD.settings e o gancho de re-render", () => {
    const s = adGlobalScript(PID, { admin: true });
    expect(s).toContain("window.AD.settings");
    expect(s).toContain("ad:settings-changed");
    expect(s).toContain("admin:true");
  });

  it("admin é false por padrão (site publicado usa PIN)", () => {
    expect(adGlobalScript(PID)).toContain("admin:false");
  });

  it("sem projeto, o AD mínimo tem enabled:false (early-return em runtime)", () => {
    const s = adGlobalScript("");
    expect(s).toContain("enabled:false");
  });

  it("tem fluxo de PIN: dono define, cliente usa no site publicado", () => {
    const s = adGlobalScript(PID, { admin: true });
    expect(s).toContain("setPin"); // dono define/gira o PIN
    expect(s).toContain("hasPin"); // publicado mostra o botão quando há PIN
    expect(s).toContain("adminPin"); // cliente envia o PIN ao salvar
  });

  it("é uma string única e fechada (sem erro de template)", () => {
    const s = adGlobalScript(PID, { admin: true });
    expect(typeof s).toBe("string");
    expect(s.trim().endsWith("</script>")).toBe(true);
  });
});
