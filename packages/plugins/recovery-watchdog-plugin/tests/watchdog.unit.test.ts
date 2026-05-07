// Unit tests for reconcileStaleBlockedParents (recovery-watchdog plugin).
// Inner TDD loop for LIF-42 — see PLAN.md §6 (BDD-on-TDD).
//
// The watchdog itself does not enforce the 1-hour staleness threshold; that
// is delegated to the candidate-query SQL (`WHERE coalesce(last_output_at, ...)
// <= now() - interval '1 hour'`).  These tests stub `ctx.db.query` to model
// what the SQL would have returned for each scenario, and exercise the
// post-query JS reconciliation logic against those candidate sets.

import { describe, it, expect, vi } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { reconcileStaleBlockedParents } from "../src/watchdog.js";
import type { StaleRunRow } from "../src/types.js";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const STALE_RUN_ISSUE_ID = "00000000-0000-0000-0000-000000000010";
const PARENT_ISSUE_ID = "00000000-0000-0000-0000-000000000020";
const ASSIGNEE_AGENT_ID = "00000000-0000-0000-0000-0000000000a0";
const MANAGER_AGENT_ID = "00000000-0000-0000-0000-0000000000b0";

function makeStaleRun(overrides: Partial<StaleRunRow> = {}): StaleRunRow {
  return {
    id: "run-1",
    companyId: COMPANY_ID,
    agentId: "agent-runner",
    issueId: STALE_RUN_ISSUE_ID,
    status: "running",
    contextSnapshot: { retryReason: "test_reason" },
    error: null,
    errorCode: null,
    ...overrides,
  };
}

function makeBlockedParent(overrides: Record<string, unknown> = {}) {
  return {
    id: PARENT_ISSUE_ID,
    companyId: COMPANY_ID,
    title: "Parent blocked by a stalled child",
    identifier: "LIF-100",
    status: "blocked",
    priority: "medium",
    assigneeAgentId: ASSIGNEE_AGENT_ID,
    createdByAgentId: null,
    description: null,
    ...overrides,
  };
}

function makeBlockerSummary(id: string, identifier: string | null = null) {
  return {
    id,
    identifier: identifier ?? `LIF-${id.slice(-3)}`,
    title: "stalled child",
    status: "in_progress" as const,
    priority: "medium" as const,
    assigneeAgentId: null,
    assigneeUserId: null,
  };
}

interface MockCtx {
  db: { query: ReturnType<typeof vi.fn> };
  issues: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    relations: { get: ReturnType<typeof vi.fn> };
  };
  agents: {
    get: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
}

function makeCtx(): MockCtx {
  const ctx: MockCtx = {
    db: { query: vi.fn() },
    issues: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "recovery-created" }),
      relations: { get: vi.fn().mockResolvedValue({ blockedBy: [], blocks: [] }) },
    },
    agents: {
      get: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
  };

  // Default agents.get: assignee reports to manager; manager has no manager.
  ctx.agents.get.mockImplementation(async (id: string) => {
    if (id === ASSIGNEE_AGENT_ID) {
      return {
        id: ASSIGNEE_AGENT_ID,
        companyId: COMPANY_ID,
        status: "idle",
        reportsTo: MANAGER_AGENT_ID,
        role: "engineer",
      };
    }
    if (id === MANAGER_AGENT_ID) {
      return {
        id: MANAGER_AGENT_ID,
        companyId: COMPANY_ID,
        status: "idle",
        reportsTo: null,
        role: "engineer",
      };
    }
    return null;
  });

  return ctx;
}

function asPluginContext(ctx: MockCtx): PluginContext {
  return ctx as unknown as PluginContext;
}

describe("reconcileStaleBlockedParents — candidate query", () => {
  it("creates a recovery issue once, with originKind=stranded_issue_recovery, the resolved owner, and the parent as blocker", async () => {
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([makeStaleRun()]);
    ctx.issues.list.mockImplementation(async (input: { status?: string; originId?: string }) => {
      if (input.status === "blocked") return [makeBlockedParent()];
      return [];
    });
    ctx.issues.relations.get.mockResolvedValue({
      blockedBy: [makeBlockerSummary(STALE_RUN_ISSUE_ID)],
      blocks: [],
    });

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.create).toHaveBeenCalledTimes(1);
    expect(ctx.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        originKind: "stranded_issue_recovery",
        originId: `stranded_blocker_under_blocked_parent:${PARENT_ISSUE_ID}:${STALE_RUN_ISSUE_ID}`,
        assigneeAgentId: MANAGER_AGENT_ID,
        blockedByIssueIds: [PARENT_ISSUE_ID],
      }),
    );
  });

  it("does not create a recovery issue when the stale-run issue is not a blocker of any blocked parent", async () => {
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([makeStaleRun()]);
    ctx.issues.list.mockImplementation(async (input: { status?: string }) => {
      if (input.status === "blocked") return [makeBlockedParent()];
      return [];
    });
    // The blocked parent's blockedBy chain does NOT include the stale run.
    ctx.issues.relations.get.mockResolvedValue({ blockedBy: [], blocks: [] });

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.create).not.toHaveBeenCalled();
  });
});

describe("reconcileStaleBlockedParents — threshold check", () => {
  it("does not create a recovery issue when the SQL threshold filters out the candidate (e.g. lastOutputAt = now - 59:59)", async () => {
    const ctx = makeCtx();
    // SQL `<= now() - interval '1 hour'` rejects rows younger than 60 minutes,
    // so a 59:59-old run never reaches the JS layer.
    ctx.db.query.mockResolvedValue([]);

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.list).not.toHaveBeenCalled();
    expect(ctx.issues.create).not.toHaveBeenCalled();
  });

  it("creates a recovery issue when the SQL threshold accepts the candidate (e.g. lastOutputAt = now - 60:01)", async () => {
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([makeStaleRun()]);
    ctx.issues.list.mockImplementation(async (input: { status?: string }) => {
      if (input.status === "blocked") return [makeBlockedParent()];
      return [];
    });
    ctx.issues.relations.get.mockResolvedValue({
      blockedBy: [makeBlockerSummary(STALE_RUN_ISSUE_ID)],
      blocks: [],
    });

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.create).toHaveBeenCalledTimes(1);
  });

  it("queries heartbeat_runs with the 1-hour staleness threshold", async () => {
    // Documents at the unit-test layer that the threshold is enforced via SQL,
    // so a refactor that drops the threshold from the query string fails here.
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([]);

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.db.query).toHaveBeenCalledTimes(1);
    const sql = ctx.db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/interval\s+'1\s+hour'/i);
    expect(sql).toMatch(/last_output_at/);
    expect(sql).toMatch(/status\s*=\s*'running'/i);
  });
});

describe("reconcileStaleBlockedParents — dedup fingerprint", () => {
  it("does not create a second recovery issue for the same (parent, blocker) pair on a second sweep", async () => {
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([makeStaleRun()]);
    ctx.issues.relations.get.mockResolvedValue({
      blockedBy: [makeBlockerSummary(STALE_RUN_ISSUE_ID)],
      blocks: [],
    });

    const fingerprint = `stranded_blocker_under_blocked_parent:${PARENT_ISSUE_ID}:${STALE_RUN_ISSUE_ID}`;
    let recoveryExists = false;
    ctx.issues.list.mockImplementation(async (input: { status?: string; originId?: string }) => {
      if (input.status === "blocked") return [makeBlockedParent()];
      if (input.originId === fingerprint) {
        return recoveryExists
          ? [{ id: "recovery-1", companyId: COMPANY_ID, status: "in_progress" }]
          : [];
      }
      return [];
    });

    await reconcileStaleBlockedParents(asPluginContext(ctx));
    recoveryExists = true; // first sweep created a non-terminal recovery issue
    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.create).toHaveBeenCalledTimes(1);
  });

  it("filters out terminal (`done` / `cancelled`) recovery issues so a fresh recovery is created when the prior one is closed", async () => {
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([makeStaleRun()]);
    ctx.issues.relations.get.mockResolvedValue({
      blockedBy: [makeBlockerSummary(STALE_RUN_ISSUE_ID)],
      blocks: [],
    });
    const fingerprint = `stranded_blocker_under_blocked_parent:${PARENT_ISSUE_ID}:${STALE_RUN_ISSUE_ID}`;
    ctx.issues.list.mockImplementation(async (input: { status?: string; originId?: string }) => {
      if (input.status === "blocked") return [makeBlockedParent()];
      if (input.originId === fingerprint) {
        return [
          { id: "old-recovery-done", companyId: COMPANY_ID, status: "done" },
          { id: "old-recovery-cancelled", companyId: COMPANY_ID, status: "cancelled" },
        ];
      }
      return [];
    });

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.create).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileStaleBlockedParents — no-stale-runs short-circuit", () => {
  it("returns early without listing blocked issues when the candidate query is empty", async () => {
    const ctx = makeCtx();
    ctx.db.query.mockResolvedValue([]);

    await reconcileStaleBlockedParents(asPluginContext(ctx));

    expect(ctx.issues.list).not.toHaveBeenCalled();
    expect(ctx.issues.relations.get).not.toHaveBeenCalled();
    expect(ctx.issues.create).not.toHaveBeenCalled();
  });
});
