'use strict';

const params = new URLSearchParams(window.location.search);
const partnerOrderId = params.get('partnerOrderId') || params.get('partnerOrderID') || params.get('orderId');
const details = document.querySelector('#orderDetails');
const errorBox = document.querySelector('#statusError');
const intro = document.querySelector('#statusIntro');
const badge = document.querySelector('#statusBadge');
const explorerLink = document.querySelector('#explorerLink');

init();

async function init() {
  if (!partnerOrderId) {
    showError('No order ID was found in the redirect URL.');
    intro.textContent = 'The provider returned without a local partnerOrderId.';
    return;
  }

  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(partnerOrderId)}`);
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || 'Could not load order.');
    renderOrder(order);
  } catch (err) {
    showError(err.message || 'Could not load order.');
  }
}

function renderOrder(order) {
  const status = order.status || 'UNKNOWN';
  badge.textContent = status;
  intro.textContent = getIntro(status, order.provider);

  const rows = [
    ['Order ID', order.partnerOrderId],
    ['Provider', order.provider],
    ['Status', status],
    ['Buyer paid', order.amountPaid ? `${order.amountPaid} ${order.fiatCurrency}` : `${order.fiatAmount} ${order.fiatCurrency}`],
    ['Crypto', `${order.cryptoAmount || 'Provider-calculated'} ${order.cryptoCurrencyCode}`],
    ['Network', order.network],
    ['Recipient wallet', order.walletAddress],
    ['Provider order ID', order.providerOrderId || 'Pending'],
    ['Transaction hash', order.transactionHash || 'Pending'],
    ['Updated', order.updatedAt ? new Date(order.updatedAt).toLocaleString() : 'Pending']
  ];

  details.innerHTML = rows
    .map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(String(value || ''))}</span></div>`)
    .join('');

  if (order.transactionLink) {
    explorerLink.href = order.transactionLink;
    explorerLink.hidden = false;
  }
}

function getIntro(status, provider) {
  if (status === 'COMPLETED') {
    return provider === 'demo'
      ? 'Demo checkout completed. No fiat was charged and no real crypto moved.'
      : 'The provider reported that the crypto delivery completed.';
  }
  if (status.includes('FAILED') || status === 'CANCELLED' || status === 'REFUNDED') {
    return 'The provider did not complete the order. Check provider details or ask the buyer to retry.';
  }
  return 'The order has been created and may still be processing with the provider.';
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
