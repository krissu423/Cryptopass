'use strict';

const { spawn } = require('child_process');

const port = 3999;
const baseUrl = `http://localhost:${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  BASE_URL: baseUrl,
  DEMO_MODE: 'true',
  DATA_DIR: './data-smoke-test'
};

const child = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

(async () => {
  try {
    await waitForServer(`${baseUrl}/health`);

    const sessionResponse = await fetch(`${baseUrl}/api/onramp/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fiatAmount: 50,
        fiatCurrency: 'EUR',
        cryptoCurrencyCode: 'USDC',
        network: 'polygon',
        walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        paymentPreference: 'provider_choice'
      })
    });
    assert(sessionResponse.status === 201, `Expected 201, got ${sessionResponse.status}`);
    const session = await sessionResponse.json();
    assert(session.checkoutUrl.includes('/demo-provider.html'), 'Expected demo provider URL');

    const sessionId = new URL(session.checkoutUrl).searchParams.get('sessionId');
    assert(sessionId, 'Expected session ID');

    const completeResponse = await fetch(`${baseUrl}/api/demo/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    assert(completeResponse.status === 200, `Expected completion 200, got ${completeResponse.status}`);
    const complete = await completeResponse.json();
    assert(complete.order.status === 'COMPLETED', 'Expected completed order');

    const orderResponse = await fetch(`${baseUrl}/api/orders/${complete.order.partnerOrderId}`);
    assert(orderResponse.status === 200, `Expected order 200, got ${orderResponse.status}`);
    const order = await orderResponse.json();
    assert(order.transactionHash, 'Expected demo transaction hash');

    console.log('Smoke test passed');
  } catch (err) {
    console.error('Smoke test failed:', err.message);
    console.error(logs);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
})();

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
