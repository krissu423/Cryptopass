'use strict';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('sessionId');
const details = document.querySelector('#demoDetails');
const errorBox = document.querySelector('#demoError');
const completeButton = document.querySelector('#completeButton');
let loadedSession = null;

init();

async function init() {
  if (!sessionId) {
    showError('Missing demo session ID.');
    completeButton.disabled = true;
    return;
  }

  try {
    const response = await fetch(`/api/demo/session/${encodeURIComponent(sessionId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load demo session.');
    loadedSession = result;
    renderOrder(result.order, result.expiresAt);
  } catch (err) {
    showError(err.message || 'Could not load demo checkout.');
    completeButton.disabled = true;
  }
}

completeButton.addEventListener('click', async () => {
  if (!loadedSession) return;
  completeButton.disabled = true;
  completeButton.textContent = 'Completing demo order...';

  try {
    const response = await fetch('/api/demo/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not complete demo order.');
    window.location.href = result.redirectUrl;
  } catch (err) {
    showError(err.message || 'Could not complete demo order.');
    completeButton.disabled = false;
    completeButton.textContent = 'Simulate successful provider checkout';
  }
});

function renderOrder(order, expiresAt) {
  const rows = [
    ['Order ID', order.partnerOrderId],
    ['Buyer pays', `${order.fiatAmount} ${order.fiatCurrency}`],
    ['Recipient receives', `${order.cryptoCurrencyCode} on ${order.network}`],
    ['Recipient wallet', order.walletAddress],
    ['Payment preference', order.paymentPreference.replace(/_/g, ' ')],
    ['Demo URL expires', new Date(expiresAt).toLocaleString()]
  ];

  details.innerHTML = rows
    .map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(String(value || ''))}</span></div>`)
    .join('');
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[char]));
}
