import { test } from "node:test";
import assert from "node:assert/strict";
import { TensorFoldClient } from "../src/client.js";
import { localBaseUrl, readConfig } from "../src/config.js";
import { fixture, json, KEY, catalog } from "./fixture.js";

test("loopback-only URLs are canonicalized; remote, credentialed, and ambiguous routes are refused", () => {
  assert.equal(
    localBaseUrl("http://localhost:8080/"),
    "http://127.0.0.1:8080/v1",
  );
  assert.equal(localBaseUrl("http://[::1]:8080/v1/"), "http://[::1]:8080/v1");
  for (const url of [
    "https://127.0.0.1",
    "http://example.com",
    "http://127.0.0.1.evil",
    "file:///etc/passwd",
    "http://user:secret@127.0.0.1",
    "http://127.0.0.1/v1?token=secret",
    "http://127.0.0.1/#x",
    "http://127.0.0.1/evil",
  ])
    assert.throws(() => localBaseUrl(url));
  for (const config of [
    { timeoutMs: NaN },
    { timeoutMs: 0 },
    { fallbackContextWindow: -1 },
    { apiKey: KEY },
    { nativeToolChoice: "yes" },
  ])
    assert.throws(() => readConfig(config));
  for (const key of ["", "x\nInjected: yes", "non-ascii-ñ"])
    assert.throws(() => new TensorFoldClient(readConfig({}), key));
});

test("discovery uses actual context metadata, authenticated paths, deduplication, and fallback only when missing", async () => {
  const seen: string[] = [];
  const host = await fixture((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    seen.push(req.url!);
    json(res, { data: [...catalog.data, catalog.data[0]] });
  });
  try {
    const models = await new TensorFoldClient(
      readConfig({ baseUrl: host.baseUrl }),
      KEY,
    ).models();
    assert.deepEqual(models, [
      { id: "example/model", contextWindow: 32768, reasoning: true },
      { id: "plain", contextWindow: 8192, reasoning: false },
    ]);
    assert.deepEqual(seen, ["/v1/models"]);
  } finally {
    await host.close();
  }
});

test("telemetry reads all four endpoints and keeps unknown metrics absent, zero present, and response secrets private", async () => {
  const host = await fixture((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    const data =
      req.url === "/v1/models"
        ? catalog
        : req.url === "/health"
          ? { status: "ok", key: KEY }
          : req.url === "/stats"
            ? {
                running: 0,
                waiting: 2,
                decode_tokens_per_second: 15.5,
                private_prompt: KEY,
              }
            : {
                device: { active_bytes: 1024, cache_bytes: 0, key: KEY },
                process: { physical_footprint_bytes: 512 },
              };
    json(res, data);
  });
  try {
    const result = await new TensorFoldClient(
      readConfig({ baseUrl: host.baseUrl }),
      KEY,
    ).snapshot();
    assert.equal(result.stats.values.running, 0);
    assert.equal(result.stats.values.waiting, 2);
    assert.equal(result.memory.values["device.cache_bytes"], 0);
    assert.equal(result.stats.values.prefill_tokens_per_second, undefined);
    assert.ok(!JSON.stringify(result).includes(KEY));
  } finally {
    await host.close();
  }
});

test("disabled stats remains an actionable partial result and recovery needs no restart", async () => {
  let disabled = true;
  const host = await fixture((req, res) =>
    req.url === "/v1/models"
      ? json(res, catalog)
      : req.url === "/stats" && disabled
        ? json(res, {}, 404)
        : json(res, { status: "ok", running: 1 }),
  );
  try {
    const client = new TensorFoldClient(
      readConfig({ baseUrl: host.baseUrl }),
      KEY,
    );
    const first = await client.snapshot();
    assert.equal(first.stats.available, false);
    assert.match(first.stats.message!, /--dashboard/);
    disabled = false;
    assert.equal((await client.snapshot()).stats.values.running, 1);
  } finally {
    await host.close();
  }
});

test("HTTP failures never echo upstream messages or credentials, and redirects never receive the key", async () => {
  let visits = 0;
  const remote = await fixture((_req, res) => {
    visits++;
    json(res, {});
  });
  for (const code of [401, 403, 500, 302]) {
    const host = await fixture((_req, res) => {
      res.writeHead(code, {
        location: remote.baseUrl,
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ error: KEY }));
    });
    try {
      await assert.rejects(
        new TensorFoldClient(
          readConfig({ baseUrl: host.baseUrl }),
          KEY,
        ).models(),
        (error) => !String(error).includes(KEY),
      );
    } finally {
      await host.close();
    }
  }
  assert.equal(visits, 0);
  await remote.close();
});

test("invalid catalogs and oversized/non-JSON responses are refused", async () => {
  for (const data of [
    [],
    { data: "bad" },
    { data: [{ id: "x\nspoof" }] },
    { data: [{ id: "" }] },
  ]) {
    const host = await fixture((_req, res) => json(res, data));
    try {
      await assert.rejects(
        new TensorFoldClient(
          readConfig({ baseUrl: host.baseUrl }),
          KEY,
        ).models(),
      );
    } finally {
      await host.close();
    }
  }
  const host = await fixture((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end('"' + "x".repeat(1024 * 1024 + 1) + '"');
  });
  try {
    await assert.rejects(
      new TensorFoldClient(readConfig({ baseUrl: host.baseUrl }), KEY).models(),
      /1 MiB/,
    );
  } finally {
    await host.close();
  }
});

test("deadlines and caller cancellation release stalled requests", async () => {
  const host = await fixture(() => {});
  try {
    const client = new TensorFoldClient(
      readConfig({ baseUrl: host.baseUrl, timeoutMs: 100 }),
      KEY,
    );
    await assert.rejects(client.models(), /timed out/);
    const controller = new AbortController();
    const pending = client.models(controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    await host.close();
  }
});
