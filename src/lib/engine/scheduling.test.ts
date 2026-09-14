import { describe, expect, it } from "vitest";
import { busyScheduleIntervals, intervalsOverlap, scheduleInterval } from "./scheduling";

describe("scheduling", () => {
  it("inclui duração e buffers na prevenção de conflito", () => {
    const a = scheduleInterval({ data_hora: "2026-09-04T10:00:00Z", duracao_minutos: 30, buffer_antes: 5, buffer_depois: 10 })!;
    const b = scheduleInterval({ data_hora: "2026-09-04T10:35:00Z", duracao_minutos: 30 })!;
    expect(intervalsOverlap(a, b)).toBe(true);
  });

  it("não expõe registros e ignora cancelados e outros profissionais", () => {
    const rows = [
      { data: { profissional_id: "p1", data_hora: "2026-09-04T10:00:00Z", duracao_minutos: 30, paciente_nome: "Privado" } },
      { data: { profissional_id: "p1", data_hora: "2026-09-04T11:00:00Z", duracao_minutos: 30, status: "cancelado" } },
      { data: { profissional_id: "p2", data_hora: "2026-09-04T12:00:00Z", duracao_minutos: 30 } },
    ];
    expect(busyScheduleIntervals(rows, { profissional_id: "p1" })).toEqual([
      { start: "2026-09-04T10:00:00.000Z", end: "2026-09-04T10:30:00.000Z" },
    ]);
  });
});
