import { isObject } from "./contracts.js";

export type Config = {
  baseUrl: string;
  timeoutMs: number;
  fallbackContextWindow: number;
  nativeToolChoice: boolean;
};

export function localBaseUrl(
  value: unknown = "http://127.0.0.1:8080/v1",
): string {
  if (typeof value !== "string")
    throw new Error(
      "TensorFold baseUrl must be a loopback HTTP URL ending in /v1.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TensorFold baseUrl is not a valid URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/v1", "/v1/"].includes(url.pathname)
  ) {
    throw new Error(
      "TensorFold requires a loopback HTTP endpoint without credentials, query, or custom path.",
    );
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  url.pathname = "/v1";
  return url.href;
}

export function readConfig(input: unknown, providerBaseUrl?: unknown): Config {
  const raw = isObject(input) ? input : {};
  for (const key of Object.keys(raw)) {
    if (
      ![
        "baseUrl",
        "timeoutMs",
        "fallbackContextWindow",
        "nativeToolChoice",
      ].includes(key)
    )
      throw new Error("Unknown TensorFold plugin configuration field.");
  }
  const integer = (
    key: string,
    fallback: number,
    low: number,
    high: number,
  ): number => {
    const value = raw[key] ?? fallback;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < low ||
      value > high
    )
      throw new Error(
        `TensorFold ${key} must be an integer between ${low} and ${high}.`,
      );
    return value;
  };
  if (
    raw.nativeToolChoice !== undefined &&
    typeof raw.nativeToolChoice !== "boolean"
  )
    throw new Error("TensorFold nativeToolChoice must be boolean.");
  return {
    baseUrl: localBaseUrl(providerBaseUrl ?? raw.baseUrl),
    timeoutMs: integer("timeoutMs", 5000, 100, 30000),
    fallbackContextWindow: integer(
      "fallbackContextWindow",
      8192,
      1024,
      1048576,
    ),
    nativeToolChoice: raw.nativeToolChoice === true,
  };
}
