import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { activateVersion, assertVersionMutable, createProposedVersion, rejectProposedVersion, startRun } from "@/server/workers";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint } from "../helpers/fixtures";
import { activityOf, createRun, grantsOf, loadVersionRow, loadWorkerRow, type Hired, type TestOrg } from "./helpers";

describe("worker versions", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeEach(async () => {
    t = await createTestOrg("workers-versions");
    hired = await createHiredWorker(t.organization.id, { userId: t.user.id });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  describe("assertVersionMutable", () => {
    it("throws IMMUTABLE_VERSION once a run has locked the version", async () => {
      await startRun(t.session, hired.worker.id);
      const locked = await loadVersionRow(hired.version.id);
      expect(locked.lockedAt).not.toBeNull();
      await expect(assertVersionMutable(hired.version.id)).rejects.toMatchObject({ code: "IMMUTABLE_VERSION" });
    });

    it("throws for an ACTIVE version even when unlocked, and passes for an unlocked PROPOSED one", async () => {
      await expect(assertVersionMutable(hired.version.id)).rejects.toMatchObject({ code: "IMMUTABLE_VERSION" });
      const proposed = await createProposedVersion({
        organizationId: t.organization.id,
        workerId: hired.worker.id,
        blueprint: hired.blueprint,
        changeReason: "MANUAL",
        changeSummary: "No-op proposal",
      });
      await expect(assertVersionMutable(proposed.versionId)).resolves.toBeUndefined();
    });
  });

  describe("createProposedVersion", () => {
    it("increments the version, links the parent and rejects the previous open proposal", async () => {
      const first = await createProposedVersion({
        organizationId: t.organization.id,
        workerId: hired.worker.id,
        blueprint: hired.blueprint,
        changeReason: "SPEC_CHANGE",
        changeSummary: "Run daily",
        userId: t.user.id,
      });
      const second = await createProposedVersion({
        organizationId: t.organization.id,
        workerId: hired.worker.id,
        blueprint: makeBlueprint({ collectorTier: "reasoning" }),
        changeReason: "REPLACEMENT",
        changeSummary: "Upgrade the researcher",
      });
      expect(first.version).toBe(2);
      expect(second.version).toBe(3);

      const rows = await db.workerVersion.findMany({ where: { workerId: hired.worker.id }, orderBy: { version: "asc" } });
      expect(rows.map((r) => [r.version, r.status])).toEqual([
        [1, "ACTIVE"],
        [2, "REJECTED"],
        [3, "PROPOSED"],
      ]);
      expect(rows[2].parentVersionId).toBe(hired.version.id);
      expect(rows[2].changeSummary).toBe("Upgrade the researcher");

      const proposed = await activityOf(t.organization.id, hired.worker.id, "VERSION_PROPOSED");
      expect(proposed).toHaveLength(2);
      expect(proposed[0].actorType).toBe("USER");
      expect(proposed[0].metadata).toMatchObject({ versionId: first.versionId, version: 2, changeReason: "SPEC_CHANGE" });
      expect(proposed[1].detail).toContain("Supersedes v2");
    });

    it("rejects an invalid blueprint with VALIDATION and is org-scoped", async () => {
      const broken = { ...hired.blueprint, components: [] };
      await expect(
        createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: broken as never, changeReason: "MANUAL", changeSummary: "" }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const other = await createTestOrg("workers-versions-other");
      try {
        await expect(
          createProposedVersion({ organizationId: other.organization.id, workerId: hired.worker.id, blueprint: hired.blueprint, changeReason: "MANUAL", changeSummary: "" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("activateVersion", () => {
    it("swaps the current version, retires the old one, syncs grants and resets the track record", async () => {
      // Tighten one grant by hand (user-set approval) and revoke a tool that stays in the blueprint.
      await db.workerToolGrant.update({ where: { workerId_toolName: { workerId: hired.worker.id, toolName: "fetch_url" } }, data: { requiresApproval: true } });
      await db.workerToolGrant.update({ where: { workerId_toolName: { workerId: hired.worker.id, toolName: "extract_data" } }, data: { revokedAt: new Date() } });
      await db.worker.update({ where: { id: hired.worker.id }, data: { score: 42, health: "NEEDS_ATTENTION", healthReason: "Score below 65", scheduleKind: "DAILY", scheduleDow: null } });

      // New blueprint: adds a notifier (send_notification), drops web_search from the researcher.
      const next = makeBlueprint({ withNotifier: true });
      const collector = next.components.find((c) => c.id === "collector");
      if (collector?.type !== "agent") throw new Error("fixture");
      collector.tools = collector.tools.filter((x) => x !== "web_search");
      next.tools = next.tools.filter((x) => x.toolName !== "web_search");

      const proposed = await createProposedVersion({
        organizationId: t.organization.id,
        workerId: hired.worker.id,
        blueprint: next,
        changeReason: "REPLACEMENT",
        changeSummary: "Add a notifier, drop web search",
        userId: t.user.id,
      });
      await activateVersion(t.session, proposed.versionId, { newName: "Nova" });

      const worker = await loadWorkerRow(hired.worker.id);
      expect(worker.currentVersionId).toBe(proposed.versionId);
      expect(worker.name).toBe("Nova");
      expect(worker.score).toBeNull();
      expect(worker.health).toBe("UNKNOWN");
      expect(worker.healthReason).toBeNull();
      expect(worker.scheduleKind).toBe("WEEKLY");
      expect(worker.scheduleDow).toBe(1);
      expect(worker.nextRunAt).not.toBeNull();

      const old = await loadVersionRow(hired.version.id);
      expect(old.status).toBe("REPLACED");
      expect(old.retiredAt).not.toBeNull();
      const active = await loadVersionRow(proposed.versionId);
      expect(active.status).toBe("ACTIVE");
      expect(active.activatedAt).not.toBeNull();
      expect((active.blueprint as { persona: { name: string } }).persona.name).toBe("Nova");

      const grants = await grantsOf(hired.worker.id);
      expect(grants.get("send_notification")?.revokedAt).toBeNull(); // added
      expect(grants.get("send_notification")?.requiresApproval).toBe(true);
      expect(grants.get("web_search")?.revokedAt).not.toBeNull(); // removed from the blueprint
      expect(grants.get("fetch_url")?.requiresApproval).toBe(true); // user-tightened, kept
      expect(grants.get("extract_data")?.revokedAt).not.toBeNull(); // user-revoked on a tool still in the blueprint, kept

      const replaced = await activityOf(t.organization.id, hired.worker.id, "WORKER_REPLACED");
      expect(replaced).toHaveLength(1);
      expect(replaced[0].title).toContain("hired a replacement for Alex");
      expect(replaced[0].metadata).toMatchObject({ versionId: proposed.versionId, version: 2, changeReason: "REPLACEMENT" });
    });

    it("restores a grant that was revoked only because an earlier version dropped the tool", async () => {
      const without = makeBlueprint();
      const collector = without.components.find((c) => c.id === "collector");
      if (collector?.type !== "agent") throw new Error("fixture");
      collector.tools = collector.tools.filter((x) => x !== "extract_data");
      without.tools = without.tools.filter((x) => x.toolName !== "extract_data");
      const v2 = await createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: without, changeReason: "MANUAL", changeSummary: "drop extract" });
      await activateVersion(t.session, v2.versionId);
      expect((await grantsOf(hired.worker.id)).get("extract_data")?.revokedAt).not.toBeNull();

      const v3 = await createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: makeBlueprint(), changeReason: "MANUAL", changeSummary: "bring it back" });
      await activateVersion(t.session, v3.versionId);
      expect((await grantsOf(hired.worker.id)).get("extract_data")?.revokedAt).toBeNull();
      const updated = await activityOf(t.organization.id, hired.worker.id, "WORKER_REPLACED");
      expect(updated[1].title).toContain("updated how Alex works");
    });

    it("refuses while a run is RUNNING or waiting for approval, and refuses non-proposed versions", async () => {
      const proposed = await createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: hired.blueprint, changeReason: "MANUAL", changeSummary: "" });
      const running = await createRun(hired, { status: "RUNNING" });
      await expect(activateVersion(t.session, proposed.versionId)).rejects.toMatchObject({ code: "CONFLICT" });
      await db.run.update({ where: { id: running.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), lockedBy: null, lockedAt: null, heartbeatAt: null } });

      await expect(activateVersion(t.session, hired.version.id)).rejects.toMatchObject({ code: "CONFLICT" });
      await activateVersion(t.session, proposed.versionId);
      expect((await loadWorkerRow(hired.worker.id)).currentVersionId).toBe(proposed.versionId);
    });

    it("keeps a paused worker paused (no nextRunAt)", async () => {
      await db.worker.update({ where: { id: hired.worker.id }, data: { status: "PAUSED", nextRunAt: null } });
      const proposed = await createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: hired.blueprint, changeReason: "MANUAL", changeSummary: "" });
      await activateVersion(t.session, proposed.versionId);
      const worker = await loadWorkerRow(hired.worker.id);
      expect(worker.status).toBe("PAUSED");
      expect(worker.nextRunAt).toBeNull();
    });
  });

  describe("rejectProposedVersion", () => {
    it("marks the proposal REJECTED and records VERSION_REJECTED", async () => {
      const proposed = await createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: hired.blueprint, changeReason: "SPEC_CHANGE", changeSummary: "Run daily" });
      await rejectProposedVersion(t.session, proposed.versionId);
      expect((await loadVersionRow(proposed.versionId)).status).toBe("REJECTED");
      const events = await activityOf(t.organization.id, hired.worker.id, "VERSION_REJECTED");
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({ versionId: proposed.versionId, version: 2 });

      try {
        await rejectProposedVersion(t.session, proposed.versionId);
        expect.unreachable();
      } catch (e) {
        expect(isAppError(e) && e.code).toBe("CONFLICT");
      }
    });
  });
});
