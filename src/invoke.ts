import { XeroClient } from "xero-node";
import { createAuthenticatedClient } from "./client";

type ApiProperty =
  | "accountingApi"
  | "assetApi"
  | "filesApi"
  | "projectApi"
  | "payrollAUApi"
  | "payrollNZApi"
  | "payrollUKApi"
  | "bankFeedsApi"
  | "appStoreApi"
  | "financeApi";

interface ApiMapping {
  alias: string;
  property: ApiProperty;
  requiresTenantId: boolean;
}

const API_MAPPINGS: ApiMapping[] = [
  { alias: "accounting", property: "accountingApi", requiresTenantId: true },
  { alias: "asset", property: "assetApi", requiresTenantId: true },
  { alias: "files", property: "filesApi", requiresTenantId: true },
  { alias: "project", property: "projectApi", requiresTenantId: true },
  { alias: "payroll-au", property: "payrollAUApi", requiresTenantId: true },
  { alias: "payroll-nz", property: "payrollNZApi", requiresTenantId: true },
  { alias: "payroll-uk", property: "payrollUKApi", requiresTenantId: true },
  { alias: "bankfeeds", property: "bankFeedsApi", requiresTenantId: true },
  { alias: "appstore", property: "appStoreApi", requiresTenantId: false },
  { alias: "finance", property: "financeApi", requiresTenantId: true },
];

export interface InvokeInput {
  api: string;
  method: string;
  tenantId?: string;
}

export interface InvokeResult {
  status: number | null;
  body: unknown;
}

function resolveTenantId(
  env: NodeJS.ProcessEnv,
  explicitTenantId?: string,
): string {
  const tenantId = explicitTenantId?.trim() || env.XERO_TENANT_ID_DEFAULT?.trim();
  if (!tenantId) {
    throw new Error(
      "Missing tenant ID. Set --tenant-id or XERO_TENANT_ID_DEFAULT.",
    );
  }
  return tenantId;
}

function resolveApiMapping(input: string): ApiMapping | undefined {
  const normalized = input.trim().toLowerCase();
  return API_MAPPINGS.find(
    (mapping) =>
      mapping.alias === normalized ||
      mapping.property.toLowerCase() === normalized,
  );
}

function toPrintableResult(result: unknown): InvokeResult {
  if (
    result &&
    typeof result === "object" &&
    "response" in result &&
    "body" in result
  ) {
    const value = result as {
      response?: { status?: number; statusCode?: number };
      body: unknown;
    };
    return {
      status: value.response?.status ?? value.response?.statusCode ?? null,
      body: value.body,
    };
  }

  return {
    status: null,
    body: result,
  };
}

export async function invokeXeroMethod(
  input: InvokeInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InvokeResult> {
  const mapping = resolveApiMapping(input.api);
  if (!mapping) {
    throw new Error(`Unknown API "${input.api}".`);
  }

  const tenantId = mapping.requiresTenantId
    ? resolveTenantId(env, input.tenantId)
    : undefined;

  const client = await createAuthenticatedClient(env);
  const apiClient = (client as XeroClient)[mapping.property];
  if (!apiClient || typeof apiClient !== "object") {
    throw new Error(`API client "${mapping.alias}" is not available.`);
  }

  const method = (apiClient as unknown as Record<string, unknown>)[
    input.method
  ];
  if (typeof method !== "function") {
    throw new Error(
      `Unknown method "${input.method}" for API "${mapping.alias}".`,
    );
  }

  const args: unknown[] = [];
  if (tenantId) {
    args.push(tenantId);
  }

  const result = await (method as Function).apply(apiClient, args);
  return toPrintableResult(result);
}
