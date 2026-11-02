export type JsonObject = Record<string, unknown>;
export type ModelRow = {
  id: string;
  contextWindow: number;
  reasoning: boolean;
};
export type Telemetry = {
  observedAt: string;
  baseUrl: string;
  models: ModelRow[];
  health: { state: "ok" | "unavailable"; message?: string };
  stats: {
    available: boolean;
    values: Record<string, number>;
    message?: string;
  };
  memory: {
    available: boolean;
    values: Record<string, number>;
    message?: string;
  };
};
export const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
