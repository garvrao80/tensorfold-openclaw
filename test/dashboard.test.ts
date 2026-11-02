import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type {
  ControlUiHost,
  ControlUiViewContext,
} from "openclaw/plugin-sdk/control-ui";
import { mountDashboard } from "../src/dashboard.js";
import type { Telemetry } from "../src/contracts.js";

const snapshot: Telemetry = {
  observedAt: "2026-01-01T00:00:00Z",
  baseUrl: "http://127.0.0.1:8080/v1",
  models: [
    {
      id: '<img src=x onerror="alert(1)">',
      contextWindow: 32768,
      reasoning: false,
    },
  ],
  health: { state: "ok" },
  stats: {
    available: true,
    values: { running: 0, decode_tokens_per_second: 12.5 },
  },
  memory: { available: false, values: {}, message: "Memory not reported" },
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("native dashboard escapes model text, shows real zero and unknown separately, and selects only a new session", async () => {
  const dom = new JSDOM("<main></main>");
  const original = globalThis.document;
  globalThis.document = dom.window.document;
  const abort = new AbortController();
  const actions: unknown[] = [];
  let requests = 0;
  const host = {
    connection: { connected: true, canRead: true, canWrite: true },
    agents: { selectedId: "main", defaultId: "main" },
    request: async () => {
      requests++;
      return snapshot;
    },
    subscribe: () => () => {},
    sessions: {
      create: async () => "agent:main:new",
      patch: async (...args: unknown[]) => {
        actions.push(args);
      },
      open: (...args: unknown[]) => {
        actions.push(args);
      },
    },
  } as unknown as ControlUiHost;
  const context = {
    host,
    signal: abort.signal,
    presented: true,
  } as ControlUiViewContext;
  const root = dom.window.document.querySelector("main")!;
  const view = mountDashboard(root, context);
  try {
    await tick();
    assert.equal(root.querySelectorAll("img").length, 0);
    assert.equal(
      root.querySelector("option")!.textContent,
      snapshot.models[0].id,
    );
    assert.ok(root.textContent!.includes("Unavailable"));
    assert.ok(root.textContent!.includes("0"));
    (root.querySelector(".tf-chat") as HTMLButtonElement).click();
    await tick();
    assert.deepEqual(actions[0], [
      { sessionKey: "agent:main:new", agentId: "main" },
      { model: `tensorfold/${snapshot.models[0].id}` },
    ]);
    assert.deepEqual(actions[1], [
      { sessionKey: "agent:main:new", agentId: "main" },
    ]);
    view?.update?.({ ...context, presented: false });
    await tick();
    assert.equal(requests, 1);
  } finally {
    view?.dispose?.();
    abort.abort();
    globalThis.document = original;
    dom.window.close();
  }
});

test("read-only users cannot start chat; disposed pending results do not update the page", async () => {
  const dom = new JSDOM("<main></main>");
  const original = globalThis.document;
  globalThis.document = dom.window.document;
  let resolve!: (value: Telemetry) => void;
  const pending = new Promise<Telemetry>((done) => {
    resolve = done;
  });
  const abort = new AbortController();
  const host = {
    connection: { connected: true, canRead: true, canWrite: false },
    request: () => pending,
    subscribe: () => () => {},
  } as unknown as ControlUiHost;
  const root = dom.window.document.querySelector("main")!;
  const view = mountDashboard(root, {
    host,
    signal: abort.signal,
    presented: true,
  } as ControlUiViewContext);
  try {
    assert.equal(
      (root.querySelector(".tf-chat") as HTMLButtonElement).disabled,
      true,
    );
    view?.dispose?.();
    resolve(snapshot);
    await tick();
    assert.equal(root.childElementCount, 0);
  } finally {
    abort.abort();
    globalThis.document = original;
    dom.window.close();
  }
});
