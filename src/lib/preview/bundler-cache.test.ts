import { describe, expect, it } from "vitest";
import { previewSourceFingerprint } from "./bundler";

describe("preview bundle fingerprint", () => {
  it("permanece estável para o mesmo conteúdo", () => {
    const files = [{ path: "App.jsx", content: "export default function App(){return <main/>}" }];
    expect(previewSourceFingerprint(files, "App.jsx")).toBe(previewSourceFingerprint([...files], "App.jsx"));
  });

  it("muda quando arquivo, conteúdo ou entrada mudam", () => {
    const base = [{ path: "App.jsx", content: "export default 1" }];
    const fingerprint = previewSourceFingerprint(base, "App.jsx");
    expect(previewSourceFingerprint([{ path: "App.jsx", content: "export default 2" }], "App.jsx")).not.toBe(fingerprint);
    expect(previewSourceFingerprint([{ path: "Main.jsx", content: "export default 1" }], "Main.jsx")).not.toBe(fingerprint);
    expect(previewSourceFingerprint(base, "Outro.jsx")).not.toBe(fingerprint);
  });
});
