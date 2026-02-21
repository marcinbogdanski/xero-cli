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

## Authentication (Client Credentials)

Set environment variables:

```bash
export XERO_CLIENT_ID=your_client_id
export XERO_CLIENT_SECRET=your_client_secret
export XERO_TENANT_ID_DEFAULT=your_tenant_id
```

Check auth configuration:

```bash
xero auth status
```

Request an access token and print summary:

```bash
xero auth token
```

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

Upload a file to Xero Files (stream param from local filepath):

```bash
xero invoke files uploadFile -- --body=resources/sample.pdf --name="Sample PDF upload" --filename=sample.pdf --mimeType=application/pdf
```
