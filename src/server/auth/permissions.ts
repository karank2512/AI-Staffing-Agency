import type { UserRole } from "@prisma/client";
import { AppError } from "@/server/errors";
import type { SessionContext } from "./types";

/**
 * Role-based permissions — the single source of truth. Enforced INSIDE server modules (they all receive a
 * SessionContext), so no page or action can skip them; pages call `can()` only to hide/disable controls.
 * Pure and dependency-free (no next-auth), so any server module may import it directly.
 *
 *   MEMBER — day-to-day work: view everything, run workers, chat, review deliverables, decide approvals for
 *            tools without external side effects, request performance reviews.
 *   ADMIN  — manages the workforce: scope/hire/replace/pause/retire, permissions + schedules, approve external
 *            actions (sending email/Slack), tool credentials, invite members.
 *   OWNER  — the workspace: roles, removing members, budget and workspace settings.
 */
export const PERMISSIONS = {
  "workers.run": "MEMBER",
  "workers.chat": "MEMBER",
  "deliverables.review": "MEMBER",
  "approvals.decide": "MEMBER",
  "reviews.generate": "MEMBER",
  "members.view": "MEMBER",

  "jobs.manage": "ADMIN",
  "workers.hire": "ADMIN",
  "workers.manage": "ADMIN",
  "approvals.decideExternal": "ADMIN",
  "credentials.manage": "ADMIN",
  "members.invite": "ADMIN",

  "members.manage": "OWNER",
  "org.manage": "OWNER",
} as const satisfies Record<string, UserRole>;

export type Permission = keyof typeof PERMISSIONS;

const RANK: Record<UserRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

/** Human phrasing for the refusal message: "Only workspace admins and owners can hire workers." */
const WHAT: Record<Permission, string> = {
  "workers.run": "run workers",
  "workers.chat": "talk to workers",
  "deliverables.review": "review deliverables",
  "approvals.decide": "decide approvals",
  "reviews.generate": "request performance reviews",
  "members.view": "view members",
  "jobs.manage": "create or change jobs",
  "workers.hire": "hire workers",
  "workers.manage": "manage workers",
  "approvals.decideExternal": "approve actions that leave the workspace",
  "credentials.manage": "manage tool credentials",
  "members.invite": "invite teammates",
  "members.manage": "change roles or remove members",
  "org.manage": "change workspace settings",
};

export function roleRank(role: UserRole): number {
  return RANK[role];
}

export function can(role: UserRole, permission: Permission): boolean {
  return RANK[role] >= RANK[PERMISSIONS[permission]];
}

/** Throws AppError("FORBIDDEN") with a human message when the session's role is too low. */
export function assertCan(session: Pick<SessionContext, "role">, permission: Permission): void {
  if (can(session.role, permission)) return;
  const min = PERMISSIONS[permission];
  const who = min === "OWNER" ? "workspace owners" : "workspace admins and owners";
  throw new AppError("FORBIDDEN", `Only ${who} can ${WHAT[permission]}.`);
}

/** Every permission the role holds — handy for passing a serializable `permissions` prop to client components. */
export function permissionsFor(role: UserRole): Record<Permission, boolean> {
  return Object.fromEntries(
    (Object.keys(PERMISSIONS) as Permission[]).map((p) => [p, can(role, p)]),
  ) as Record<Permission, boolean>;
}
