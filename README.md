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

## Authentication & Secrets

`xero-cli` supports two authentication modes:

- `oauth` (recommended for user/org access)
- `client_credentials` (machine-to-machine where supported)

Secrets are stored in an encrypted local keyring file by default. Non-secret config (selected mode, default tenant, profile metadata) is stored in plain config.


### Quick Start: Client Credentials via Env Vars

Environment auth is simplest way to start:

```bash
export XERO_CLIENT_ID=your_client_id
export XERO_CLIENT_SECRET=your_client_secret
export XERO_TENANT_ID_DEFAULT=your_tenant_id
```

In this mode new access token is requested for every API call. No refresh token is stored in this mode.

### Client Credentials

Login and store app credentials in an encrypted file:

```bash
xero auth login --mode client_credentials
```

This flow prompts for `client_id`, `client_secret` and `user_password`. `client_id`/`client_secret` are encrypted using `user_password` and obtains access tokens on demand. No refresh token is stored in this mode.

During normal usage password is prompted interactively or read from `XERO_KEYRING_PASSWORD` env var if present.

### OAuth

Login with OAuth and store tokens securely:

```bash
xero auth login --mode oauth
```

This flow opens a browser, completes consent, stores the token set (including refresh token) in encrypted storage, and fetches tenants.

Storage file is encrypted with `keyring_password` which is prompted interactively.

Check current auth state:

```bash
xero auth status
```

### Keyring Backend

Currently only `file` backend is supported. File is located in `~/.config/xero-cli`

## Tenants

List connected tenants from Xero `/connections`:

```bash
xero tenants list
```

## Invoke

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
xero invoke accounting createAccount -- --account=resources/account.json
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
