# Xero CLI

Access Xero through CLI. Thin wrapper around `xero-node`.

## Quickstart

```bash
git clone https://github.com/marcinbogdanski/xero-cli.git
cd xero-cli
npm install
npm run build
npm link
xero
```

## Run Without Linking

```bash
npm run cli
npm run start
```

## Testing

```bash
npm test
```

Run a single file:

```bash
npx vitest run tests/auth.test.ts
```

## Authentication & Secrets

`xero-cli` supports two authentication modes:

- `oauth` (recommended for user/org access)
- `client_credentials` (machine-to-machine where supported)

Secrets are stored in an encrypted local keyring file.


### Quick Start: Client Credentials via Env Vars

Environment auth is simplest way to start:

```bash
export XERO_CLIENT_ID=your_client_id
export XERO_CLIENT_SECRET=your_client_secret
export XERO_TENANT_ID_DEFAULT=your_tenant_id
```

In this mode, a new access token is requested as needed. No refresh token is used or stored.

### Client Credentials

Login and store app credentials in an encrypted file:

```bash
xero auth login --mode client_credentials
```

This flow prompts for `client_id`, `client_secret`, and a keyring password. The credentials are encrypted at rest, and access tokens are obtained on demand. No refresh token is stored in this mode.

During normal usage, the keyring password is prompted interactively or read from `XERO_KEYRING_PASSWORD` if set.

### OAuth

Go to `https://developer.xero.com/` and:

- create a `Web` application
  - company URL doesn't matter
  - **callback URL**: paste exactly `http://localhost:53682/callback`
  - in **Configuration** tab: note **Client id** and generate **Client secret**
  - after creating Client secret, make sure to click **Save** in top right corner

Login with OAuth and store tokens securely (defaults to `core-read-only` scope profile):

```bash
xero auth login --mode oauth
```

You can override scopes with `--scopes`:

- `--scopes=core-read-only` (default):
  - uses curated core read-only API scopes (run `xero auth scopes` for details)
  - `core-read-only` is a best-effort profile, not a strict security guarantee
  - includes `offline_access` automatically (required to get refresh token)
- `--scopes=payroll-read-only`:
  - uses curated payroll read-only API scopes (run `xero auth scopes` for details)
  - includes `offline_access` automatically (required to get refresh token)
- `--scopes=scope1,scope2`:
  - uses exactly what you pass
  - if `offline_access` is missing, CLI prints warning: `no refresh token expected`
  - if scope is not in known list `resources/xero-scopes.json`, a warning is printed

Run `xero auth scopes` to print available profiles and scopes.

Examples:

```bash
xero auth login --mode oauth --scopes=core-read-only
xero auth login --mode oauth --scopes=payroll-read-only
xero auth login --mode oauth --scopes=core-read-only,accounting.invoices
xero auth login --mode oauth --scopes=openid,profile,email,offline_access,accounting.transactions.read
```

This flow shows a consent URL. Open it in browser, complete consent, then the browser will try to open the callback URL and fail.  
Back in the CLI, paste the **full callback URL** when prompted. This stores the OAuth token set (including refresh token) in encrypted storage.

During normal usage, keyring access uses interactive prompt or `XERO_KEYRING_PASSWORD` in non-interactive runs.

### Check Auth State:

```bash
xero auth status
xero doctor
xero auth logout
```

`xero doctor` always performs an authenticated Xero `/connections` call and prints policy gating summary (`allowed`, `ask-policy`, `blocked` method counts).

### Keyring Backend

Currently only `file` backend is supported. Data is stored under `~/.config/xero-cli`.

## Proxy Mode (Invoke Delegation)

Proxy mode lets a trusted machine keep Xero auth while an agent machine delegates invoke calls.

Trusted machine:

```bash
xero auth login --mode oauth
XERO_KEYRING_PASSWORD=your_keyring_password xero proxy
```

`xero proxy` runs a startup auth preflight (Xero `/connections`) and exits if auth/token/connectivity is invalid.

Proxy server defaults:

- bind host: `0.0.0.0`
- port: `8765`
- routes:
  - `GET /healthz`
  - `POST /v1/doctor`
  - `POST /v1/invoke`

Agent machine:

```bash
XERO_PROXY_URL=http://trusted-host:8765 xero invoke accounting getOrganisations
```

When `XERO_PROXY_URL` is set:

- `xero invoke ...` is delegated through proxy
- `xero doctor` checks proxy reachability then runs auth check on proxy server
- `xero auth ...` is disabled
- `xero tenants ...` is disabled
- `xero about` and help stay local
- invoke policy is enforced on the proxy server machine

Proxy-mode file behavior:

- `.json` invoke arg values are read and parsed on client machine, then sent inline as JSON.
- local file path values for non-`.json` args are sent as base64 file payloads and consumed as binary `Buffer` params on proxy.

Security note:

- proxy transport is plain HTTP JSON in current MVP (no TLS/auth hardening yet).

## Policy (Invoke Permissions)

Invoke calls are gated by `policy.json`.

Policy file path:

- default: `~/.config/xero-cli/policy.json`
- override: `XERO_POLICY_PATH=/path/to/policy.json`

Initialize full policy file from manifest:

```bash
xero policy init --profile block-all
xero policy init --profile read-only
xero policy init --profile read-ask-write
```

List effective policy for every supported method:

```bash
xero policy list
```

Profiles:

- `block-all`: every method is `block`
- `read-only`: methods starting with `get` are `allow`, others `block`
- `read-ask-write`: methods starting with `get` are `allow`, others `ask`

Policy file format:

```json
{
  "methods": {
    "accounting.getOrganisations": "allow",
    "accounting.createAccount": "ask",
    "files.uploadFile": "block"
  }
}
```

Rules:

- if policy file is missing, all methods are allowed
- if method is missing in `methods`, methods starting with `get` are allowed, all others are blocked
- valid values are `allow`, `ask`, `block`
- `ask` prompts on interactive TTY; in non-interactive runs it fails closed
- `xero policy list` shows effective policy per method and policy source (`policy_file` or `built_in_default`)

Policy `ask` keeps a human in the loop: the proxy operator must explicitly approve matching invokes before they are sent to Xero.

In proxy mode, policy is evaluated on the trusted proxy server machine (not on the client).

## Audit Log

Each invoke attempt is appended as JSONL.

- default: `~/.config/xero-cli/audit.jsonl`
- override: `XERO_AUDIT_LOG_PATH=/path/to/audit.jsonl`
- full request logging: `XERO_AUDIT_LOG_FULL=1` (logs `rawParams` and `uploadedFileParams`)

## Tenants

List connected tenants from Xero `/connections`:

```bash
xero tenants list
```

## Invoke

To keep strict control, initialize policy first:

```bash
xero policy init --profile read-only
```

Get organisation details:

```bash
xero invoke accounting getOrganisations
```

Override tenant id per command:

```bash
xero invoke accounting getOrganisations --tenant-id your_tenant_id
```

List bank transactions (newest first) with paging:

```bash
xero invoke accounting getBankTransactions -- --order='Date DESC' --page=1 --pageSize=5
```

List bank transactions modified since a specific UTC timestamp:

```bash
xero invoke accounting getBankTransactions -- --ifModifiedSince=2021-01-03T22:31:40Z --page=1 --pageSize=10 --order='Date DESC'
```

Filter invoices by multiple statuses (Array<string>):

```bash
xero invoke accounting getInvoices -- --statuses=AUTHORISED,DRAFT --page=1
```

Pass model payload params as inline JSON or a `.json` file path (no `@` prefix; relative paths are resolved from your current working directory):

```bash
xero invoke accounting createAccount -- --account='{"code":"201","name":"Sales Test","type":"REVENUE"}'
```

Create a draft bill (`ACCPAY`) from JSON payload:

```bash
xero invoke accounting createInvoices -- --invoices=resources/create-bill-draft.json
```

Upload a file to Xero Files (stream param from local filepath):

```bash
xero invoke files uploadFile -- --body=resources/sample.pdf --name="Sample PDF upload" --filename=sample.pdf --mimeType=application/pdf
```

List files sorted by size descending (string-literal union params):

```bash
xero invoke files getFiles -- --sort=Size --direction=DESC
```

Simple list/add/remove chain with Files folders:

```bash
xero invoke files getFolders
xero invoke files createFolder -- --folder='{"name":"cli-test-folder"}'
xero invoke files deleteFolder -- --folderId=<folder-id-from-create-response>
```
