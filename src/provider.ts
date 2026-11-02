import type {
  ProviderPlugin,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth";
import { createPayloadPatchStreamWrapper } from "openclaw/plugin-sdk/provider-stream-shared";
import { TensorFoldClient } from "./client.js";
import { localBaseUrl, readConfig } from "./config.js";
import { isObject } from "./contracts.js";

export function patchToolChoice(
  payload: Record<string, unknown>,
  native: boolean,
): void {
  if (
    !native &&
    (payload.tool_choice === "required" || isObject(payload.tool_choice))
  )
    payload.tool_choice = "auto";
}

export function createProvider(
  api: Pick<OpenClawPluginApi, "pluginConfig">,
): ProviderPlugin {
  return {
    id: "tensorfold",
    label: "TensorFold",
    envVars: ["TENSORFOLD_API_KEY"],
    auth: [
      createProviderApiKeyAuthMethod({
        providerId: "tensorfold",
        methodId: "api-key",
        label: "TensorFold server API key",
        optionKey: "tensorfoldApiKey",
        flagName: "--tensorfold-api-key",
        envVar: "TENSORFOLD_API_KEY",
        promptMessage: "Enter the API key for your local TensorFold server",
      }),
    ],
    catalog: {
      order: "late",
      async run(ctx) {
        const config = readConfig(
          api.pluginConfig,
          ctx.config.models?.providers?.tensorfold?.baseUrl,
        );
        const auth = ctx.resolveProviderApiKey("tensorfold");
        // apiKey can be an environment/profile marker; discovery needs the resolved secret.
        const key = auth.discoveryApiKey ?? auth.apiKey;
        if (!key) return null;
        const models = await new TensorFoldClient(config, key).models(
          ctx.signal,
        );
        return {
          provider: {
            api: "openai-completions",
            baseUrl: config.baseUrl,
            authHeader: true,
            apiKey: auth.apiKey,
            models: models.map((model) => ({
              id: model.id,
              name: model.id,
              reasoning: model.reasoning,
              input: ["text"],
              contextWindow: model.contextWindow,
              maxTokens: Math.min(4096, model.contextWindow),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            })),
          },
        };
      },
    },
    normalizeResolvedModel({ model }) {
      return {
        ...model,
        api: "openai-completions",
        baseUrl: localBaseUrl(
          model.baseUrl ?? readConfig(api.pluginConfig).baseUrl,
        ),
      };
    },
    wrapStreamFn(ctx) {
      const native = readConfig(api.pluginConfig).nativeToolChoice;
      const wrapped = createPayloadPatchStreamWrapper(
        ctx.streamFn,
        ({ payload }) => patchToolChoice(payload, native),
      );
      return (model, context, options) => {
        localBaseUrl(model.baseUrl);
        const original = options?.onPayload;
        if (!original) return wrapped(model, context, options);
        return wrapped(model, context, {
          ...options,
          // The SDK patches before onPayload. A caller can replace the payload,
          // so enforce the fallback again on the final object sent to the server.
          async onPayload(payload, sentModel) {
            const replacement = await original(payload, sentModel);
            const outgoing = replacement ?? payload;
            if (isObject(outgoing)) patchToolChoice(outgoing, native);
            return replacement;
          },
        });
      };
    },
  };
}
