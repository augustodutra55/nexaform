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

  it("sem projeto, mantém AD.settings síncrono e devolve o fallback", () => {
    const s = adGlobalScript("");
    expect(s).toContain("enabled:false");
    expect(s).toContain("settings:{");
    expect(s).toContain("get:function(key,fallback){return fallback;}");
    expect(s).toContain("ready:function(){return Promise.resolve();}");
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

describe("adGlobalScript — autenticação de apps gerados", () => {
  it("aceita credenciais posicionais e em objeto sem simular sessão", () => {
    const source = adGlobalScript(PID);

    expect(source).toContain("function authCredentials(email,password,name)");
    expect(source).toContain("typeof email==='object'");
    expect(source).toContain("var c=authCredentials(email,password,name)");
    expect(source).toContain("var c=authCredentials(email,password)");
  });

  it("mantém aliases de dados emitidos por gerações legadas", () => {
    const source = adGlobalScript(PID);

    expect(source).toContain("query: listData");
    expect(source).toContain("select: listData");
    expect(source).toContain("delete: removeData");
    expect(source).toContain("third===undefined?first:second");
  });
});
