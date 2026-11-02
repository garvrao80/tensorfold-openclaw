import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fixture, json, catalog, KEY } from "./fixture.js";

test(
  "the pinned real OpenClaw host loads the built plugin and discovers authenticated models",
  { timeout: 60_000 },
  async () => {
    const state = await mkdtemp(join(tmpdir(), "tensorfold-openclaw-"));
    let discoveries = 0;
    const server = await fixture((req, res) => {
      assert.equal(req.url, "/v1/models");
      assert.equal(req.headers.authorization, `Bearer ${KEY}`);
      discoveries++;
      json(res, catalog);
    });
    try {
      // Keep the consumer plugin outside the host package's ancestor directory.
      const packaged = join(state, "plugin");
      await mkdir(packaged);
      for (const file of [
        "dist",
        "package.json",
        "openclaw.plugin.json",
        "README.md",
        "LICENSE",
      ]) {
        await cp(resolve(file), join(packaged, file), { recursive: true });
      }
      const config = join(state, "openclaw.json");
      await writeFile(
        config,
        JSON.stringify({
          plugins: {
            allow: ["tensorfold"],
            load: { paths: [packaged] },
            entries: {
              tensorfold: {
                enabled: true,
                config: { baseUrl: server.baseUrl },
              },
            },
          },
        }),
      );
      const run = async (args: string[], environmentKey = true) => {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          OPENCLAW_STATE_DIR: state,
          OPENCLAW_CONFIG_PATH: config,
          NO_COLOR: "1",
        };
        delete env.TENSORFOLD_API_KEY;
        if (environmentKey) env.TENSORFOLD_API_KEY = KEY;
        const result = await promisify(execFile)(
          process.execPath,
          [resolve("node_modules/openclaw/openclaw.mjs"), ...args],
          {
            env,
            timeout: 45_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        assert.ok(!result.stdout.includes(KEY));
        return JSON.parse(result.stdout);
      };
      const inventory = await run(["plugins", "list", "--json"]);
      const plugin = inventory.plugins.find(
        (row: { id: string }) => row.id === "tensorfold",
      );
      assert.equal(plugin?.status, "loaded");
      assert.deepEqual(plugin.providerIds, ["tensorfold"]);
      assert.deepEqual(inventory.diagnostics, []);
      const models = await run([
        "models",
        "list",
        "--refresh",
        "--all",
        "--provider",
        "tensorfold",
        "--json",
      ]);
      assert.ok(discoveries > 0, "Host must contact /v1/models");
      assert.ok(JSON.stringify(models).includes("tensorfold/example/model"));
      const agent = join(state, "agents", "main", "agent");
      await mkdir(agent, { recursive: true });
      // A child owns the SDK's SQLite connections so Windows can remove the fixture afterward.
      await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import { upsertAuthProfileWithLock } from "openclaw/plugin-sdk/provider-auth";
        const saved = await upsertAuthProfileWithLock({
          profileId: "tensorfold:default",
          credential: { type: "api_key", provider: "tensorfold", key: process.env.TENSORFOLD_API_KEY },
          agentDir: process.env.OPENCLAW_AGENT_DIR, stateDir: process.env.OPENCLAW_STATE_DIR,
        });
        if (!saved) throw new Error("Could not write fixture credential");
      `,
        ],
        {
          env: {
            ...process.env,
            OPENCLAW_STATE_DIR: state,
            OPENCLAW_CONFIG_PATH: config,
            OPENCLAW_AGENT_DIR: agent,
            TENSORFOLD_API_KEY: KEY,
          },
          timeout: 30_000,
        },
      );
      const before = discoveries;
      const storedModels = await run(
        [
          "models",
          "list",
          "--refresh",
          "--all",
          "--provider",
          "tensorfold",
          "--json",
        ],
        false,
      );
      assert.ok(
        discoveries > before,
        "Host must resolve the stored credential without an environment key",
      );
      assert.ok(
        JSON.stringify(storedModels).includes("tensorfold/example/model"),
      );
    } finally {
      await server.close();
      await rm(state, { recursive: true, force: true });
    }
  },
);
