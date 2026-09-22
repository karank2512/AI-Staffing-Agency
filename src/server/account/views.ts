import type { UserRole } from "@prisma/client";

/**
 * Plain, serializable shapes the account module hands to pages and server actions.
 * No Prisma objects, no Decimal, no Date — dates are ISO strings and money is a number.
 */

export interface MemberView {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** ISO, or null if they have never signed in. */
  lastSignInAt: string | null;
  /** Removed from the workspace: kept for history, but they cannot sign in. */
  disabled: boolean;
  createdAt: string;
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationView {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  /** ISO */
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedByName: string;
}

export interface OrgBudgetView {
  /** UTC "YYYY-MM" */
  month: string;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  exceeded: boolean;
}

export interface OrgSettingsView {
  organizationId: string;
  name: string;
  slug: string;
  isDemo: boolean;
  createdAt: string;
  /** null = fall back to the platform default (see `budget.budgetUsd` for the effective number). */
  monthlyBudgetUsd: number | null;
  defaultMonthlyBudgetUsd: number;
  suspended: boolean;
  memberCount: number;
  limits: {
    maxConcurrentRuns: number;
    maxQueuedRuns: number;
    maxActiveWorkers: number;
  };
  budget: OrgBudgetView;
}
