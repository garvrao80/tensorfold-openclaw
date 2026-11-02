import { type Config } from "./config.js";
import {
  isObject,
  type JsonObject,
  type ModelRow,
  type Telemetry,
} from "./contracts.js";

export class TensorFoldError extends Error {
  constructor(
    readonly code: "auth" | "disabled" | "unavailable" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export class TensorFoldClient {
  constructor(
    readonly config: Config,
    private readonly apiKey: string,
  ) {
    if (!apiKey || /[^\x21-\x7e]/.test(apiKey))
      throw new TensorFoldError(
        "auth",
        "Set the TensorFold API key in OpenClaw's provider authentication settings.",
      );
  }

  async get(
    path: "/models" | "/health" | "/stats" | "/memory",
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    const url =
      path === "/models"
        ? this.config.baseUrl + path
        : new URL(path, this.config.baseUrl).href;
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: combined,
        redirect: "manual",
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status))
          throw new TensorFoldError(
            "auth",
            "TensorFold refused this API key or its read scope. Check OpenClaw provider authentication.",
          );
        if (response.status === 404)
          throw new TensorFoldError(
            "disabled",
            path === "/stats"
              ? "Start TensorFold with --dashboard to enable server statistics."
              : "This TensorFold endpoint is unavailable in the running version.",
          );
        throw new TensorFoldError(
          "unavailable",
          "TensorFold is unavailable. Check the local server and retry.",
        );
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json")
      ) {
        await response.body?.cancel();
        throw new TensorFoldError(
          "invalid",
          "TensorFold returned a non-JSON response.",
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new TensorFoldError(
          "invalid",
          "TensorFold returned an empty response.",
        );
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1024 * 1024)
            throw new TensorFoldError(
              "invalid",
              "TensorFold response exceeds the 1 MiB limit.",
            );
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result: unknown = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      if (!isObject(result))
        throw new TensorFoldError(
          "invalid",
          "TensorFold returned an invalid response object.",
        );
      return result;
    } catch (error) {
      if (signal?.aborted)
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (error instanceof TensorFoldError) throw error;
      throw new TensorFoldError(
        "unavailable",
        timeout.aborted
          ? "TensorFold request timed out. Check the server and retry."
          : "Cannot read TensorFold. Check the local server and retry.",
      );
    }
  }

  async models(signal?: AbortSignal): Promise<ModelRow[]> {
    const response = await this.get("/models", signal);
    if (!Array.isArray(response.data) || response.data.length > 256)
      throw new TensorFoldError(
        "invalid",
        "TensorFold returned an invalid model list.",
      );
    const models = new Map<string, ModelRow>();
    for (const row of response.data) {
      if (
        !isObject(row) ||
        typeof row.id !== "string" ||
        !row.id.trim() ||
        row.id.length > 512 ||
        /[\x00-\x1f\x7f]/.test(row.id)
      )
        throw new TensorFoldError(
          "invalid",
          "TensorFold returned an invalid model identifier.",
        );
      const length = row.context_length ?? row.max_model_len;
      const contextWindow =
        typeof length === "number" && Number.isSafeInteger(length) && length > 0
          ? length
          : this.config.fallbackContextWindow;
      models.set(row.id, {
        id: row.id,
        contextWindow,
        reasoning: isObject(row.reasoning),
      });
    }
    return [...models.values()];
  }

  async snapshot(signal?: AbortSignal): Promise<Telemetry> {
    const [models, health, stats, memory] = await Promise.allSettled([
      this.models(signal),
      this.get("/health", signal),
      this.get("/stats", signal),
      this.get("/memory", signal),
    ]);
    if (signal?.aborted) throw signal.reason;
    const message = (error: unknown) =>
      error instanceof TensorFoldError
        ? error.message
        : "TensorFold request failed.";
    if (models.status === "rejected")
      throw new TensorFoldError("unavailable", message(models.reason));
    const numbers = (
      object: JsonObject,
      fields: string[],
    ): Record<string, number> =>
      Object.fromEntries(
        fields.flatMap((key) =>
          typeof object[key] === "number" &&
          Number.isFinite(object[key]) &&
          object[key] >= 0
            ? [[key, object[key]]]
            : [],
        ),
      );
    const memoryValues: Record<string, number> = {};
    if (memory.status === "fulfilled") {
      for (const key of ["device", "process", "prompt_cache_plan"]) {
        const group = memory.value[key];
        if (isObject(group))
          for (const [name, value] of Object.entries(
            numbers(group, [
              "active_bytes",
              "cache_bytes",
              "peak_bytes",
              "load_limit_bytes",
              "physical_footprint_bytes",
              "budget_bytes",
            ]),
          ))
            memoryValues[`${key}.${name}`] = value;
      }
    }
    return {
      observedAt: new Date().toISOString(),
      baseUrl: this.config.baseUrl,
      models: models.value,
      health:
        health.status === "fulfilled" && health.value.status === "ok"
          ? { state: "ok" }
          : {
              state: "unavailable",
              message:
                "TensorFold is unhealthy or draining. Check its startup log.",
            },
      stats:
        stats.status === "fulfilled"
          ? {
              available: true,
              values: numbers(stats.value, [
                "running",
                "waiting",
                "decode_tokens_per_second",
                "prefill_tokens_per_second",
                "prompt_tokens_total",
                "generation_tokens_total",
              ]),
            }
          : { available: false, values: {}, message: message(stats.reason) },
      memory:
        memory.status === "fulfilled"
          ? { available: true, values: memoryValues }
          : { available: false, values: {}, message: message(memory.reason) },
    };
  }
}
