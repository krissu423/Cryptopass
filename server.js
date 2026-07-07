'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

loadEnv(path.join(__dirname, '.env'));

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || './data');
const DB_PATH = path.join(DATA_DIR, 'orders.json');
const TRANSAK_TOKEN_CACHE_PATH = path.join(DATA_DIR, 'transak-access-token.json');
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const APP_NAME = process.env.APP_NAME || 'Direct Crypto Pay';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';
const DEMO_MODE = parseBool(process.env.DEMO_MODE, true);
const MIN_FIAT_AMOUNT = Number(process.env.MIN_FIAT_AMOUNT || 10);
const MAX_FIAT_AMOUNT = Number(process.env.MAX_FIAT_AMOUNT || 25000);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const SUPPORTED_ASSETS = {
  USDC: {
    label: 'USDC',
    networks: ['polygon', 'base', 'ethereum', 'arbitrum', 'solana'],
    defaultNetwork: 'polygon'
  },
  ETH: {
    label: 'ETH',
    networks: ['ethereum', 'base', 'arbitrum'],
    defaultNetwork: 'ethereum'
  },
  BTC: {
    label: 'BTC',
    networks: ['bitcoin'],
    defaultNetwork: 'bitcoin'
  },
  SOL: {
    label: 'SOL',
    networks: ['solana'],
    defaultNetwork: 'solana'
  },
  POL: {
    label: 'POL',
    networks: ['polygon'],
    defaultNetwork: 'polygon'
  },
  MATIC: {
    label: 'MATIC',
    networks: ['polygon'],
    defaultNetwork: 'polygon'
  }
};

const SUPPORTED_FIAT = ['EUR', 'USD', 'GBP'];
const NETWORK_LABELS = {
  polygon: 'Polygon',
  base: 'Base',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  bitcoin: 'Bitcoin',
  solana: 'Solana'
};

const PAYMENT_PREFERENCES = {
  provider_choice: null,
  card: 'credit_debit_card',
  apple_pay: 'apple_pay',
  google_pay: 'google_pay',
  sepa_bank_transfer: 'sepa_bank_transfer'
};

ensureDataStore();

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, appName: APP_NAME, demoMode: DEMO_MODE });
    }

    if (req.method === 'GET' && req.url === '/api/config') {
      return sendJson(res, 200, publicConfig());
    }

    if (req.method === 'POST' && req.url === '/api/onramp/session') {
      return await handleCreateOnrampSession(req, res);
    }

    if (req.method === 'GET' && req.url.startsWith('/api/orders/')) {
      const orderId = decodeURIComponent(req.url.split('/').pop() || '');
      return handleGetOrder(orderId, res);
    }

    if (req.method === 'GET' && req.url.startsWith('/api/demo/session/')) {
      const sessionId = decodeURIComponent(req.url.split('/').pop() || '');
      return handleGetDemoSession(sessionId, res);
    }

    if (req.method === 'POST' && req.url === '/api/demo/complete') {
      return await handleDemoComplete(req, res);
    }

    if (req.method === 'POST' && req.url === '/api/webhooks/transak') {
      return await handleTransakWebhook(req, res);
    }

    if (req.method === 'GET') {
      return serveStatic(req, res);
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[server-error]', err);
    return sendJson(res, 500, {
      error: 'Internal server error',
      detail: process.env.NODE_ENV === 'development' ? String(err && err.message ? err.message : err) : undefined
    });
  }
});

server.listen(PORT, () => {
  console.log(`${APP_NAME} running at ${BASE_URL}`);
  console.log(`Demo mode: ${DEMO_MODE ? 'ON' : 'OFF'}`);
});

async function handleCreateOnrampSession(req, res) {
  const body = await readJsonBody(req);
  const validation = validateCheckoutRequest(body);

  if (!validation.ok) {
    return sendJson(res, 400, { error: 'Invalid checkout request', issues: validation.issues });
  }

  const input = validation.value;
  const db = readDb();
  const partnerOrderId = `dcp_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const demoSessionId = `demo_${crypto.randomBytes(18).toString('base64url')}`;
  const now = new Date().toISOString();

  const order = {
    partnerOrderId,
    provider: DEMO_MODE ? 'demo' : 'transak',
    status: 'CREATED',
    eventId: 'LOCAL_ORDER_CREATED',
    createdAt: now,
    updatedAt: now,
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    cryptoCurrencyCode: input.cryptoCurrencyCode,
    network: input.network,
    walletAddress: input.walletAddress,
    email: input.email || null,
    paymentPreference: input.paymentPreference,
    metadata: {
      userAgent: req.headers['user-agent'] || null,
      ipAddress: extractIp(req)
    }
  };

  db.orders[partnerOrderId] = order;
  db.demoSessions[demoSessionId] = { partnerOrderId, createdAt: now };
  writeDb(db);

  let checkoutUrl;
  let mode;

  if (shouldUseTransak()) {
    try {
      const widgetUrl = await createTransakWidgetUrl(input, partnerOrderId);
      checkoutUrl = widgetUrl;
      mode = 'production_provider';
      updateOrder(partnerOrderId, {
        status: 'WIDGET_URL_CREATED',
        eventId: 'TRANSAK_WIDGET_URL_CREATED',
        provider: 'transak',
        checkoutUrlIssuedAt: new Date().toISOString()
      });
    } catch (err) {
      updateOrder(partnerOrderId, {
        status: 'PROVIDER_ERROR',
        eventId: 'TRANSAK_WIDGET_URL_FAILED',
        providerError: String(err && err.message ? err.message : err)
      });
      return sendJson(res, 502, {
        error: 'Could not create provider checkout session',
        detail: String(err && err.message ? err.message : err),
        partnerOrderId
      });
    }
  } else {
    checkoutUrl = `${BASE_URL}/demo-provider.html?sessionId=${encodeURIComponent(demoSessionId)}`;
    mode = 'local_demo';
    updateOrder(partnerOrderId, {
      status: 'DEMO_WIDGET_URL_CREATED',
      eventId: 'DEMO_WIDGET_URL_CREATED',
      demoSessionId
    });
  }

  return sendJson(res, 201, {
    partnerOrderId,
    checkoutUrl,
    mode,
    message: mode === 'local_demo'
      ? 'Demo checkout created. No real payment or crypto transfer will happen.'
      : 'Provider checkout created. Redirect the buyer to complete KYC/payment with the on-ramp provider.'
  });
}

function handleGetOrder(orderId, res) {
  const db = readDb();
  const order = db.orders[orderId];

  if (!order) {
    return sendJson(res, 404, { error: 'Order not found' });
  }

  return sendJson(res, 200, publicOrder(order));
}

function handleGetDemoSession(sessionId, res) {
  const db = readDb();
  const session = db.demoSessions[sessionId];
  if (!session) {
    return sendJson(res, 404, { error: 'Demo session not found' });
  }

  const order = db.orders[session.partnerOrderId];
  if (!order) {
    return sendJson(res, 404, { error: 'Demo order not found' });
  }

  return sendJson(res, 200, {
    sessionId,
    order: publicOrder(order),
    expiresAt: new Date(new Date(session.createdAt).getTime() + 5 * 60 * 1000).toISOString()
  });
}

async function handleDemoComplete(req, res) {
  if (shouldUseTransak()) {
    return sendJson(res, 403, { error: 'Demo completion is disabled when provider mode is active.' });
  }

  const body = await readJsonBody(req);
  const sessionId = String(body.sessionId || '');
  const db = readDb();
  const session = db.demoSessions[sessionId];

  if (!session) {
    return sendJson(res, 404, { error: 'Demo session not found' });
  }

  const order = db.orders[session.partnerOrderId];
  if (!order) {
    return sendJson(res, 404, { error: 'Demo order not found' });
  }

  const now = new Date().toISOString();
  const txHash = makeDemoTransactionHash(order.network);
  const updated = {
    ...order,
    status: 'COMPLETED',
    eventId: 'ORDER_COMPLETED',
    providerOrderId: `demo_provider_${crypto.randomBytes(6).toString('hex')}`,
    transactionHash: txHash,
    transactionLink: makeExplorerLink(order.network, txHash),
    amountPaid: order.fiatAmount,
    estimatedCryptoAmount: estimateCryptoAmount(order),
    completedAt: now,
    updatedAt: now,
    demoNotice: 'Demo success only. No fiat was charged and no on-chain transfer was sent.'
  };

  db.orders[session.partnerOrderId] = updated;
  writeDb(db);

  return sendJson(res, 200, {
    ok: true,
    redirectUrl: `${BASE_URL}/success.html?partnerOrderId=${encodeURIComponent(order.partnerOrderId)}`,
    order: publicOrder(updated)
  });
}

async function handleTransakWebhook(req, res) {
  const body = await readJsonBody(req, { limitBytes: 1024 * 1024 });

  let payload = body;

  if (body && typeof body.data === 'string') {
    try {
      payload = await verifyTransakWebhookJwt(body.data);
    } catch (err) {
      console.warn('[webhook] rejected invalid Transak JWT', err.message);
      const status = err && err.code === 'MISSING_TRANSAK_ACCESS_TOKEN' ? 500 : 401;
      return sendJson(res, status, { error: status === 500 ? err.message : 'Invalid webhook signature' });
    }
  }

  const webhookData = payload.webhookData || payload.data || payload;
  const eventId = payload.eventID || body.eventID || webhookData.eventID || 'TRANSAK_WEBHOOK';
  const partnerOrderId = webhookData.partnerOrderId || webhookData.partnerOrderID || webhookData.partner_order_id;
  const providerOrderId = webhookData.id || webhookData.orderId || webhookData.providerOrderId;

  const db = readDb();
  let order = partnerOrderId ? db.orders[partnerOrderId] : null;

  if (!order && providerOrderId) {
    order = Object.values(db.orders).find((candidate) => candidate.providerOrderId === providerOrderId);
  }

  if (!order && partnerOrderId) {
    order = {
      partnerOrderId,
      provider: 'transak',
      createdAt: new Date().toISOString()
    };
  }

  if (!order) {
    return sendJson(res, 202, {
      received: true,
      warning: 'Webhook verified but no local order matched it.',
      providerOrderId: providerOrderId || null,
      eventId
    });
  }

  const key = order.partnerOrderId;
  db.orders[key] = {
    ...order,
    provider: 'transak',
    providerOrderId: providerOrderId || order.providerOrderId || null,
    status: webhookData.status || order.status || 'UPDATED_BY_WEBHOOK',
    eventId,
    amountPaid: webhookData.amountPaid ?? order.amountPaid ?? null,
    fiatAmount: webhookData.fiatAmount ?? order.fiatAmount ?? null,
    fiatCurrency: webhookData.fiatCurrency || order.fiatCurrency || null,
    cryptoCurrencyCode: webhookData.cryptoCurrency || webhookData.cryptoCurrencyCode || order.cryptoCurrencyCode || null,
    network: webhookData.network || order.network || null,
    walletAddress: webhookData.walletAddress || order.walletAddress || null,
    cryptoAmount: webhookData.cryptoAmount ?? order.cryptoAmount ?? null,
    totalFeeInFiat: webhookData.totalFeeInFiat ?? order.totalFeeInFiat ?? null,
    transactionHash: webhookData.transactionHash || webhookData.txHash || order.transactionHash || null,
    transactionLink: webhookData.transactionLink || order.transactionLink || null,
    walletLink: webhookData.walletLink || order.walletLink || null,
    completedAt: webhookData.completedAt || order.completedAt || null,
    updatedAt: new Date().toISOString(),
    rawProviderWebhook: payload
  };
  writeDb(db);

  return sendJson(res, 200, { received: true, partnerOrderId: key, eventId });
}

async function createTransakWidgetUrl(input, partnerOrderId) {
  const env = getTransakEnv();
  const endpoints = getTransakEndpoints(env);
  const apiKey = getCredential(process.env.TRANSAK_API_KEY);
  const referrerDomain = String(process.env.TRANSAK_REFERRER_DOMAIN || new URL(BASE_URL).host).trim();

  if (!apiKey) {
    throw new Error('TRANSAK_API_KEY is required when DEMO_MODE=false.');
  }

  if (!referrerDomain) {
    throw new Error('TRANSAK_REFERRER_DOMAIN is required when DEMO_MODE=false.');
  }

  const widgetParams = {
    apiKey,
    referrerDomain,
    productsAvailed: 'BUY',
    fiatCurrency: input.fiatCurrency,
    fiatAmount: input.fiatAmount,
    cryptoCurrencyCode: input.cryptoCurrencyCode,
    network: input.network,
    walletAddress: input.walletAddress,
    disableWalletAddressForm: true,
    partnerOrderId,
    partnerCustomerId: input.email || `guest_${partnerOrderId}`,
    colorMode: 'DARK',
    themeColor: '#6d5dfc'
  };

  if (BASE_URL.startsWith('https://')) {
    widgetParams.redirectURL = `${BASE_URL}/success.html?partnerOrderId=${encodeURIComponent(partnerOrderId)}`;
  } else {
    console.warn('[transak] BASE_URL is not HTTPS, so redirectURL was omitted. Set BASE_URL=https://yourdomain.com in staging/production.');
  }

  if (input.email) {
    widgetParams.email = input.email;
    widgetParams.isAutoFillUserData = true;
  }

  const paymentMethod = PAYMENT_PREFERENCES[input.paymentPreference];
  if (paymentMethod) {
    const lockPaymentMethod = parseBool(process.env.TRANSAK_LOCK_PAYMENT_METHOD, false);
    widgetParams[lockPaymentMethod ? 'paymentMethod' : 'defaultPaymentMethod'] = paymentMethod;
  }

  let accessToken = await getTransakAccessToken();
  let result = await postTransakWidgetSession(endpoints.widgetSessionUrl, accessToken, widgetParams);

  if (result.response.status === 401 && canRefreshTransakAccessToken()) {
    accessToken = await getTransakAccessToken({ forceRefresh: true });
    result = await postTransakWidgetSession(endpoints.widgetSessionUrl, accessToken, widgetParams);
  }

  if (!result.response.ok) {
    throw new Error(`Transak returned ${result.response.status}: ${safeStringifyProviderError(result.payload)}`);
  }

  const widgetUrl = result.payload && result.payload.data && result.payload.data.widgetUrl;
  if (!widgetUrl) {
    throw new Error(`Transak response did not include data.widgetUrl: ${safeStringifyProviderError(result.payload)}`);
  }

  return widgetUrl;
}

async function postTransakWidgetSession(endpoint, accessToken, widgetParams) {
  return fetchJson(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'access-token': accessToken,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ widgetParams })
  });
}

async function getTransakAccessToken(opts = {}) {
  const envToken = getCredential(process.env.TRANSAK_ACCESS_TOKEN);
  const apiKey = getCredential(process.env.TRANSAK_API_KEY);
  const apiSecret = getCredential(process.env.TRANSAK_API_SECRET);

  if (!opts.forceRefresh && envToken && !isTokenExpiringSoon(getJwtExpiration(envToken))) {
    return envToken;
  }

  const cached = readTransakTokenCache();
  const expectedApiKeyHash = apiKey ? hashCredential(apiKey) : null;
  if (
    !opts.forceRefresh &&
    cached &&
    cached.accessToken &&
    cached.env === getTransakEnv() &&
    (!expectedApiKeyHash || cached.apiKeyHash === expectedApiKeyHash) &&
    !isTokenExpiringSoon(cached.expiresAt)
  ) {
    return cached.accessToken;
  }

  if (!apiKey || !apiSecret) {
    throw new Error('TRANSAK_API_KEY and TRANSAK_API_SECRET are required when DEMO_MODE=false. The API secret from your dashboard is used on the backend to generate the Partner Access Token.');
  }

  const { refreshTokenUrl } = getTransakEndpoints(getTransakEnv());
  const refreshed = await fetchJson(refreshTokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-secret': apiSecret,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ apiKey })
  });

  if (!refreshed.response.ok) {
    throw new Error(`Could not generate Transak Partner Access Token (${refreshed.response.status}): ${safeStringifyProviderError(refreshed.payload)}`);
  }

  const accessToken = refreshed.payload && refreshed.payload.data && refreshed.payload.data.accessToken;
  const expiresAt = Number(refreshed.payload && refreshed.payload.data && refreshed.payload.data.expiresAt) || getJwtExpiration(accessToken);

  if (!accessToken) {
    throw new Error(`Transak refresh-token response did not include data.accessToken: ${safeStringifyProviderError(refreshed.payload)}`);
  }

  writeTransakTokenCache({
    accessToken,
    expiresAt,
    env: getTransakEnv(),
    apiKeyHash: hashCredential(apiKey),
    refreshedAt: new Date().toISOString(),
    refreshTokenUrl
  }, cached);

  return accessToken;
}

async function verifyTransakWebhookJwt(token) {
  const candidates = await getTransakAccessTokenCandidates();

  if (candidates.length === 0) {
    const err = new Error('A valid Transak Partner Access Token is required to verify webhook payloads. Set TRANSAK_API_KEY and TRANSAK_API_SECRET, or provide TRANSAK_ACCESS_TOKEN.');
    err.code = 'MISSING_TRANSAK_ACCESS_TOKEN';
    throw err;
  }

  let lastError;
  for (const candidate of candidates) {
    try {
      return verifyJwt(token, candidate);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('JWT signature mismatch');
}

async function getTransakAccessTokenCandidates() {
  const seen = new Set();
  const candidates = [];
  const add = (value) => {
    const credential = getCredential(value);
    if (credential && !seen.has(credential)) {
      seen.add(credential);
      candidates.push(credential);
    }
  };

  add(process.env.TRANSAK_ACCESS_TOKEN);
  const cached = readTransakTokenCache();
  if (cached) {
    add(cached.accessToken);
    add(cached.previousAccessToken);
  }

  if (candidates.length === 0 && canRefreshTransakAccessToken()) {
    add(await getTransakAccessToken());
  }

  return candidates;
}

function canRefreshTransakAccessToken() {
  return Boolean(getCredential(process.env.TRANSAK_API_KEY) && getCredential(process.env.TRANSAK_API_SECRET));
}

function readTransakTokenCache() {
  try {
    if (!fs.existsSync(TRANSAK_TOKEN_CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(TRANSAK_TOKEN_CACHE_PATH, 'utf8'));
  } catch (err) {
    console.warn('[transak] ignoring unreadable token cache:', err.message);
    return null;
  }
}

function writeTransakTokenCache(next, previous) {
  try {
    const cache = { ...next };
    if (previous && previous.accessToken && previous.accessToken !== next.accessToken && !isTokenExpiringSoon(previous.expiresAt)) {
      cache.previousAccessToken = previous.accessToken;
      cache.previousExpiresAt = previous.expiresAt || null;
    }
    fs.writeFileSync(TRANSAK_TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[transak] could not write token cache:', err.message);
  }
}

function getTransakEnv() {
  return String(process.env.TRANSAK_ENV || 'STAGING').trim().toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'STAGING';
}

function getTransakEndpoints(env = getTransakEnv()) {
  return {
    refreshTokenUrl: process.env.TRANSAK_REFRESH_TOKEN_URL || (
      env === 'PRODUCTION'
        ? 'https://api.transak.com/partners/api/v2/refresh-token'
        : 'https://api-stg.transak.com/partners/api/v2/refresh-token'
    ),
    widgetSessionUrl: process.env.TRANSAK_WIDGET_SESSION_URL || (
      env === 'PRODUCTION'
        ? 'https://api-gateway.transak.com/api/v2/auth/session'
        : 'https://api-gateway-stg.transak.com/api/v2/auth/session'
    )
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (err) {
    payload = { raw: text };
  }
  return { response, payload, text };
}

function getCredential(value) {
  const credential = String(value || '').trim();
  if (!credential) return '';
  if (/^(your_|change_me|replace_me|example_|placeholder)/i.test(credential)) return '';
  return credential;
}

function isTokenExpiringSoon(expiresAt) {
  if (!expiresAt || !Number.isFinite(Number(expiresAt))) return false;
  const skewSeconds = Number(process.env.TRANSAK_TOKEN_REFRESH_SKEW_SECONDS || 300);
  return Number(expiresAt) <= Math.floor(Date.now() / 1000) + skewSeconds;
}

function getJwtExpiration(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
    return Number(payload.exp) || null;
  } catch (err) {
    return null;
  }
}

function hashCredential(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeStringifyProviderError(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (err) {
    text = String(value);
  }

  const cached = readTransakTokenCache();
  const secrets = [
    process.env.TRANSAK_API_SECRET,
    process.env.TRANSAK_ACCESS_TOKEN,
    cached && cached.accessToken,
    cached && cached.previousAccessToken
  ];

  for (const secret of secrets) {
    const credential = getCredential(secret);
    if (credential) {
      text = text.split(credential).join('[redacted]');
    }
  }

  return text;
}

function shouldUseTransak() {
  return !DEMO_MODE;
}

function validateCheckoutRequest(body) {
  const issues = [];
  const input = body && typeof body === 'object' ? body : {};

  const fiatAmount = Number(input.fiatAmount);
  const fiatCurrency = cleanUpper(input.fiatCurrency || 'EUR');
  const cryptoCurrencyCode = cleanUpper(input.cryptoCurrencyCode || 'USDC');
  const network = String(input.network || '').trim().toLowerCase();
  const walletAddress = String(input.walletAddress || '').trim();
  const email = String(input.email || '').trim();
  const paymentPreference = String(input.paymentPreference || 'provider_choice').trim();

  if (!Number.isFinite(fiatAmount) || fiatAmount < MIN_FIAT_AMOUNT || fiatAmount > MAX_FIAT_AMOUNT) {
    issues.push(`Fiat amount must be between ${MIN_FIAT_AMOUNT} and ${MAX_FIAT_AMOUNT}.`);
  }

  if (!SUPPORTED_FIAT.includes(fiatCurrency)) {
    issues.push(`fiatCurrency must be one of ${SUPPORTED_FIAT.join(', ')}.`);
  }

  if (!SUPPORTED_ASSETS[cryptoCurrencyCode]) {
    issues.push(`cryptoCurrencyCode must be one of ${Object.keys(SUPPORTED_ASSETS).join(', ')}.`);
  }

  const asset = SUPPORTED_ASSETS[cryptoCurrencyCode];
  if (asset && !asset.networks.includes(network)) {
    issues.push(`${cryptoCurrencyCode} is not configured for network '${network}'. Use one of: ${asset.networks.join(', ')}.`);
  }

  if (!isLikelyWalletAddress(walletAddress, network)) {
    issues.push(`walletAddress does not look valid for ${NETWORK_LABELS[network] || network}.`);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push('email must be a valid email address when provided.');
  }

  if (!Object.prototype.hasOwnProperty.call(PAYMENT_PREFERENCES, paymentPreference)) {
    issues.push(`paymentPreference must be one of ${Object.keys(PAYMENT_PREFERENCES).join(', ')}.`);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      fiatAmount: roundMoney(fiatAmount),
      fiatCurrency,
      cryptoCurrencyCode,
      network,
      walletAddress,
      email,
      paymentPreference
    }
  };
}

function isLikelyWalletAddress(address, network) {
  if (!address || address.length > 140) return false;

  if (['ethereum', 'polygon', 'base', 'arbitrum'].includes(network)) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  if (network === 'bitcoin') {
    return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(address);
  }

  if (network === 'solana') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  return /^[a-zA-Z0-9:_-]{20,140}$/.test(address);
}

function publicConfig() {
  return {
    appName: APP_NAME,
    supportEmail: SUPPORT_EMAIL,
    demoMode: !shouldUseTransak(),
    minFiatAmount: MIN_FIAT_AMOUNT,
    maxFiatAmount: MAX_FIAT_AMOUNT,
    supportedFiat: SUPPORTED_FIAT,
    supportedAssets: SUPPORTED_ASSETS,
    networkLabels: NETWORK_LABELS,
    paymentPreferences: Object.keys(PAYMENT_PREFERENCES)
  };
}

function publicOrder(order) {
  return {
    partnerOrderId: order.partnerOrderId,
    provider: order.provider,
    status: order.status,
    eventId: order.eventId,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    completedAt: order.completedAt || null,
    fiatAmount: order.fiatAmount,
    fiatCurrency: order.fiatCurrency,
    amountPaid: order.amountPaid ?? null,
    cryptoCurrencyCode: order.cryptoCurrencyCode,
    cryptoAmount: order.cryptoAmount ?? order.estimatedCryptoAmount ?? null,
    network: order.network,
    walletAddress: order.walletAddress,
    paymentPreference: order.paymentPreference,
    providerOrderId: order.providerOrderId || null,
    transactionHash: order.transactionHash || null,
    transactionLink: order.transactionLink || null,
    walletLink: order.walletLink || null,
    demoNotice: order.demoNotice || null,
    providerError: order.providerError || null
  };
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, BASE_URL);
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/') pathname = '/index.html';

  const safePath = path.normalize(pathname).replace(/^\.+[/\\]+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readJsonBody(req, opts = {}) {
  const limitBytes = opts.limitBytes || 128 * 1024;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > limitBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
}

function ensureDataStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    writeDb({ orders: {}, demoSessions: {} });
  }
}

function readDb() {
  ensureDataStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      orders: parsed.orders || {},
      demoSessions: parsed.demoSessions || {}
    };
  } catch (err) {
    return { orders: {}, demoSessions: {} };
  }
}

function writeDb(db) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function updateOrder(partnerOrderId, patch) {
  const db = readDb();
  const existing = db.orders[partnerOrderId];
  if (!existing) return null;
  const updated = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  db.orders[partnerOrderId] = updated;
  writeDb(db);
  return updated;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function cleanUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function extractIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
}

function makeDemoTransactionHash(network) {
  if (['ethereum', 'polygon', 'base', 'arbitrum'].includes(network)) {
    return `0x${crypto.randomBytes(32).toString('hex')}`;
  }
  return `demo_${network}_${crypto.randomBytes(18).toString('hex')}`;
}

function makeExplorerLink(network, txHash) {
  if (!txHash) return null;
  const encoded = encodeURIComponent(txHash);
  if (network === 'ethereum') return `https://etherscan.io/tx/${encoded}`;
  if (network === 'polygon') return `https://polygonscan.com/tx/${encoded}`;
  if (network === 'base') return `https://basescan.org/tx/${encoded}`;
  if (network === 'arbitrum') return `https://arbiscan.io/tx/${encoded}`;
  if (network === 'bitcoin') return `https://www.blockchain.com/explorer/transactions/btc/${encoded}`;
  if (network === 'solana') return `https://solscan.io/tx/${encoded}`;
  return null;
}

function estimateCryptoAmount(order) {
  const roughRates = {
    USDC: 1,
    ETH: 0.00028,
    BTC: 0.0000095,
    SOL: 0.006,
    POL: 2.2,
    MATIC: 2.2
  };
  const rate = roughRates[order.cryptoCurrencyCode] || 1;
  return Math.max(0, Number((order.fiatAmount * 0.985 * rate).toFixed(8)));
}

function verifyJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    throw new Error('JWT must have three parts');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(base64urlDecode(encodedHeader).toString('utf8'));
  const algToHash = {
    HS256: 'sha256',
    HS384: 'sha384',
    HS512: 'sha512'
  };
  const hash = algToHash[header.alg];
  if (!hash) {
    throw new Error(`Unsupported JWT alg '${header.alg}'. Expected HS256/HS384/HS512.`);
  }

  const expected = crypto
    .createHmac(hash, secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actual = base64urlDecode(encodedSignature);

  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('JWT signature mismatch');
  }

  const payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('JWT expired');
  }
  return payload;
}

function verifyJwtWithAnySecret(token, secrets) {
  let lastError = null;
  for (const secret of secrets) {
    try {
      return verifyJwt(token, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('JWT signature mismatch');
}

function base64urlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}
