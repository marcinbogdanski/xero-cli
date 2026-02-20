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
```

Check auth configuration:

```bash
xero auth status
```

Request an access token and print summary:

```bash
xero auth token
```
