import { createServer } from "node:http";
import { invokeXeroMethod } from "./invoke";

export const PROXY_HOST = "0.0.0.0";
export const PROXY_PORT = 8765;

export async function startProxyServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;

      if (request.method === "GET" && path === "/healthz") {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("ok\n");
        return;
      }

      if (request.method === "POST" && path === "/v1/invoke") {
        let raw = "";
        request.setEncoding("utf8");
        for await (const chunk of request) {
          raw += chunk;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Invalid JSON payload." }));
          return;
        }

        if (!payload || typeof payload !== "object") {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Payload must be object." }));
          return;
        }

        const value = payload as {
          api?: unknown;
          method?: unknown;
          tenantId?: unknown;
          rawParams?: unknown;
        };

        if (typeof value.api !== "string" || typeof value.method !== "string") {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Payload requires string api and method." }));
          return;
        }

        const rawParams =
          Array.isArray(value.rawParams) &&
          value.rawParams.every((item) => typeof item === "string")
            ? value.rawParams
            : undefined;

        try {
          const result = await invokeXeroMethod(
            {
              api: value.api,
              method: value.method,
              tenantId: typeof value.tenantId === "string" ? value.tenantId : undefined,
              rawParams,
            },
            env,
          );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(result));
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: message }));
          return;
        }
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found." }));
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: message }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROXY_PORT, PROXY_HOST, () => resolve());
  });

  console.log(`Proxy is running on http://${PROXY_HOST}:${PROXY_PORT}`);
}
