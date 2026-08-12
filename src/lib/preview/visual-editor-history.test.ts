import { describe, expect, it } from "vitest";
import type { AppCode } from "@/lib/engine/app-types";
import {
  canRedoVisual,
  canUndoVisual,
  commitVisualRevision,
  createVisualEditorHistory,
  createVisualEditorRevision,
  redoVisualRevision,
  undoVisualRevision,
} from "./visual-editor-history";

function app(text: string): AppCode {
  return {
    kind: "app",
    name: "Teste",
    description: "",
    files: [{ path: "App.jsx", content: `export default function App(){return <h1>${text}</h1>}` }],
    entry: "App.jsx",
  };
}

describe("visual-editor-history", () => {
  it("faz undo e redo sem perder revisões", () => {
    const first = createVisualEditorRevision(app("A"), "Inicial", "1");
    const second = createVisualEditorRevision(app("B"), "Texto", "2");
    const third = createVisualEditorRevision(app("C"), "Estilo", "3");
    let history = createVisualEditorHistory(first);
    history = commitVisualRevision(history, second);
    history = commitVisualRevision(history, third);
    expect(canUndoVisual(history)).toBe(true);
    history = undoVisualRevision(history);
    expect(history.present.id).toBe("2");
    expect(canRedoVisual(history)).toBe(true);
    history = redoVisualRevision(history);
    expect(history.present.id).toBe("3");
  });

  it("uma nova edição limpa o redo", () => {
    const first = createVisualEditorRevision(app("A"), "Inicial", "1");
    const second = createVisualEditorRevision(app("B"), "Texto", "2");
    const alternative = createVisualEditorRevision(app("D"), "Alternativa", "4");
    let history = commitVisualRevision(createVisualEditorHistory(first), second);
    history = undoVisualRevision(history);
    expect(canRedoVisual(history)).toBe(true);
    history = commitVisualRevision(history, alternative);
    expect(canRedoVisual(history)).toBe(false);
  });

  it("limita o histórico passado", () => {
    let history = createVisualEditorHistory(createVisualEditorRevision(app("0"), "0", "0"));
    for (let i = 1; i <= 5; i += 1) {
      history = commitVisualRevision(history, createVisualEditorRevision(app(String(i)), String(i), String(i)), 3);
    }
    expect(history.past).toHaveLength(3);
    expect(history.present.id).toBe("5");
  });
});
