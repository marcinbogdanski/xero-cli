import { createServer } from "node:http";
import { resolveAuthStatus } from "./auth";
import { createAuthenticatedClient } from "./client";
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

      if (request.method === "POST" && path === "/v1/doctor") {
        try {
          const status = resolveAuthStatus(env);
          const client = await createAuthenticatedClient(env);
          const token = client.readTokenSet();
          const connections = await client.updateTenants(false);
          const connectionsCount = Array.isArray(connections)
            ? connections.length
            : 0;
          const tokenExpiresAt =
            typeof token.expires_at === "number"
              ? new Date(token.expires_at * 1000).toISOString()
              : null;
          const scope =
            Array.isArray(token.scope)
              ? token.scope.join(" ")
              : (token.scope ?? null);

          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              mode: status.authMode ?? "unknown",
              credentialSource: status.credentialSource ?? "unknown",
              tokenType: token.token_type ?? "unknown",
              tokenExpiresAt: tokenExpiresAt ?? "unknown",
              scope: scope ?? "unknown",
              connections: connectionsCount,
            }),
          );
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: message }));
          return;
        }
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
          uploadedFiles?: unknown;
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
        let uploadedFiles: Record<string, string> | undefined;
        if (value.uploadedFiles !== undefined) {
          if (
            typeof value.uploadedFiles !== "object" ||
            value.uploadedFiles === null ||
            Array.isArray(value.uploadedFiles)
          ) {
            response.writeHead(400, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "Payload uploadedFiles must be object." }));
            return;
          }

          uploadedFiles = {};
          for (const [name, file] of Object.entries(value.uploadedFiles)) {
            if (typeof file !== "string") {
              response.writeHead(400, { "Content-Type": "application/json" });
              response.end(JSON.stringify({ error: `Payload uploadedFiles.${name} must be string.` }));
              return;
            }
            uploadedFiles[name] = file;
          }
        }

        try {
          const result = await invokeXeroMethod(
            {
              api: value.api,
              method: value.method,
              tenantId: typeof value.tenantId === "string" ? value.tenantId : undefined,
              rawParams,
              uploadedFiles,
              auditMode: "proxy_server",
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
