'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const appPort = 4001;
const mockPort = 4002;
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
const dataDir = './data-provider-smoke-test';

fs.rmSync(path.join(process.cwd(), dataDir), { recursive: true, force: true });

const mockServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/partners/api/v2/refresh-token') {
      assert(req.headers['api-secret'] === 'test_secret', 'Expected api-secret header');
      const body = await readJsonBody(req);
      assert(body.apiKey === 'test_key', 'Expected apiKey in refresh body');
      return sendJson(res, 200, {
        data: {
          accessToken: makeJwt({ API_KEY: 'test_key', exp: Math.floor(Date.now() / 1000) + 3600 }),
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        }
      });
    }

    if (req.method === 'POST' && req.url === '/api/v2/auth/session') {
      assert(Boolean(req.headers['access-token']), 'Expected access-token header');
      const body = await readJsonBody(req);
      const params = body.widgetParams || {};
      assert(params.apiKey === 'test_key', 'Expected widgetParams.apiKey');
      assert(params.referrerDomain === 'localhost:4001', 'Expected widgetParams.referrerDomain');
      assert(params.walletAddress === '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', 'Expected wallet address');
      assert(params.disableWalletAddressForm === true, 'Expected wallet form to be disabled');
      assert(params.defaultPaymentMethod === 'credit_debit_card', 'Expected card payment preference mapping');
      assert(params.partnerOrderId && params.partnerOrderId.startsWith('dcp_'), 'Expected partnerOrderId');
      return sendJson(res, 200, {
        data: {
          widgetUrl: 'https://global-stg.transak.com?apiKey=test_key&sessionId=test_session_123'
        }
      });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

(async () => {
  let child;
  let logs = '';

  try {
    await listen(mockServer, mockPort);

    const env = {
      ...process.env,
      PORT: String(appPort),
      BASE_URL: appBaseUrl,
      DATA_DIR: dataDir,
      DEMO_MODE: 'false',
      TRANSAK_ENV: 'STAGING',
      TRANSAK_API_KEY: 'test_key',
      TRANSAK_API_SECRET: 'test_secret',
      TRANSAK_REFERRER_DOMAIN: 'localhost:4001',
      TRANSAK_REFRESH_TOKEN_URL: `${mockBaseUrl}/partners/api/v2/refresh-token`,
      TRANSAK_WIDGET_SESSION_URL: `${mockBaseUrl}/api/v2/auth/session`
    };

    child = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
    child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

    await waitForServer(`${appBaseUrl}/health`);

    const sessionResponse = await fetch(`${appBaseUrl}/api/onramp/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fiatAmount: 50,
        fiatCurrency: 'EUR',
        cryptoCurrencyCode: 'USDC',
        network: 'polygon',
        walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        paymentPreference: 'card'
      })
    });

    const session = await sessionResponse.json();
    assert(sessionResponse.status === 201, `Expected 201, got ${sessionResponse.status}: ${JSON.stringify(session)}`);
    assert(session.mode === 'production_provider', 'Expected provider mode');
    assert(session.checkoutUrl.includes('sessionId=test_session_123'), 'Expected mocked widget URL');

    const tokenCachePath = path.join(process.cwd(), dataDir, 'transak-access-token.json');
    assert(fs.existsSync(tokenCachePath), 'Expected access token cache file');

    console.log('Provider-mode smoke test passed');
  } catch (err) {
    console.error('Provider-mode smoke test failed:', err.message);
    console.error(logs);
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    mockServer.close();
  }
})();

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (err) {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Server did not become ready in time');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function makeJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', 'mock-secret')
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
