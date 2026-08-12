import type { AppCode, AppFile } from "@/lib/engine/app-types";

export interface VisualEditorRevision {
  id: string;
  label: string;
  app: AppCode;
  createdAt: string;
}

export interface VisualEditorHistory {
  past: VisualEditorRevision[];
  present: VisualEditorRevision;
  future: VisualEditorRevision[];
}

function cloneFiles(files: AppFile[] | undefined): AppFile[] | undefined {
  return files?.map((file) => ({ ...file }));
}

export function cloneApp(app: AppCode): AppCode {
  return { ...app, files: cloneFiles(app.files) };
}

export function createVisualEditorRevision(app: AppCode, label: string, id = crypto.randomUUID()): VisualEditorRevision {
  return {
    id,
    label: label.trim().slice(0, 120) || "Edição visual",
    app: cloneApp(app),
    createdAt: new Date().toISOString(),
  };
}

export function createVisualEditorHistory(initial: VisualEditorRevision): VisualEditorHistory {
  return { past: [], present: initial, future: [] };
}

export function commitVisualRevision(history: VisualEditorHistory, revision: VisualEditorRevision, maxPast = 50): VisualEditorHistory {
  const past = [...history.past, history.present].slice(-Math.max(1, maxPast));
  return { past, present: revision, future: [] };
}

export function undoVisualRevision(history: VisualEditorHistory): VisualEditorHistory {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoVisualRevision(history: VisualEditorHistory): VisualEditorHistory {
  if (!history.future.length) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export function canUndoVisual(history: VisualEditorHistory): boolean {
  return history.past.length > 0;
}

export function canRedoVisual(history: VisualEditorHistory): boolean {
  return history.future.length > 0;
}
