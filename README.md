# Direct Crypto Pay

Direct Crypto Pay is a Node.js checkout website for a compliant fiat-to-crypto on-ramp flow.

The buyer enters a fiat amount, crypto asset/network, and a recipient wallet address. Your backend creates a Transak Secure Widget URL from the server, and the buyer completes KYC/payment inside Transak. The crypto is delivered by Transak directly to the recipient wallet address supplied by your app.

This app does **not** process cards directly, does **not** hold crypto, and does **not** store card details.

## What is included

- Responsive checkout website.
- Node.js backend with no external dependencies.
- Local demo mode that works without real money or crypto.
- Transak Secure Widget URL integration.
- Automatic Partner Access Token generation from `TRANSAK_API_KEY` + `TRANSAK_API_SECRET`.
- Access-token cache at `DATA_DIR/transak-access-token.json` so the app does not refresh on every request.
- Destination wallet locking with `walletAddress` + `disableWalletAddressForm=true`.
- Order status page.
- Transak webhook endpoint with signed JWT verification.
- Dockerfile and smoke tests.

## Run locally in demo mode

```bash
cp .env.example .env
npm start
```

Open:

```text
http://localhost:3000
```

By default, `DEMO_MODE=true`. The whole flow is clickable, but no fiat is charged and no real crypto is sent.

## Use Transak staging/production

From your Transak Partner Dashboard > Developers page, copy:

- API Key
- API Secret

The API Secret is not the access token. The server uses it to generate/refresh a Partner Access Token.

Update `.env`:

```bash
DEMO_MODE=false
TRANSAK_ENV=STAGING
TRANSAK_API_KEY=your_transak_api_key
TRANSAK_API_SECRET=your_transak_api_secret
TRANSAK_REFERRER_DOMAIN=yourdomain.com
BASE_URL=https://yourdomain.com
```

Then run:

```bash
npm start
```

To verify only the API Key + API Secret exchange before creating real widget sessions:

```bash
npm run transak:token
```

That command calls Transak's refresh-token endpoint and prints a masked token preview plus expiry time.

For local development with a real provider checkout, you usually need a public HTTPS tunnel or deployed URL because Transak validates the referrer domain and redirect URL. The Create Widget URL API is a backend-only API and may require partner IP whitelisting.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Local server port. Defaults to `3000`. |
| `BASE_URL` | Yes in provider mode | Public base URL used for redirects. Use HTTPS outside demo mode. |
| `DEMO_MODE` | No | `true` for local demo; `false` for real Transak sessions. |
| `DATA_DIR` | No | Directory for `orders.json` and Transak token cache. Defaults to `./data`. |
| `TRANSAK_ENV` | Yes in provider mode | `STAGING` or `PRODUCTION`. |
| `TRANSAK_API_KEY` | Yes in provider mode | Transak partner API key. |
| `TRANSAK_API_SECRET` | Yes in provider mode | Transak API secret from the dashboard; used only on the backend to generate the access token. |
| `TRANSAK_ACCESS_TOKEN` | Optional | Advanced override. Usually leave empty and let the app generate/cache the token. |
| `TRANSAK_REFERRER_DOMAIN` | Yes in provider mode | Domain registered/allowed by Transak, for example `yourdomain.com`. |
| `TRANSAK_LOCK_PAYMENT_METHOD` | No | `false` passes `defaultPaymentMethod`; `true` locks via `paymentMethod`. |
| `TRANSAK_REFRESH_TOKEN_URL` | No | Optional endpoint override for tests/support. |
| `TRANSAK_WIDGET_SESSION_URL` | No | Optional endpoint override for tests/support. |
| `MIN_FIAT_AMOUNT` | No | UI/server lower amount guard. Defaults to `10`. |
| `MAX_FIAT_AMOUNT` | No | UI/server upper amount guard. Defaults to `25000`. |

## API endpoints

### `POST /api/onramp/session`

Creates a checkout session.

Request:

```json
{
  "fiatAmount": 50,
  "fiatCurrency": "EUR",
  "cryptoCurrencyCode": "USDC",
  "network": "polygon",
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "email": "buyer@example.com",
  "paymentPreference": "provider_choice"
}
```

Response:

```json
{
  "partnerOrderId": "dcp_...",
  "checkoutUrl": "https://global-stg.transak.com?...sessionId=...",
  "mode": "production_provider"
}
```

### `GET /api/orders/:partnerOrderId`

Returns public order status.

### `POST /api/webhooks/transak`

Receives Transak webhook payloads. If the body includes a signed `data` JWT, the server verifies it using the Partner Access Token before updating the local order.

## Tests

Run syntax check:

```bash
npm run check
```

Run local demo-mode smoke test:

```bash
npm test
```

Run provider-mode smoke test with a local fake Transak server:

```bash
npm run test:provider
```

The provider-mode smoke test does not call the real Transak API. It verifies that this app correctly generates an access token, calls the Create Widget URL endpoint, and returns a widget URL.

After you add real credentials to `.env`, you can also test only the Transak token-generation step:

```bash
npm run transak:token
```

## Supported assets in this starter

The UI is intentionally conservative. Add or remove assets in `SUPPORTED_ASSETS` in `server.js` after confirming availability in your Transak account and target countries.

Current options:

- USDC on Polygon, Base, Ethereum, Arbitrum, Solana
- ETH on Ethereum, Base, Arbitrum
- BTC on Bitcoin
- SOL on Solana
- POL/MATIC on Polygon

## Security notes

- Never put `TRANSAK_API_SECRET` or `TRANSAK_ACCESS_TOKEN` in frontend JavaScript.
- Do not commit `.env` or `data/transak-access-token.json`.
- Use HTTPS in production.
- Replace JSON-file storage with a production database before real traffic.
- Add rate limiting and bot protection around `POST /api/onramp/session`.
- Register and verify Transak webhooks before relying on order status.

## Important compliance note

This code is not legal advice and does not make you licensed. It is designed so fiat-to-crypto activity happens through an approved provider-hosted flow. Before production launch, confirm licensing, KYB/KYC reliance, supported jurisdictions, prohibited use cases, tax treatment, disclosures, refunds, sanctions screening, and consumer-protection requirements with counsel and your provider.
