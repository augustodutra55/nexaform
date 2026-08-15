import { notFound } from "next/navigation";
import { PreviewPane } from "@/components/project/preview-pane";

/**
 * Harness de e2e da Fase 4: monta o PreviewPane com IDs de teste, apontando o
 * iframe para /preview/e2e/e2e (servido pela rota em E2E_TEST_MODE, sem banco).
 * Guardado por E2E_TEST_MODE como os demais harnesses de e2e-runtime.
 */
export const dynamic = "force-dynamic";

export default function PreviewE2EPage() {
  if (process.env.E2E_TEST_MODE !== "1") notFound();
  return (
    <div style={{ height: "100vh" }}>
      <PreviewPane projectId="e2e" versionId="e2e" title="Harness de preview" />
    </div>
  );
}
