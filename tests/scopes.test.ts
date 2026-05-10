import { describe, expect, it } from "vitest";
import { renderOAuthScopesHelpText, resolveOAuthScopes } from "../src/scopes";

describe("renderOAuthScopesHelpText", () => {
  it("renders scopes and profiles as plain text help", () => {
    const text = renderOAuthScopesHelpText();

    expect(text).toContain(
      "OAuth scopes for `xero auth login --mode oauth --scopes=...`.",
    );
    expect(text).toContain("Date scraped: 2026-02-22");
    expect(text).toContain(
      "Source URL: https://developer.xero.com/documentation/guides/oauth2/scopes",
    );
    expect(text).toContain("Scopes:");
    expect(text).toContain(
      "  accounting.transactions.read - View your business transactions",
    );
    expect(text).toContain("Profile core-read-only:");
    expect(text).toContain("Profile reconcile:");
    expect(text).toContain("Profile payroll-read-only:");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("includes profile entries with descriptions when available", () => {
    const text = renderOAuthScopesHelpText();

    expect(text).toContain("  offline_access");
    expect(text).toContain("  payroll.settings.read - View your payroll settings");
  });
});

describe("resolveOAuthScopes", () => {
  it("defaults to core-read-only profile", () => {
    const result = resolveOAuthScopes(undefined);

    expect(result.scopes).toContain("offline_access");
    expect(result.scopes).toContain("accounting.banktransactions.read");
    expect(result.scopes).toContain("accounting.reports.balancesheet.read");
    expect(result.warnings).toEqual([]);
  });

  it("expands profile tokens and explicit scopes with dedupe", () => {
    const result = resolveOAuthScopes(
      "core-read-only,accounting.invoices,accounting.banktransactions.read",
    );

    expect(result.scopes).toContain("accounting.invoices");
    expect(
      result.scopes.filter((scope) => scope === "accounting.banktransactions.read"),
    ).toHaveLength(1);
  });

  it("expands reconciliation profile", () => {
    const result = resolveOAuthScopes("reconcile");

    expect(result.scopes).toContain("accounting.invoices");
    expect(result.scopes).toContain("accounting.banktransactions");
    expect(result.scopes).toContain("accounting.contacts");
    expect(result.scopes).toContain("accounting.attachments");
    expect(result.scopes).toContain("files");
    expect(result.scopes).toContain("assets");
    expect(result.warnings).toEqual([]);
  });

  it("warns and passes through unknown scopes", () => {
    const result = resolveOAuthScopes("core-read-only,my.custom.scope");

    expect(result.scopes).toContain("my.custom.scope");
    expect(
      result.warnings.some((warning) => warning.includes('Scope "my.custom.scope"')),
    ).toBe(true);
  });

  it("warns when offline_access is missing", () => {
    const result = resolveOAuthScopes("accounting.transactions.read");

    expect(result.warnings).toContain(
      'Scope "offline_access" is not requested; no refresh token expected.',
    );
  });

  it("throws when only offline_access is requested", () => {
    expect(() => resolveOAuthScopes("offline_access")).toThrow(
      'Invalid OAuth scopes: "offline_access" alone is not enough. Add at least one API scope.',
    );
  });

  it("warns when deprecated broad accounting scopes are requested", () => {
    const result = resolveOAuthScopes("offline_access,accounting.transactions.read");

    expect(
      result.warnings.some((warning) =>
        warning.includes("Requested deprecated broad accounting scopes"),
      ),
    ).toBe(true);
  });
});
