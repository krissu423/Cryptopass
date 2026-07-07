'use strict';

const fs = require('fs');
const path = require('path');

loadEnv(path.join(process.cwd(), '.env'));

const env = String(process.env.TRANSAK_ENV || 'STAGING').toUpperCase();
const apiKey = String(process.env.TRANSAK_API_KEY || '').trim();
const apiSecret = String(process.env.TRANSAK_API_SECRET || '').trim();

if (!apiKey || !apiSecret) {
  console.error('Missing TRANSAK_API_KEY or TRANSAK_API_SECRET in .env');
  process.exit(1);
}

const endpoint = process.env.TRANSAK_REFRESH_TOKEN_URL || (env === 'PRODUCTION'
  ? 'https://api.transak.com/partners/api/v2/refresh-token'
  : 'https://api-stg.transak.com/partners/api/v2/refresh-token');

(async () => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-secret': apiSecret,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ apiKey })
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    result = { raw: text };
  }

  if (!response.ok) {
    console.error(`Transak returned ${response.status}: ${JSON.stringify(result, null, 2)}`);
    process.exit(1);
  }

  const accessToken = result && result.data && result.data.accessToken;
  const expiresAt = result && result.data && result.data.expiresAt;

  if (!accessToken) {
    console.error(`No accessToken returned: ${JSON.stringify(result, null, 2)}`);
    process.exit(1);
  }

  console.log('Transak access token created successfully.');
  console.log(`Environment: ${env}`);
  console.log(`Token preview: ${accessToken.slice(0, 12)}...${accessToken.slice(-8)}`);
  if (expiresAt) {
    console.log(`Expires at: ${new Date(Number(expiresAt) * 1000).toISOString()}`);
  }
})().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

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
