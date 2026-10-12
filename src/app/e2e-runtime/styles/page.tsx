import { notFound } from "next/navigation";
import { StudioStylesFixture } from "./studio-styles-fixture";

export const dynamic = "force-dynamic";

export default function StudioStylesPage() {
  if (process.env.E2E_TEST_MODE !== "1") notFound();
  return <StudioStylesFixture />;
}
