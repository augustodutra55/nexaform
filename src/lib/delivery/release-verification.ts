export const RELEASE_PROBE_CHANNEL = "adstudio:release-probe";

export type ReleaseProbeStatus = "ready" | "error";

export interface ReleaseProbeMessage {
  channel: typeof RELEASE_PROBE_CHANNEL;
  status: ReleaseProbeStatus;
  message?: string;
}

export interface ReleaseVerificationSnapshot {
  version: 1;
  status: "verified" | "failed";
  slug: string;
  checkedAt: string;
  bundleBytes: number;
  message?: string;
}

export function runtimeProbeMessage(value: unknown): ReleaseProbeMessage | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.__nx_ready === true) {
    return { channel: RELEASE_PROBE_CHANNEL, status: "ready" };
  }
  if (typeof source.__nx_error === "string" && source.__nx_error.trim()) {
    return {
      channel: RELEASE_PROBE_CHANNEL,
      status: "error",
      message: source.__nx_error.trim().slice(0, 800),
    };
  }
  return null;
}

export function parseReleaseProbeMessage(value: unknown): ReleaseProbeMessage | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.channel !== RELEASE_PROBE_CHANNEL) return null;
  if (source.status !== "ready" && source.status !== "error") return null;
  return {
    channel: RELEASE_PROBE_CHANNEL,
    status: source.status,
    message: typeof source.message === "string" ? source.message.slice(0, 800) : undefined,
  };
}

export function releaseProbeUrl(slug: string, nonce: string): string {
  return `/p/${encodeURIComponent(slug)}?releaseProbe=${encodeURIComponent(nonce)}`;
}
