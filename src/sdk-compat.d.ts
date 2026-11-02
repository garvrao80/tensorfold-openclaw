// The pinned package ships this helper's JS, but omits its declaration; use the host's stream types.
declare module "openclaw/plugin-sdk/provider-stream-shared" {
  import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
  type Stream = NonNullable<ProviderWrapStreamFnContext["streamFn"]>;
  export function createPayloadPatchStreamWrapper(
    baseStreamFn: Stream | undefined,
    patch: (params: {
      payload: Record<string, unknown>;
      model: Parameters<Stream>[0];
      context: Parameters<Stream>[1];
      options: Parameters<Stream>[2];
    }) => void,
  ): Stream;
}
