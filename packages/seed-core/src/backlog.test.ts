/**
 * backlog.test.ts — priority ordering and status transitions.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createBacklogItem, orderBacklog, transitionBacklog } from "./backlog.ts";
import type { FrictionCluster } from "./cluster.ts";

function cluster(id: string, severity: number, occurrences: number): FrictionCluster {
  return {
    id,
    signals: [],
    features: {},
    taskCount: 1,
    occurrences,
    severity,
    actionable: true,
  };
}

test("priority is severity * frequency * cost and ordering is descending", () => {
  const low = createBacklogItem(cluster("cluster-1", 0.5, 2));
  const high = createBacklogItem(cluster("cluster-2", 1, 5), { cost: 2 });
  assert.equal(low.priority, 1);
  assert.equal(high.priority, 10);
  assert.deepEqual(
    orderBacklog([low, high]).map((item) => item.id),
    ["backlog-cluster-2", "backlog-cluster-1"],
  );
  assert.equal(low.status, "queued");
});

test("rejects a non-positive cost", () => {
  assert.throws(() => createBacklogItem(cluster("cluster-1", 1, 1), { cost: 0 }), /cost/);
});

test("status transitions follow the queued -> researching -> experimenting -> resolved path", () => {
  const item = createBacklogItem(cluster("cluster-1", 1, 1));
  const researching = transitionBacklog(item, "researching");
  const experimenting = transitionBacklog(researching, "experimenting");
  const resolved = transitionBacklog(experimenting, "resolved");
  assert.equal(resolved.status, "resolved");
  assert.throws(() => transitionBacklog(item, "resolved"), /illegal backlog transition/);
  assert.throws(() => transitionBacklog(resolved, "queued"), /illegal backlog transition/);
  assert.equal(transitionBacklog(item, "dismissed").status, "dismissed");
});
