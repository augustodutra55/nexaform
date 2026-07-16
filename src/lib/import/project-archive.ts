import JSZip from "jszip";
import type { AppCode, AppFile } from "@/lib/engine/app-types";

const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 250;
const SOURCE_EXTENSION = /\.(?:jsx?|tsx?)$/i;

export interface ImportedProjectArchive {
  name: string;
  description: string;
  schema: AppCode;
}

function cleanPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`O ZIP contém um caminho inválido: ${value}`);
  }
  return parts.join("/");
}

function commonRoot(paths: string[]): string {
  if (!paths.length) return "";
  const first = paths[0].split("/")[0];
  return paths.every((path) => path.startsWith(`${first}/`)) ? `${first}/` : "";
}

function projectName(packageJson: any, fallback: string): string {
  const raw = typeof packageJson?.name === "string" ? packageJson.name : fallback;
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
    .trim()
    .slice(0, 80) || "Projeto importado";
}

function entryFromMain(mainSource: string, generatedFiles: AppFile[]): string | null {
  const match = mainSource.match(/import\s+\w+\s+from\s+['"]\.\/generated\/([^'"]+)['"]/);
  if (!match) return null;
  const requested = cleanPath(match[1]);
  const candidates = [requested, `${requested}.jsx`, `${requested}.js`, `${requested}.tsx`, `${requested}.ts`];
  return candidates.find((candidate) => generatedFiles.some((file) => file.path === candidate)) ?? null;
}

/** Lê um ZIP criado pelo exportador Vite do AD Studio e o converte ao formato editável interno. */
export async function importProjectArchive(file: File): Promise<ImportedProjectArchive> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Selecione um arquivo ZIP exportado pelo AD Studio.");
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("O ZIP pode ter no máximo 15 MB.");

  const archive = await JSZip.loadAsync(file);
  const paths = Object.keys(archive.files).filter((path) => !archive.files[path].dir && !path.includes("__MACOSX"));
  if (!paths.length) throw new Error("O ZIP está vazio.");
  if (paths.length > MAX_FILES) throw new Error(`O ZIP possui arquivos demais (máximo: ${MAX_FILES}).`);

  const root = commonRoot(paths);
  const relative = (path: string) => cleanPath(root && path.startsWith(root) ? path.slice(root.length) : path);
  const byPath = new Map(paths.map((path) => [relative(path), archive.files[path]]));
  const packageEntry = byPath.get("package.json");
  const mainEntry = byPath.get("src/main.jsx") || byPath.get("src/main.tsx");
  if (!packageEntry || !mainEntry) {
    throw new Error("Este ZIP não parece ser uma exportação Vite do AD Studio (package.json ou src/main ausente). ");
  }

  let packageJson: any;
  try {
    packageJson = JSON.parse(await packageEntry.async("string"));
  } catch {
    throw new Error("O package.json do ZIP é inválido.");
  }

  const generatedEntries = Array.from(byPath.entries()).filter(
    ([path]) => path.startsWith("src/generated/") && SOURCE_EXTENSION.test(path)
  );
  if (!generatedEntries.length) {
    throw new Error("Não encontrei os arquivos editáveis em src/generated. Exporte novamente pelo AD Studio e tente outra vez.");
  }

  const files: AppFile[] = [];
  let totalBytes = 0;
  for (const [path, entry] of generatedEntries) {
    const content = await entry.async("string");
    totalBytes += new Blob([content]).size;
    if (totalBytes > MAX_SOURCE_BYTES) throw new Error("O código-fonte descompactado pode ter no máximo 4 MB.");
    files.push({ path: cleanPath(path.slice("src/generated/".length)), content });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const mainSource = await mainEntry.async("string");
  const entry = entryFromMain(mainSource, files)
    ?? files.find((item) => /(^|\/)App\.(?:jsx?|tsx?)$/i.test(item.path))?.path
    ?? files[0].path;
  const name = projectName(packageJson, file.name.replace(/\.zip$/i, ""));

  return {
    name,
    description: `Importado de ${file.name}. Projeto editável recuperado de uma exportação do AD Studio.`,
    schema: { kind: "app", name, description: "", files, entry },
  };
}
