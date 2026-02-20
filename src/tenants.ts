import { createAuthenticatedClient } from "./client";

export interface TenantSummary {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc: string | null;
  updatedDateUtc: string | null;
}

interface RawTenant {
  id?: string;
  tenantId?: string;
  tenantName?: string;
  tenantType?: string;
  createdDateUtc?: string;
  updatedDateUtc?: string;
}

export async function listTenants(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantSummary[]> {
  const client = await createAuthenticatedClient(env);
  const tenants = (await client.updateTenants(false)) as RawTenant[];
  return tenants.map((tenant) => ({
    id: tenant.id ?? "",
    tenantId: tenant.tenantId ?? "",
    tenantName: tenant.tenantName ?? "",
    tenantType: tenant.tenantType ?? "",
    createdDateUtc: tenant.createdDateUtc ?? null,
    updatedDateUtc: tenant.updatedDateUtc ?? null,
  }));
}
