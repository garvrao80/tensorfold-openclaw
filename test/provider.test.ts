import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ProviderCatalogContext,
  OpenClawPluginApi,
  ProviderWrapStreamFnContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { createProvider, patchToolChoice } from "../src/provider.js";
import { fixture, json, catalog, KEY } from "./fixture.js";
import entry from "../src/index.js";

test("provider catalog resolves the OpenClaw credential and publishes local, text-only, zero-cost models", async () => {
  const host = await fixture((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    json(res, catalog);
  });
  try {
    const provider = createProvider({
      pluginConfig: { baseUrl: host.baseUrl },
    });
    const context = {
      config: {},
      env: {},
      resolveProviderApiKey: () => ({
        apiKey: "TENSORFOLD_API_KEY",
        discoveryApiKey: KEY,
      }),
    } as ProviderCatalogContext;
    const result = await provider.catalog!.run(context);
    assert.ok(result && "provider" in result);
    assert.equal(result.provider.baseUrl, host.baseUrl);
    assert.equal(result.provider.models[0].contextWindow, 32768);
    assert.deepEqual(result.provider.models[0].input, ["text"]);
    assert.equal(result.provider.apiKey, "TENSORFOLD_API_KEY");
    assert.ok(!JSON.stringify(result).includes(KEY));
    assert.equal(
      await provider.catalog!.run({
        ...context,
        resolveProviderApiKey: () => ({ apiKey: undefined }),
      }),
      null,
    );
    assert.equal(provider.auth[0].kind, "api_key");
  } finally {
    await host.close();
  }
});

test("tool-choice fallback changes only required/named choice and native opt-in preserves the payload", () => {
  for (const choice of [
    "required",
    { type: "function", function: { name: "read" } },
  ]) {
    const payload = {
      tool_choice: choice,
      messages: [{ role: "user", content: "unchanged" }],
      temperature: 0.7,
      seed: 12,
      tools: [],
    };
    const before = structuredClone(payload);
    patchToolChoice(payload, false);
    assert.deepEqual(payload, { ...before, tool_choice: "auto" });
    patchToolChoice(before, true);
    assert.deepEqual(before.tool_choice, choice);
  }
  for (const choice of [undefined, "none", "auto"]) {
    const payload = { tool_choice: choice };
    patchToolChoice(payload, false);
    assert.equal(payload.tool_choice, choice);
  }
});

test("gateway registers a read-scoped method and resolves current auth per request; no secret enters errors or responses", async () => {
  let handler:
    | Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1]
    | undefined;
  let resolves = 0;
  const host = await fixture((req, res) =>
    json(res, req.url === "/v1/models" ? catalog : { status: "ok" }),
  );
  const api = {
    pluginConfig: { baseUrl: host.baseUrl },
    registerProvider() {},
    registerGatewayMethod(
      name: string,
      fn: typeof handler,
      options: { scope: string },
    ) {
      assert.equal(name, "tensorfold.snapshot");
      assert.equal(options.scope, "operator.read");
      handler = fn;
    },
    session: {
      controls: {
        registerControlUiDescriptor(descriptor: { surface: string }) {
          assert.equal(descriptor.surface, "tab");
        },
      },
    },
    runtime: {
      config: { current: () => ({}) },
      modelAuth: {
        async resolveApiKeyForProvider() {
          resolves++;
          return { apiKey: KEY };
        },
      },
    },
  } as unknown as OpenClawPluginApi;
  try {
    entry.register(api);
    for (let i = 0; i < 2; i++) {
      const replies: unknown[][] = [];
      await handler!({
        respond: (...values: unknown[]) => replies.push(values),
      } as unknown as Parameters<NonNullable<typeof handler>>[0]);
      assert.equal(replies[0][0], true);
      assert.ok(!JSON.stringify(replies).includes(KEY));
    }
    assert.equal(resolves, 2);
    api.runtime.modelAuth.resolveApiKeyForProvider = async () => {
      throw new Error(KEY);
    };
    const replies: unknown[][] = [];
    await handler!({
      respond: (...values: unknown[]) => replies.push(values),
    } as unknown as Parameters<NonNullable<typeof handler>>[0]);
    assert.equal(replies[0][0], false);
    assert.ok(!JSON.stringify(replies).includes(KEY));
  } finally {
    await host.close();
  }
});
