export interface ScheduleInterval {
  start: string;
  end: string;
}

const START_FIELDS = ["data_hora", "start_at", "starts_at", "inicio", "date_time", "datetime"];
const DURATION_FIELDS = ["duracao_minutos", "duration_minutes", "duration", "duracao"];
const BEFORE_FIELDS = ["buffer_antes", "buffer_before"];
const AFTER_FIELDS = ["buffer_depois", "buffer_after"];
const RESOURCE_FIELDS = ["profissional_id", "professional_id", "resource_id"];
const INACTIVE_STATUSES = new Set(["cancelado", "cancelada", "cancelled", "canceled", "recusado", "rejected"]);

function first(data: Record<string, unknown>, fields: string[]) {
  for (const field of fields) if (data[field] !== undefined && data[field] !== null) return data[field];
  return undefined;
}

function minutes(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function scheduleResource(data: Record<string, unknown>): string | null {
  const value = first(data, RESOURCE_FIELDS);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function scheduleInterval(data: Record<string, unknown>): ScheduleInterval | null {
  const rawStart = first(data, START_FIELDS);
  const startTime = typeof rawStart === "string" ? Date.parse(rawStart) : NaN;
  if (!Number.isFinite(startTime)) return null;
  const duration = minutes(first(data, DURATION_FIELDS), 30);
  const before = minutes(first(data, BEFORE_FIELDS));
  const after = minutes(first(data, AFTER_FIELDS));
  if (!duration) return null;
  return {
    start: new Date(startTime - before * 60_000).toISOString(),
    end: new Date(startTime + (duration + after) * 60_000).toISOString(),
  };
}

export function scheduleIsActive(data: Record<string, unknown>) {
  return !INACTIVE_STATUSES.has(String(data.status || "").trim().toLowerCase());
}

export function intervalsOverlap(left: ScheduleInterval, right: ScheduleInterval) {
  return Date.parse(left.start) < Date.parse(right.end) && Date.parse(left.end) > Date.parse(right.start);
}

export function isSchedulingCollection(collection: string) {
  return /^(agendamentos?|appointments?|bookings?|consultas?)$/i.test(collection);
}

export function busyScheduleIntervals(rows: Array<{ data?: Record<string, unknown> | null }>, request: Record<string, unknown>) {
  const requestedResource = scheduleResource(request);
  return rows.flatMap((row) => {
    const data = row.data || {};
    if (!scheduleIsActive(data)) return [];
    if (requestedResource && scheduleResource(data) !== requestedResource) return [];
    const interval = scheduleInterval(data);
    return interval ? [interval] : [];
  });
}
