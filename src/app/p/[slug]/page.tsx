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

interface PublicProject {
  id: string; name: string; description: string | null; schema: unknown;
  published: boolean; share_slug: string; meta: unknown; build_bundle: string | null;
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeColor(value: string | null | undefined): string | null {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

async function fetchProject(slug: string) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("get_public_project", { p_slug: slug })
    .maybeSingle();
  return data as PublicProject | null;
}

/** SEO / compartilhamento: metadados dinâmicos por publicação. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const project = await fetchProject(slug);
  if (!project) return { title: "Projeto não encontrado" };
  const meta = readMeta(project.meta);
  const logoUrl = safeHttpsUrl(meta.delivery?.logoUrl);
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
      images: logoUrl ? [logoUrl] : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
    icons: logoUrl ? { icon: logoUrl } : undefined,
    robots: { index: true, follow: true },
  };
}

export default async function PublicProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await fetchProject(slug);
  if (!project || (!isValidSchema(project.schema) && !isAppCode(project.schema))) notFound();

  const app = isAppCode(project.schema) ? project.schema : null;
  const appCode = app?.code ?? null;
  const appFiles = app?.files ?? null;
  const appEntry = app?.entry ?? null;
  const meta = readMeta(project.meta);
  const whitelabel = !!meta.whitelabel;
  const brandName = meta.client || project.name;
  const logoUrl = safeHttpsUrl(meta.delivery?.logoUrl);
  const brandColor = safeColor(meta.delivery?.primaryColor);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={brandColor ? { borderTop: `3px solid ${brandColor}` } : undefined}
    >
      <header className="flex h-12 items-center justify-between border-b px-4">
        {whitelabel ? (
          <div className="flex min-w-0 items-center gap-2">
            {logoUrl && <img src={logoUrl} alt="" className="h-7 w-7 rounded object-contain" />}
            <span className="truncate text-sm font-semibold">{brandName}</span>
          </div>
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
