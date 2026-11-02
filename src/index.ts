import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { TensorFoldClient } from "./client.js";
import { readConfig } from "./config.js";
import { createProvider } from "./provider.js";

export default definePluginEntry({
  id: "tensorfold",
  name: "TensorFold",
  description: "Local models and native server telemetry",
  register(api) {
    readConfig(api.pluginConfig);
    api.registerProvider(createProvider(api));
    api.registerGatewayMethod(
      "tensorfold.snapshot",
      async ({ respond }) => {
        try {
          const config = api.runtime.config.current();
          const options = readConfig(
            api.pluginConfig,
            config.models?.providers?.tensorfold?.baseUrl,
          );
          const auth = await api.runtime.modelAuth.resolveApiKeyForProvider({
            provider: "tensorfold",
          });
          const snapshot = await new TensorFoldClient(
            options,
            auth.apiKey ?? "",
          ).snapshot();
          respond(true, snapshot);
        } catch {
          respond(false, undefined, {
            code: "UNAVAILABLE",
            message:
              "Cannot read TensorFold. Check the loopback endpoint, provider API key, and server status. No credentials are shown here.",
          });
        }
      },
      { scope: "operator.read" },
    );
    api.session.controls.registerControlUiDescriptor({
      surface: "tab",
      id: "tensorfold",
      label: "TensorFold",
      icon: "cpu",
      group: "control",
      requiredScopes: ["operator.read"],
    });
  },
});
