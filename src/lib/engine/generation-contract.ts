import type { GenerationPlan } from "./app-types";

/**
 * O plano salvo representa o produto pedido, não o último comando de edição.
 * Refinamentos podem acrescentar código, mas não podem trocar "clínica
 * odontológica" por "corrija o e-mail" como objetivo oficial do projeto.
 */
export function projectGenerationPlan(
  existing: GenerationPlan | undefined,
  candidate: GenerationPlan | undefined,
  hasExistingApp: boolean
): GenerationPlan | undefined {
  if (hasExistingApp && existing && candidate) {
    const unique = (values: string[]) => Array.from(new Set(values));
    const videoUrls = unique([...existing.media.videoUrls, ...candidate.media.videoUrls]);
    const videoMode = videoUrls.length
      ? "uploaded" as const
      : existing.media.videoMode === "placeholder" || candidate.media.videoMode === "placeholder"
        ? "placeholder" as const
        : "none" as const;

    return {
      ...existing,
      // O objetivo, público e identidade visual pertencem ao produto inteiro.
      // Refinamentos acrescentam capacidades sem reclassificar ou apagar o que
      // já foi contratado e entregue em etapas anteriores.
      requiredCapabilities: unique([...existing.requiredCapabilities, ...candidate.requiredCapabilities]),
      visualDirection: unique([...existing.visualDirection, ...candidate.visualDirection]),
      visualProfile: {
        ...existing.visualProfile,
        allowVideo: existing.visualProfile.allowVideo || candidate.visualProfile.allowVideo,
        allow3D: existing.visualProfile.allow3D || candidate.visualProfile.allow3D,
        require3DFallback: existing.visualProfile.require3DFallback || candidate.visualProfile.require3DFallback,
        maxExternalPackages: Math.max(existing.visualProfile.maxExternalPackages, candidate.visualProfile.maxExternalPackages),
        performanceRules: unique([...existing.visualProfile.performanceRules, ...candidate.visualProfile.performanceRules]),
      },
      media: {
        imageCount: Math.max(existing.media.imageCount, candidate.media.imageCount),
        videoCount: Math.max(existing.media.videoCount, candidate.media.videoCount, videoUrls.length),
        videoMode,
        videoUrls,
      },
      acceptanceCriteria: unique([...existing.acceptanceCriteria, ...candidate.acceptanceCriteria]),
    };
  }
  if (hasExistingApp && existing) return existing;
  return candidate || existing;
}
