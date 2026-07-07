'use strict';

const state = {
  config: null
};

const form = document.querySelector('#checkoutForm');
const demoBanner = document.querySelector('#demoBanner');
const formError = document.querySelector('#formError');
const submitButton = document.querySelector('#submitButton');
const cryptoSelect = document.querySelector('#cryptoCurrencyCode');
const networkSelect = document.querySelector('#network');
const walletInput = document.querySelector('#walletAddress');
const fiatAmountInput = document.querySelector('#fiatAmount');
const fiatCurrencySelect = document.querySelector('#fiatCurrency');
const paymentPreferenceSelect = document.querySelector('#paymentPreference');
const walletHint = document.querySelector('#walletHint');

const previewFiat = document.querySelector('#previewFiat');
const previewCrypto = document.querySelector('#previewCrypto');
const previewNetwork = document.querySelector('#previewNetwork');
const previewWallet = document.querySelector('#previewWallet');
const previewMode = document.querySelector('#previewMode');
const applePayNote = document.querySelector('#applePayNote');

const walletPlaceholders = {
  ethereum: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  polygon: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  base: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  arbitrum: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  bitcoin: 'bc1qexampleaddressreplacewithrealrecipientaddress0000',
  solana: '7sN4YwWjkxTn3pS3tY8w4V2f2u8VnR7u5m7PMh4M8N5L'
};

const currencySymbols = {
  EUR: '€',
  USD: '$',
  GBP: '£'
};

init();

async function init() {
  try {
    const response = await fetch('/api/config');
    state.config = await response.json();
    document.title = state.config.appName || 'Direct Crypto Pay';
    demoBanner.hidden = !state.config.demoMode;
    previewMode.textContent = state.config.demoMode ? 'Local demo' : 'Provider checkout';
    configureFiatLimits();
    renderNetworkOptions();
    updatePreview();
    updateApplePayNote();
  } catch (err) {
    showError('Could not load app configuration. Refresh the page and try again.');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  if (!document.querySelector('#terms').checked) {
    showError('Please confirm that you understand the provider handles KYC, payment, fees, and delivery.');
    return;
  }

  const payload = getPayload();
  const clientIssues = validateClientSide(payload);
  if (clientIssues.length > 0) {
    showError(clientIssues.join(' '));
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Creating checkout...';

  try {
    const response = await fetch('/api/onramp/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      const issueText = result.issues ? result.issues.join(' ') : result.detail || result.error || 'Unknown error';
      throw new Error(issueText);
    }

    window.location.href = result.checkoutUrl;
  } catch (err) {
    showError(err.message || 'Could not create checkout.');
    submitButton.disabled = false;
    submitButton.textContent = 'Continue to secure on-ramp';
  }
});

cryptoSelect.addEventListener('change', () => {
  renderNetworkOptions();
  updatePreview();
});
networkSelect.addEventListener('change', () => {
  updateWalletPlaceholder();
  updatePreview();
});
walletInput.addEventListener('input', updatePreview);
fiatAmountInput.addEventListener('input', updatePreview);
fiatCurrencySelect.addEventListener('change', updatePreview);
paymentPreferenceSelect.addEventListener('change', updateApplePayNote);

function configureFiatLimits() {
  if (!state.config) return;
  fiatAmountInput.min = String(state.config.minFiatAmount);
  fiatAmountInput.max = String(state.config.maxFiatAmount);
}

function renderNetworkOptions() {
  if (!state.config) return;
  const asset = state.config.supportedAssets[cryptoSelect.value];
  const networks = asset ? asset.networks : [];
  networkSelect.innerHTML = '';

  for (const network of networks) {
    const option = document.createElement('option');
    option.value = network;
    option.textContent = state.config.networkLabels[network] || network;
    if (network === asset.defaultNetwork) option.selected = true;
    networkSelect.appendChild(option);
  }

  updateWalletPlaceholder();
}

function updateWalletPlaceholder() {
  const network = networkSelect.value;
  walletInput.placeholder = walletPlaceholders[network] || 'Recipient wallet address';
  walletHint.textContent = getWalletHint(network);
}

function getWalletHint(network) {
  if (['ethereum', 'polygon', 'base', 'arbitrum'].includes(network)) {
    return 'Use a 0x EVM address for this network. Make sure the recipient can receive the selected asset there.';
  }
  if (network === 'bitcoin') return 'Use a BTC address. Do not paste an exchange memo here.';
  if (network === 'solana') return 'Use a Solana address. Make sure the asset is supported on Solana.';
  return 'Use an address on the selected network.';
}

function updatePreview() {
  const payload = getPayload();
  const symbol = currencySymbols[payload.fiatCurrency] || `${payload.fiatCurrency} `;
  const amount = Number(payload.fiatAmount || 0).toFixed(2);
  const networkLabel = state.config && state.config.networkLabels[payload.network]
    ? state.config.networkLabels[payload.network]
    : payload.network;

  previewFiat.textContent = `${symbol}${amount}`;
  previewCrypto.textContent = payload.cryptoCurrencyCode;
  previewNetwork.textContent = networkLabel || 'Select network';
  previewWallet.textContent = payload.walletAddress ? shorten(payload.walletAddress) : 'Waiting for address';
}

function updateApplePayNote() {
  const prefersApplePay = paymentPreferenceSelect.value === 'apple_pay';
  const canUseApplePay = typeof window.ApplePaySession !== 'undefined';
  if (prefersApplePay && canUseApplePay) {
    applePayNote.textContent = 'This browser appears to support Apple Pay. The provider still controls final payment-method availability.';
  } else if (prefersApplePay) {
    applePayNote.textContent = 'Apple Pay is generally shown only on supported Apple devices/browsers. The provider may show card or bank alternatives.';
  } else {
    applePayNote.textContent = 'The provider decides which payment methods appear based on buyer region, device, eligibility, and asset/network.';
  }
}

function getPayload() {
  return {
    fiatAmount: Number(fiatAmountInput.value),
    fiatCurrency: fiatCurrencySelect.value,
    cryptoCurrencyCode: cryptoSelect.value,
    network: networkSelect.value,
    walletAddress: walletInput.value.trim(),
    email: document.querySelector('#email').value.trim(),
    paymentPreference: paymentPreferenceSelect.value
  };
}

function validateClientSide(payload) {
  const issues = [];
  if (!Number.isFinite(payload.fiatAmount)) issues.push('Enter a valid fiat amount.');
  if (!payload.walletAddress) issues.push('Enter the recipient wallet address.');
  if (!payload.network) issues.push('Select a network.');
  if (payload.email && !/^\S+@\S+\.\S+$/.test(payload.email)) issues.push('Enter a valid email or leave it blank.');
  return issues;
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = '';
}

function shorten(value) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}
