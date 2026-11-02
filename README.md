# TensorFold for OpenClaw

Use a local [TensorFold](https://github.com/ashhart/TensorFold) server from OpenClaw's model picker and see its measurements in a native Control UI page.

**Development preview — not platform-qualified or published to a plugin registry.** This implements the OpenClaw portion of [TensorFold #1399](https://github.com/ashhart/TensorFold/issues/1399). Hermes is separate work. Real-agent Mac and GB10 runs are required before release; see [the release checklist](docs/release-checklist.md).

## What it does

- Discovers model IDs and context lengths from authenticated `/v1/models`.
- Uses OpenClaw's provider authentication and native OpenAI chat-completions transport, including streaming, tool-call assembly, and cancellation.
- Adds a TensorFold Control UI tab with a model picker, health, active/queued requests, token rates/counts, and reported memory values.
- Starts a **new** chat with the selected model. Existing chats and global defaults keep their selections.
- Reads telemetry through an authenticated, `operator.read` Gateway method. The browser receives selected measurements, never the TensorFold API key.

The plugin changes no engine code or returned tokens. It does not start a server, load checkpoints, infer vision support from names, or claim model/backend qualification.

## Requirements

- OpenClaw **2026.10.9**. Its plugin APIs are experimental; this preview pins the version tested.
- A supported OpenClaw Node version: 24.22.1 or later in the 24.x line, or 26.12.1 or later.
- TensorFold serving an already-qualified checkpoint on loopback, with an API key. The Gateway and TensorFold must share the same host/network namespace.
- For statistics, start TensorFold with `--dashboard`. Without it, inference and the other telemetry remain available.

## Install from source

With the required OpenClaw version installed:

```sh
git clone https://github.com/garvrao80/tensorfold-openclaw.git
cd tensorfold-openclaw
npm ci --ignore-scripts
npm run check
npm pack
openclaw plugins install npm-pack:./garvrao80-tensorfold-openclaw-0.1.0.tgz --force --accept-capabilities
openclaw plugins enable tensorfold
```

Review the source and capabilities before running the install command: `--force` acknowledges OpenClaw's warning for a local archive outside its reviewed registry; `--accept-capabilities` records consent for the provider, Gateway method, and native UI. The native UI runs in OpenClaw's Control UI origin. Restart the Gateway after installation. Keep `tensorfold` in your existing `plugins.allow` list if you use one.

`npm pack` includes the built backend and browser assets. Development dependencies and tests stay outside the package. The package remains `private` to prevent an accidental npm release before qualification.

## Connect your server

Start TensorFold with your checkpoint and a restricted-permission key file, for example:

```sh
tensorfold serve /path/to/checkpoint --host 127.0.0.1 --port 8080 --api-key-file /path/to/server.keys --dashboard
```

Follow [TensorFold's key-file instructions](https://github.com/ashhart/TensorFold/blob/main/docs/api.md#key-scopes). A scoped plugin key needs both `inference` and `read`; store the same key using OpenClaw's interactive login, without putting it on the command line:

```sh
openclaw models auth login --provider tensorfold --method api-key
```

OpenClaw's `TENSORFOLD_API_KEY` environment credential is also supported. For a running Gateway, set it in that process's environment. Do not put keys in plugin configuration or browser code.

The default server URL is `http://127.0.0.1:8080/v1`. For a different loopback port, merge this into your OpenClaw configuration:

```json
{
  "plugins": {
    "entries": {
      "tensorfold": {
        "enabled": true,
        "config": { "baseUrl": "http://127.0.0.1:8081/v1" }
      }
    }
  }
}
```

An existing `models.providers.tensorfold.baseUrl` takes precedence so inference, discovery, and telemetry use the same endpoint. Only HTTP on `127.0.0.1`, `localhost`, or `[::1]` is accepted. `localhost` is normalized to `127.0.0.1`. Credentials, query strings, custom paths, and redirects are refused for discovery/telemetry.

Refresh the catalog after login or a server model change:

```sh
openclaw models list --refresh --all --provider tensorfold --json
```

Choose `tensorfold/<served-model-id>` in OpenClaw's model picker. If you maintain an OpenClaw model allowlist, permit the discovered model there too; the plugin does not rewrite that policy.

## Open the dashboard

Open the Control UI served by this Gateway using its browser-trusted loopback URL or HTTPS. In **Settings → Labs**, enable **Custom plugin UI**, then open **TensorFold** in the sidebar. The equivalent setting is:

```json
{
  "gateway": {
    "controlUi": { "experimental": { "customPlugins": true } }
  }
}
```

The page refreshes every five seconds while visible and connected. **Refresh** retries immediately. Read-only operators can inspect measurements; starting a chat also requires write access.

Measurements are observations from separate server endpoints, not one atomic snapshot. A real zero is shown as zero; missing fields are **Unavailable**. `/stats` returning 404 explains how to enable `--dashboard`. Memory availability depends on the server/backend. Authenticated `/health` reports liveness, not a loaded checkpoint; the model list comes from `/v1/models`.

## Tool compatibility

TensorFold does not currently expose a per-model grammar-support flag in `/v1/models`. This preview therefore defaults to conservative compatibility: required and named tool choices become `tool_choice: "auto"`. `auto`, `none`, tools, prompts, sampling settings, and streamed arguments are preserved. Automatic choice may produce a text response instead of forcing a tool.

Only after verifying native required/named tool choice on your engine, set `plugins.entries.tensorfold.config.nativeToolChoice` to `true` to preserve those choices. This is an explicit operator setting, not capability detection.

| Setting                 | Default                    | Meaning                                                              |
| ----------------------- | -------------------------- | -------------------------------------------------------------------- |
| `baseUrl`               | `http://127.0.0.1:8080/v1` | Loopback TensorFold endpoint                                         |
| `timeoutMs`             | `5000`                     | Discovery/telemetry deadline, 100–30000 ms; does not cap generation  |
| `fallbackContextWindow` | `8192`                     | Used only when model context metadata is absent, 1024–1048576 tokens |
| `nativeToolChoice`      | `false`                    | Preserve forced/named tool choice after operator verification        |

## Troubleshooting

| Symptom                         | Check                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| No models                       | Server is running; log in; run the catalog command with `--refresh`; check the model allowlist.                            |
| Dashboard unavailable           | Plugin enabled, Custom plugin UI enabled, same Gateway origin, browser-trusted loopback/HTTPS, and `operator.read` access. |
| API key rejected                | OpenClaw credential matches the engine key and has `inference,read` scope.                                                 |
| Stats unavailable               | Start TensorFold with `--dashboard`; refresh after restart.                                                                |
| Server restarted or key rotated | Refresh after updating OpenClaw's credential. Keys are resolved per telemetry request.                                     |
| Remote/container engine         | Run the Gateway alongside the engine or arrange a local loopback forward; the plugin does not allow a public engine URL.   |

## Development and validation

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
```

Tests use actual loopback HTTP/SSE fixtures, the pinned OpenClaw streaming runtime, its real CLI loader/catalog discovery, and DOM-backed UI tests. They cover authentication, partial telemetry, redirects, deadlines, recovery, tool payloads, cancellation, safe rendering, permissions, and page disposal. They download no checkpoints and prove no hardware inference behavior. CI runs the same checks on Ubuntu and Windows.

The pinned SDK ships the stream-patch helper's JavaScript without its declaration. `src/sdk-compat.d.ts` supplies a narrow declaration using the SDK's own stream types; integration tests exercise the real helper. Review this shim when changing the host version.

Apache-2.0. This is a community integration, not an official TensorFold or OpenClaw release.
