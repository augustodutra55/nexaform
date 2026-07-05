"use client";

import { create } from "zustand";
import { AppSchema } from "@/lib/engine/types";

export type SaveState = "saved" | "saving" | "dirty";

interface ProjectStore {
  schema: AppSchema | null;
  past: AppSchema[];
  future: AppSchema[];
  currentPageId: string | null;
  selectedSectionId: string | null;
  saveState: SaveState;

  /** Substitui o schema. recordHistory=true empilha o estado anterior para undo. */
  setSchema: (schema: AppSchema | null, opts?: { recordHistory?: boolean; dirty?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  setCurrentPage: (id: string | null) => void;
  selectSection: (id: string | null) => void;
  setSaveState: (s: SaveState) => void;
  reset: () => void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const useProjectStore = create<ProjectStore>((set, get) => ({
  schema: null,
  past: [],
  future: [],
  currentPageId: null,
  selectedSectionId: null,
  saveState: "saved",

  setSchema: (schema, opts = {}) => {
    const { recordHistory = true, dirty = true } = opts;
    const prev = get().schema;
    set({
      schema,
      past: recordHistory && prev ? [...get().past.slice(-30), clone(prev)] : get().past,
      future: recordHistory ? [] : get().future,
      saveState: dirty ? "dirty" : get().saveState,
      currentPageId:
        get().currentPageId && schema?.pages.some((p) => p.id === get().currentPageId)
          ? get().currentPageId
          : schema?.pages[0]?.id ?? null,
    });
  },

  undo: () => {
    const { past, schema, future } = get();
    if (past.length === 0 || !schema) return;
    const prev = past[past.length - 1];
    set({
      schema: prev,
      past: past.slice(0, -1),
      future: [clone(schema), ...future].slice(0, 30),
      saveState: "dirty",
    });
  },

  redo: () => {
    const { future, schema, past } = get();
    if (future.length === 0 || !schema) return;
    const next = future[0];
    set({
      schema: next,
      future: future.slice(1),
      past: [...past, clone(schema)].slice(-30),
      saveState: "dirty",
    });
  },

  setCurrentPage: (id) => set({ currentPageId: id, selectedSectionId: null }),
  selectSection: (id) => set({ selectedSectionId: id }),
  setSaveState: (s) => set({ saveState: s }),
  reset: () =>
    set({ schema: null, past: [], future: [], currentPageId: null, selectedSectionId: null, saveState: "saved" }),
}));
