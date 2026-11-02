import { test } from "node:test";
import assert from "node:assert/strict";
import { createLlmRuntime, type Model, type Context } from "@openclaw/ai";
import { registerBuiltInApiProviders } from "@openclaw/ai/providers";
import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import { createProvider } from "../src/provider.js";
import { fixture, KEY } from "./fixture.js";

function model(baseUrl: string): Model<"openai-completions"> {
  return {
    id: "example/model",
    name: "fixture",
    provider: "tensorfold",
    api: "openai-completions",
    baseUrl,
    reasoning: false,
    input: ["text"],
    contextWindow: 32768,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
const context: Context = {
  messages: [{ role: "user", content: "Use the tool", timestamp: 1 }],
  tools: [
    {
      name: "lookup",
      description: "Look up a value",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  ],
};

test("the real OpenClaw transport preserves streamed tool arguments and applies the fallback only at dispatch", async () => {
  const requests: Record<string, unknown>[] = [];
  const host = await fixture(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const event = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "chatcmpl-fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "example/model",
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    event({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_fixture",
          type: "function",
          function: { name: "lookup", arguments: '{"key":' },
        },
      ],
    });
    event({ tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] });
    event({}, "tool_calls");
    res.end("data: [DONE]\n\n");
  });
  try {
    const runtime = createLlmRuntime();
    registerBuiltInApiProviders(runtime.registry);
    const provider = createProvider({ pluginConfig: {} });
    const wrapped = provider.wrapStreamFn!({
      provider: "tensorfold",
      modelId: "example/model",
      streamFn: runtime.streamSimple,
    } as ProviderWrapStreamFnContext)!;
    const stream = await wrapped(model(host.baseUrl), context, {
      apiKey: KEY,
      temperature: 0.7,
      maxTokens: 32,
      onPayload(payload) {
        (payload as Record<string, unknown>).tool_choice = "required";
      },
    });
    const events: string[] = [];
    for await (const event of stream) events.push(event.type);
    const result = await stream.result();
    assert.equal(result.stopReason, "toolUse", result.errorMessage);
    assert.deepEqual(
      result.content
        .filter((piece) => piece.type === "toolCall")
        .map((piece) => piece.arguments),
      [{ key: "hello" }],
    );
    assert.ok(events.includes("toolcall_delta"));
    assert.equal(requests[0].tool_choice, "auto");
    assert.equal(requests[0].temperature, 0.7);
    assert.ok(JSON.stringify(requests[0].messages).includes("Use the tool"));
    const replacementStream = await wrapped(model(host.baseUrl), context, {
      apiKey: KEY,
      async onPayload(payload) {
        return {
          ...(payload as Record<string, unknown>),
          tool_choice: { type: "function", function: { name: "lookup" } },
        };
      },
    });
    assert.equal((await replacementStream.result()).stopReason, "toolUse");
    assert.equal(requests[1].tool_choice, "auto");
    assert.deepEqual(requests[1].messages, requests[0].messages);
    assert.throws(
      () => wrapped(model("http://example.com/v1"), context, { apiKey: KEY }),
      /loopback/,
    );
  } finally {
    await host.close();
  }
});

test("actual stream cancellation closes the HTTP request and the next request still completes", async () => {
  let calls = 0;
  let closed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const host = await fixture((req, res) => {
    calls++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      'data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n',
    );
    if (calls === 1) res.on("close", closed);
    else
      res.end(
        'data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
  });
  try {
    const runtime = createLlmRuntime();
    registerBuiltInApiProviders(runtime.registry);
    const wrapped = createProvider({ pluginConfig: {} }).wrapStreamFn!({
      provider: "tensorfold",
      modelId: "example/model",
      streamFn: runtime.streamSimple,
    } as ProviderWrapStreamFnContext)!;
    const abort = new AbortController();
    const stream = await wrapped(model(host.baseUrl), context, {
      apiKey: KEY,
      signal: abort.signal,
    });
    for await (const event of stream)
      if (event.type === "text_delta") abort.abort();
    assert.equal((await stream.result()).stopReason, "aborted");
    await Promise.race([
      closedPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Request not cancelled")),
          2000,
        ).unref(),
      ),
    ]);
    const next = await wrapped(model(host.baseUrl), context, { apiKey: KEY });
    assert.equal((await next.result()).stopReason, "stop");
  } finally {
    await host.close();
  }
});
