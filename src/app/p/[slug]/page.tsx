import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidSchema } from "@/lib/engine/types";
import { isAppCode } from "@/lib/engine/app-types";
import { readMeta } from "@/lib/studio";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { PublicPreview } from "./public-preview";

export const revalidate = 10;

async function fetchProject(slug: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, description, schema, published, meta, build_bundle")
    .eq("share_slug", slug)
    .eq("published", true)
    .maybeSingle();
  return data;
}

/** SEO / compartilhamento: metadados dinâmicos por publicação. */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const project = await fetchProject(params.slug);
  if (!project) return { title: "Projeto não encontrado" };
  const meta = readMeta(project.meta);
  const description =
    project.description?.slice(0, 160) ||
    (meta.whitelabel ? project.name : `${project.name} — publicado com AD Studio.`);
  // white-label: título absoluto, sem o sufixo "· AD Studio".
  const title = meta.whitelabel ? { absolute: project.name } : project.name;
  return {
    title,
    description,
    // white-label não anuncia o AD Studio nos metadados
    applicationName: meta.whitelabel ? project.name : "AD Studio",
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProjectPage({ params }: { params: { slug: string } }) {
  const project = await fetchProject(params.slug);
  if (!project || (!isValidSchema(project.schema) && !isAppCode(project.schema))) notFound();

  const app = isAppCode(project.schema) ? project.schema : null;
  const appCode = app?.code ?? null;
  const appFiles = app?.files ?? null;
  const appEntry = app?.entry ?? null;
  const meta = readMeta(project.meta);
  const whitelabel = !!meta.whitelabel;
  const brandName = meta.client || project.name;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4">
        {whitelabel ? (
          // Entrega white-label: só o nome do cliente/projeto, sem marca AD Studio.
          <span className="text-sm font-semibold">{brandName}</span>
        ) : (
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-sm text-muted-foreground">/ {project.name}</span>
          </div>
        )}
        {!whitelabel && (
          <Button variant="brand" size="sm" asChild>
            <Link href="/cadastro">Construa o seu com o AD Studio</Link>
          </Button>
        )}
      </header>
      <main className="min-h-0 flex-1">
        <PublicPreview
          schema={isValidSchema(project.schema) ? project.schema : null}
          appCode={appCode}
          appFiles={appFiles}
          appEntry={appEntry}
          projectId={(project as any).id ?? null}
          bundle={(project as any).build_bundle ?? null}
        />
      </main>
    </div>
  );
}
