# Release qualification

Status: **unqualified development preview**. Automated fixtures are not real-agent or hardware receipts. Do not publish a registry release until both platform columns below have evidence.

Record the plugin commit, TensorFold commit/release, OpenClaw version, Node version, OS, hardware/RAM, backend, checkpoint ID/revision, launch settings, and context limit for each run. Use the same qualified checkpoint/settings for direct and agent requests. Never attach keys, auth stores, real conversations, or browser tokens.

| Gate                                                                                  | Mac / Metal | GB10 / CUDA |
| ------------------------------------------------------------------------------------- | ----------- | ----------- |
| Fresh OpenClaw profile: packed plugin installation and interactive key login          | Not run     | Not run     |
| `/v1/models` discovery and native picker selection; request uses selected model       | Not run     | Not run     |
| Native Control UI tab loads with the custom-plugin setting enabled                    | Not run     | Not run     |
| Ordinary streamed answer through the real agent                                       | Not run     | Not run     |
| Streamed tool call: split arguments assemble, tool runs, follow-up completes          | Not run     | Not run     |
| Required/named choice falls back to auto without grammar support; none/auto preserved | Not run     | Not run     |
| Stop generation mid-stream; next request completes with clean state                   | Not run     | Not run     |
| Long context at a supported, recorded model limit                                     | Not run     | Not run     |
| Server absent, unhealthy, restarted; UI and model calls recover                       | Not run     | Not run     |
| Wrong, insufficient-scope, and rotated key: actionable failure, no leakage            | Not run     | Not run     |
| `/stats` disabled: partial dashboard; enabled: values match direct observations       | Not run     | Not run     |
| `/memory`, model ID, health, token rates, running/waiting agree with direct endpoints | Not run     | Not run     |
| Read-only operator can inspect but cannot start a chat                                | Not run     | Not run     |
| Existing chat/default selection unaffected by starting a new dashboard chat           | Not run     | Not run     |

## Reproducible runs

1. Create an isolated OpenClaw profile using `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`; do not reuse personal conversations or provider credentials. Install the actual `npm pack` tarball.
2. Start TensorFold on `127.0.0.1` with an `inference,read` key and `--dashboard`. Keep the engine log and a sanitized launch command.
3. Follow the README's login, catalog refresh, native UI, and model-selection instructions exactly. Record the selected `tensorfold/<id>` and an engine request proving it was used.
4. Ask for a harmless tool action such as listing files in an empty test directory. Record the assistant tool-call ID/name/arguments, execution result, and subsequent answer. Test native tool-choice opt-in only on an engine that supports it.
5. Cancel a long answer, then send a short fresh request. Verify that cancellation stops the engine request and the next response succeeds.
6. Send a synthetic public long-context prompt within the reported context window; record token counts, settings, outcome, and any admission failure. Do not substitute a small fixture for this gate.
7. Compare dashboard values with authenticated `/stats` and `/memory` observations while idle and streaming. Record timestamps and tolerate changes between reads; compare stable counters at rest. Missing fields must remain unavailable.
8. Stop/restart the engine, disable/re-enable stats, and rotate the key. Check recovery and inspect the browser network responses/logs for leaked credentials. Use a read-only Gateway session for the permissions gate.

## Before publication

- [ ] All gates have receipts on both platforms, with failures/skips explained and resolved.
- [ ] `npm ci --ignore-scripts`, `npm run check`, and `npm run format:check` pass on supported CI hosts.
- [ ] Packed artifacts load in a fresh supported OpenClaw installation without the source checkout or development dependencies.
- [ ] Maintainers agree on repository/package naming and the TensorFold integration documentation.
- [ ] README qualification status accurately reflects receipts; no engine/model capability is inferred from fixture tests.
- [ ] Remove `private` only for the deliberately approved release; publish through the agent ecosystem and record the registry URL.

Hermes is outside this repository and remains a separate requirement of TensorFold #1399. Completing these gates does not close that entire issue.
