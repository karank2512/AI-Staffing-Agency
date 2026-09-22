import type { UserRole } from "@prisma/client";
import { can, type Permission } from "@/server/auth/permissions";

/**
 * What the signed-in role may do on one page, as a plain serializable object a client component can read.
 *
 * Pages use this ONLY to hide or disable controls — every one of these permissions is also enforced inside the
 * server module that performs the mutation, so a hidden button is a courtesy, never the security boundary.
 *
 * Callers pass `session.role`. When they don't, the least privileged role is assumed: a page that forgets to
 * thread the role shows fewer controls, never more.
 */
export const DEFAULT_VIEWER_ROLE: UserRole = "MEMBER";

export type PermissionMap<K extends Permission> = { [P in K]: boolean };

export function permissionSubset<K extends Permission>(role: UserRole | undefined, keys: readonly K[]): PermissionMap<K> {
  const actual = role ?? DEFAULT_VIEWER_ROLE;
  return Object.fromEntries(keys.map((key) => [key, can(actual, key)])) as PermissionMap<K>;
}

/** Roster cards: Run now + the hire button; manage actions live on the profile. */
export const WORKFORCE_PERMISSION_KEYS = ["workers.run", "workers.hire", "workers.manage", "approvals.decide"] as const;
export type WorkforcePermissions = PermissionMap<(typeof WORKFORCE_PERMISSION_KEYS)[number]>;

/** Worker profile header + tabs: run, chat, pause/retire, permissions, schedule, replace, reviews. */
export const WORKER_PERMISSION_KEYS = [
  "workers.run",
  "workers.chat",
  "workers.manage",
  "workers.hire",
  "reviews.generate",
  "deliverables.review",
] as const;
export type WorkerPermissions = PermissionMap<(typeof WORKER_PERMISSION_KEYS)[number]>;

/** Run detail: cancel, retry, decide an approval (external sends need an admin). */
export const RUN_PERMISSION_KEYS = ["workers.run", "approvals.decide", "approvals.decideExternal"] as const;
export type RunPermissions = PermissionMap<(typeof RUN_PERMISSION_KEYS)[number]>;

export const APPROVAL_PERMISSION_KEYS = ["approvals.decide", "approvals.decideExternal"] as const;
export type ApprovalPermissions = PermissionMap<(typeof APPROVAL_PERMISSION_KEYS)[number]>;

export const DELIVERABLE_PERMISSION_KEYS = ["deliverables.review", "workers.run"] as const;
export type DeliverablePermissions = PermissionMap<(typeof DELIVERABLE_PERMISSION_KEYS)[number]>;

/** Jobs list + detail, and the hire flow: scoping, editing and approving a spec, then hiring. */
export const JOB_PERMISSION_KEYS = ["jobs.manage", "workers.hire", "workers.manage"] as const;
export type JobPermissions = PermissionMap<(typeof JOB_PERMISSION_KEYS)[number]>;

/** Settings: credentials are admin work, workspace settings and members are the owner's. */
export const SETTINGS_PERMISSION_KEYS = ["credentials.manage", "members.invite", "members.manage", "org.manage"] as const;
export type SettingsPermissions = PermissionMap<(typeof SETTINGS_PERMISSION_KEYS)[number]>;
