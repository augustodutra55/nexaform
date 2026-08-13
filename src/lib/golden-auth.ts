import crypto from "node:crypto";

const MAX_SKEW_MS = 5 * 60_000;

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function verifyGoldenServiceHeaders(headers: Headers): boolean {
  const secret = process.env.AD_GOLDEN_SERVICE_SECRET;
  if (!secret) return false;
  const timestamp = headers.get("x-ad-golden-timestamp") || "";
  const signature = headers.get("x-ad-golden-signature") || "";
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");
  return safeEqual(signature, expected);
}

export function verifyGoldenServiceAuth(request: Request): boolean {
  return verifyGoldenServiceHeaders(request.headers);
}
