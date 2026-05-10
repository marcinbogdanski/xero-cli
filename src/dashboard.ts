import {
  existsSync,
  readFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

export const DASHBOARD_HOST = "127.0.0.1";
export const DASHBOARD_PORT = 8766;

const MAX_AUDIT_EVENTS = 100;

interface AuditEvent {
  ts?: unknown;
  operation?: unknown;
  mode?: unknown;
  api?: unknown;
  method?: unknown;
  tenantId?: unknown;
  rawParamCount?: unknown;
  uploadedFileCount?: unknown;
  policy?: unknown;
  status?: unknown;
  durationMs?: unknown;
  responseStatus?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveConfigHome(env: NodeJS.ProcessEnv): string | undefined {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    return xdg;
  }

  const home = env.HOME?.trim();
  if (!home) {
    return undefined;
  }

  return path.join(home, ".config");
}

function resolveAuditLogPath(env: NodeJS.ProcessEnv): string | undefined {
  const fromEnv = env.XERO_AUDIT_LOG_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const configHome = resolveConfigHome(env);
  if (!configHome) {
    return undefined;
  }

  return path.join(configHome, "xero-cli", "audit.jsonl");
}

function loadAuditEvents(env: NodeJS.ProcessEnv): {
  auditPath?: string;
  events: AuditEvent[];
  malformedCount: number;
} {
  const auditPath = resolveAuditLogPath(env);
  if (!auditPath || !existsSync(auditPath)) {
    return { auditPath, events: [], malformedCount: 0 };
  }

  const lines = readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-MAX_AUDIT_EVENTS);

  const events: AuditEvent[] = [];
  let malformedCount = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        events.push(parsed as AuditEvent);
      } else {
        malformedCount += 1;
      }
    } catch {
      malformedCount += 1;
    }
  }

  events.sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
  return { auditPath, events, malformedCount };
}

function isReadMethod(method: unknown): boolean {
  return String(method ?? "").startsWith("get");
}

function formatTs(value: unknown): string {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    return String(value ?? "unknown time");
  }
  return date.toLocaleString();
}

function renderSummaryCard(label: string, value: number | string): string {
  return `
        <div class="summary-card">
          <div class="summary-value">${escapeHtml(value)}</div>
          <div class="summary-label">${escapeHtml(label)}</div>
        </div>`;
}

function renderEvent(event: AuditEvent): string {
  const method = String(event.method ?? "unknownMethod");
  const api = String(event.api ?? "unknown");
  const status = String(event.status ?? "unknown");
  const isRead = isReadMethod(method);
  const detailsOpen = isRead ? "" : " open";
  const statusClass = status === "success" ? "success" : "error";
  const kindClass = isRead ? "read" : "write";
  const rawJson = JSON.stringify(event, null, 2);

  return `
        <details class="event ${statusClass} ${kindClass}"${detailsOpen}>
          <summary>
            <span class="method">${escapeHtml(api)}.${escapeHtml(method)}</span>
            <span class="meta">${escapeHtml(formatTs(event.ts))}</span>
            <span class="pill ${statusClass}">${escapeHtml(status)}</span>
          </summary>
          <div class="grid">
            <div>
              <span class="label">Mode</span>
              <span>${escapeHtml(event.mode ?? "unknown")}</span>
            </div>
            <div>
              <span class="label">Policy</span>
              <span>${escapeHtml(event.policy ?? "unknown")}</span>
            </div>
            <div>
              <span class="label">Duration</span>
              <span>${escapeHtml(event.durationMs ?? "unknown")} ms</span>
            </div>
            <div>
              <span class="label">Response</span>
              <span>${escapeHtml(event.responseStatus ?? "-")}</span>
            </div>
            <div>
              <span class="label">Params</span>
              <span>${escapeHtml(event.rawParamCount ?? 0)}</span>
            </div>
            <div>
              <span class="label">Files</span>
              <span>${escapeHtml(event.uploadedFileCount ?? 0)}</span>
            </div>
          </div>
          ${
            event.error
              ? `<pre class="error-text">${escapeHtml(event.error)}</pre>`
              : ""
          }
          <pre>${escapeHtml(rawJson)}</pre>
        </details>`;
}

function renderDashboard(env: NodeJS.ProcessEnv): string {
  const { auditPath, events, malformedCount } = loadAuditEvents(env);
  const errors = events.filter((event) => event.status !== "success").length;
  const reads = events.filter((event) => isReadMethod(event.method)).length;
  const writes = events.length - reads;
  const latest = events[0]?.ts ? formatTs(events[0].ts) : "none";
  const eventHtml = events.length
    ? events.map(renderEvent).join("")
    : `<div class="empty">No audit events found yet.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Xero Audit Dashboard</title>
  <style>
    :root {
      --bg: #f6f5f1;
      --card: #ffffff;
      --ink: #191d21;
      --muted: #69727d;
      --line: #d9dee3;
      --green: #20764d;
      --red: #b13737;
      --blue: #2f628f;
      --amber: #9a6a16;
      --soft-red: #fff3f1;
      --soft-blue: #f0f6fc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 28px;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .summary-card, .event, .empty {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .summary-card {
      padding: 12px;
    }
    .summary-value {
      font-size: 22px;
      font-weight: 700;
    }
    .summary-label, .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .stack {
      display: grid;
      gap: 10px;
    }
    .event {
      overflow: hidden;
    }
    .event.write {
      background: var(--soft-red);
    }
    .event.read {
      background: var(--soft-blue);
    }
    summary {
      cursor: pointer;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 10px;
      padding: 13px 14px;
    }
    .method {
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .pill {
      border-radius: 999px;
      color: white;
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
    }
    .pill.success {
      background: var(--green);
    }
    .pill.error {
      background: var(--red);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      padding: 0 14px 12px;
    }
    .grid div {
      display: grid;
      gap: 2px;
    }
    pre {
      margin: 0 14px 14px;
      padding: 10px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid var(--line);
      border-radius: 6px;
      color: #30363d;
    }
    .error-text {
      color: var(--red);
    }
    .empty {
      padding: 18px;
      color: var(--muted);
    }
    .note {
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 640px) {
      main {
        padding: 16px;
      }
      summary {
        grid-template-columns: minmax(0, 1fr);
      }
      .meta {
        white-space: normal;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Xero Audit Dashboard</h1>
    <p>${escapeHtml(auditPath ?? "Audit path could not be resolved.")}</p>
    <div class="summary">
      ${renderSummaryCard("recent events", events.length)}
      ${renderSummaryCard("reads", reads)}
      ${renderSummaryCard("mutations", writes)}
      ${renderSummaryCard("errors", errors)}
      ${renderSummaryCard("latest", latest)}
    </div>
    <div class="stack">
      ${eventHtml}
    </div>
    ${
      malformedCount
        ? `<p class="note">${escapeHtml(malformedCount)} malformed audit line(s) skipped.</p>`
        : ""
    }
  </main>
</body>
</html>`;
}

export async function startDashboardServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Server> {
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method !== "GET" || requestPath !== "/") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    try {
      const body = renderDashboard(env);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html><body><h1>Dashboard Error</h1><pre>${escapeHtml(message)}</pre></body></html>`,
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => resolve());
  });

  console.log(`Dashboard is running on http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
  return server;
}
