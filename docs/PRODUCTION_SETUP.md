# Production setup checklist

## 1. Provider approval

Use a regulated on-ramp provider that supports your target countries, fiat currencies, crypto assets, payment methods, and destination wallet flow. This starter is wired for Transak hosted Secure Widget URLs.

Before going live:

- Complete provider KYB.
- Confirm supported jurisdictions.
- Confirm whether your use case requires your own licensing or relies on the provider as merchant/provider of record.
- Confirm allowed marketing language and user disclosures.
- Confirm refund handling and support boundaries.
- Confirm Apple Pay/card availability for your region, devices, and account.

## 2. Domain and HTTPS

Set these environment variables on your deployed server:

```bash
BASE_URL=https://yourdomain.com
TRANSAK_REFERRER_DOMAIN=yourdomain.com
DEMO_MODE=false
```

Provider webhooks must be public and HTTPS:

```text
https://yourdomain.com/api/webhooks/transak
```

Transak may also require partner backend IP whitelisting for the Secure Widget URL APIs.

## 3. Secrets

Set these only on the server:

```bash
TRANSAK_API_KEY=...
TRANSAK_API_SECRET=...
```

Do not expose the API Secret or Partner Access Token to the frontend. The app stores a generated access token in:

```text
DATA_DIR/transak-access-token.json
```

Protect that file like a secret. In production, prefer a secrets manager or encrypted database storage.

## 4. Database

The demo stores orders in `data/orders.json`. Replace this with a production database before real traffic.

Suggested order fields:

- `partnerOrderId`
- `providerOrderId`
- `status`
- `eventId`
- `fiatAmount`
- `fiatCurrency`
- `cryptoCurrencyCode`
- `network`
- `walletAddress`
- `amountPaid`
- `cryptoAmount`
- `totalFeeInFiat`
- `transactionHash`
- `transactionLink`
- `createdAt`
- `updatedAt`
- `completedAt`

## 5. Risk controls to add

- Rate limiting on `POST /api/onramp/session`.
- Bot protection.
- IP/country allow/deny rules based on provider-supported countries.
- Basic sanctions/prohibited-wallet screening if your provider contract requires it before redirect.
- Abuse monitoring for repeated failed orders.
- Customer support workflow for failed/refunded orders.

## 6. Testing

- Test local demo mode.
- Test provider mode with `npm run test:provider`.
- Test real Transak staging card flow.
- Test Apple Pay only on supported Apple devices/browsers and with Transak sandbox setup.
- Test webhook signature verification.
- Test provider redirects where the order is still processing.
- Test failed, cancelled, refunded, and expired order states.

## 7. Launch disclosures

At minimum, the buyer should see:

- The provider is responsible for KYC, payment authorization, fees, eligibility, refunds, and delivery.
- Crypto transfers may be irreversible after delivery.
- Wrong wallet addresses/networks can lead to loss of funds.
- Prices and fees can change before final provider confirmation.
- Availability varies by region, payment method, asset, and network.
