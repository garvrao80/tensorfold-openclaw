# Development validation

Initial local validation on 2026-11-02: Windows x64, Node 24.22.1, OpenClaw and `@openclaw/ai` 2026.10.9. TensorFold HTTP contracts were checked against main at `088cfbd35`; no engine was run.

| Check                                                                                               | Result                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Strict TypeScript check                                                                             | Pass                                            |
| Backend and browser bundles                                                                         | Pass                                            |
| Automated tests                                                                                     | 15 pass, 0 fail, 0 skip                         |
| Formatting                                                                                          | Pass                                            |
| Packed plugin installed with the real OpenClaw `npm-pack:` installer in an isolated state directory | Pass                                            |
| Installed plugin listed by real OpenClaw                                                            | `loaded`, provider `tensorfold`, no diagnostics |
| Real host discovery with environment credential and SDK-written auth-store credential               | Pass, authenticated loopback HTTP fixture       |
| Real OpenClaw streaming/tool assembly/cancellation                                                  | Pass, HTTP/SSE fixtures                         |
| Native dashboard rendering/selection/permissions/disposal                                           | Pass, DOM-backed host fixture                   |
| Real Gateway/browser session with TensorFold inference                                              | Not run                                         |
| Mac/Metal and GB10/CUDA qualification                                                               | Not run                                         |

Reproduce the automated checks with the pinned runtime and `npm ci --ignore-scripts && npm run check && npm run format:check`. Follow the README installation commands with a disposable `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` to repeat the packed-install check.

Fixtures test the integration boundary; they do not establish checkpoint behavior, real-agent tool execution, long-context capacity, or token equivalence on either platform. Those are tracked separately in [release qualification](release-checklist.md). CI runs are attached to their exact commits in the repository's Actions tab.
