import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import type { AppCode } from "@/lib/engine/app-types";
import { GoldenRuntimeHarness } from "./runtime-golden-harness";

export const dynamic = "force-dynamic";

interface GoldenFixture {
  id: string;
  name: string;
  app: AppCode;
}

function loadFixtures(): GoldenFixture[] {
  if (process.env.E2E_TEST_MODE !== "1") return [];
  const configured = process.env.GOLDEN_FIXTURE_PATH || "artifacts/golden-apps.json";
  const absolute = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function GoldenRuntimePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  if (process.env.E2E_TEST_MODE !== "1") notFound();
  const { id } = await searchParams;
  const fixture = loadFixtures().find((item) => item?.id === id && item?.app?.kind === "app");
  if (!fixture) notFound();
  return <GoldenRuntimeHarness fixture={fixture} />;
}
