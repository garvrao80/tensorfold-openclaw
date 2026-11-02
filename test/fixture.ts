import http from "node:http";
import { once } from "node:events";
export const KEY = "tf-test-credential-7eb2f1";
export async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback listener");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export function json(
  response: http.ServerResponse,
  body: unknown,
  status = 200,
) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
export const catalog = {
  data: [
    {
      id: "example/model",
      context_length: 32768,
      reasoning: { default_enabled: true },
    },
    { id: "plain" },
  ],
};
