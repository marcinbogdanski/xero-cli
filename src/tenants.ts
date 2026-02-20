import { TokenSet, XeroClient } from "xero-node";
import { acquireClientCredentialsToken } from "./auth";

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

function parseScopes(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

export async function listTenants(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantSummary[]> {
  const token = await acquireClientCredentialsToken(env);

  const client = new XeroClient({
    clientId: env.XERO_CLIENT_ID?.trim() ?? "",
    clientSecret: env.XERO_CLIENT_SECRET?.trim() ?? "",
    grantType: "client_credentials",
    scopes: parseScopes(env.XERO_SCOPES),
  });

  client.setTokenSet(
    new TokenSet({
      access_token: token.accessToken,
      token_type: token.tokenType ?? "Bearer",
      expires_in: token.expiresIn ?? undefined,
    }),
  );

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
