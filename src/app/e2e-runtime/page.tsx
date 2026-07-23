import { notFound } from "next/navigation";
import { RuntimeE2EHarness } from "./runtime-e2e-harness";

export const dynamic = "force-dynamic";

export default function RuntimeE2EPage() {
  if (process.env.E2E_TEST_MODE !== "1") notFound();
  return <RuntimeE2EHarness />;
}
