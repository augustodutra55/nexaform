"use client";

import { useParams } from "next/navigation";
import { GitHubPanel } from "@/components/project/github-panel";

export function GitHubProjectButton() {
  const params = useParams<{ id: string }>();
  if (!params?.id) return null;
  return <GitHubPanel projectId={params.id} enabled />;
}
