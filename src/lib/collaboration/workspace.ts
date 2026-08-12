export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspaceAction = "manage_workspace" | "manage_members" | "edit_project" | "view_project";

const ROLE_ACTIONS: Record<WorkspaceRole, WorkspaceAction[]> = {
  owner: ["manage_workspace", "manage_members", "edit_project", "view_project"],
  admin: ["manage_workspace", "manage_members", "edit_project", "view_project"],
  editor: ["edit_project", "view_project"],
  viewer: ["view_project"],
};

export function canWorkspace(role: WorkspaceRole | null | undefined, action: WorkspaceAction): boolean {
  return !!role && ROLE_ACTIONS[role].includes(action);
}

export function normalizeWorkspaceName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw new Error("Nome do workspace inválido.");
  return name;
}

export function normalizeInviteEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    throw new Error("E-mail de convite inválido.");
  }
  return email;
}

export function normalizeMemberRole(value: string): Exclude<WorkspaceRole, "owner"> {
  if (value === "admin" || value === "editor" || value === "viewer") return value;
  throw new Error("Papel de membro inválido.");
}
