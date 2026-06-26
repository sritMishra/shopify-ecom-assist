// AI Shopping Assistant — storefront widget (Step C: wired to backend).
// Calls the Express backend THROUGH the Shopify App Proxy (same-origin):
//   POST /apps/assistant/chat  → Shopify → ngrok → /api/storefront/chat
// Non-streaming for now: backend returns { reply, products }.
// Dependency-free vanilla JS so it runs from Shopify's CDN with no build step.

(function () {
  var root = document.getElementById('srit-chat-root');
  if (!root) return;

  var accent = root.dataset.accent || '#5c6ac4';
  var title = root.dataset.title || 'Shopping Assistant';
  var greeting = root.dataset.greeting || 'Hi! How can I help you shop today?';

  var ENDPOINT = '/apps/assistant/chat';
  var history = []; // [{ role, content }] — sent each request for context

  // --- Launcher button ------------------------------------------------------
  var launcher = document.createElement('button');
  launcher.id = 'srit-chat-launcher';
  launcher.style.background = accent;
  launcher.setAttribute('aria-label', 'Open shopping assistant');
  launcher.innerHTML = '&#128172;';

  // --- Panel ----------------------------------------------------------------
  var panel = document.createElement('div');
  panel.id = 'srit-chat-panel';
  panel.innerHTML =
    '<div id="srit-chat-header" style="background:' + accent + '">' +
      '<span>' + escapeHtml(title) + '</span>' +
      '<button id="srit-chat-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div id="srit-chat-messages"></div>' +
    '<div id="srit-chat-inputrow">' +
      '<input id="srit-chat-input" type="text" placeholder="Ask about products..." autocomplete="off" />' +
      '<button id="srit-chat-send">Send</button>' +
    '</div>';

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var messages = panel.querySelector('#srit-chat-messages');
  var input = panel.querySelector('#srit-chat-input');
  var sendBtn = panel.querySelector('#srit-chat-send');
  sendBtn.style.background = accent;

  // --- Helpers --------------------------------------------------------------
  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  function addMessage(text, who) {
    var el = document.createElement('div');
    el.className = 'srit-msg srit-msg-' + who;
    if (who === 'user') el.style.background = accent;
    el.textContent = text;
    messages.appendChild(el);
    scrollDown();
    return el;
  }

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  function formatPrice(p) {
    if (!p || !p.price || !p.price.min) return '';
    var min = p.price.min,
      max = p.price.max;
    function fmt(m) {
      if (!m) return '';
      try {
        return m.currencyCode
          ? new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currencyCode }).format(m.amount)
          : String(m.amount);
      } catch (e) {
        return String(m.amount);
      }
    }
    if (max && max.amount !== min.amount) return fmt(min) + ' – ' + fmt(max);
    return fmt(min);
  }

  function renderProducts(products) {
    if (!products || !products.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'srit-products';
    products.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'srit-product';
      var img = p.image && p.image.url
        ? '<img class="srit-product-img" src="' + escapeHtml(p.image.url) + '" alt="' + escapeHtml(p.title) + '" loading="lazy" />'
        : '';
      card.innerHTML =
        img +
        '<div class="srit-product-body">' +
          '<div class="srit-product-title">' + escapeHtml(p.title) + '</div>' +
          '<div class="srit-product-price">' + escapeHtml(formatPrice(p)) + '</div>' +
          (p.url
            ? '<a class="srit-product-link" href="' + escapeHtml(p.url) + '" target="_blank" rel="noopener noreferrer">View Product →</a>'
            : '') +
        '</div>';
      wrap.appendChild(card);
    });
    messages.appendChild(wrap);
    scrollDown();
  }

  function setBusy(busy) {
    input.disabled = busy;
    sendBtn.disabled = busy;
  }

  function openPanel() {
    panel.classList.add('srit-open');
    if (!messages.childElementCount) addMessage(greeting, 'assistant');
    input.focus();
  }
  function closePanel() {
    panel.classList.remove('srit-open');
  }

  async function handleSend() {
    var text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    history.push({ role: 'user', content: text });
    input.value = '';
    setBusy(true);

    var typing = addMessage('…', 'assistant');

    try {
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      typing.textContent = data.reply || "Sorry, I couldn't find an answer.";
      history.push({ role: 'assistant', content: data.reply || '' });
      renderProducts(data.products);
    } catch (err) {
      typing.textContent = 'Sorry — something went wrong. Please try again.';
    } finally {
      setBusy(false);
      input.focus();
      scrollDown();
    }
  }

  // --- Events ---------------------------------------------------------------
  launcher.addEventListener('click', function () {
    panel.classList.contains('srit-open') ? closePanel() : openPanel();
  });
  panel.querySelector('#srit-chat-close').addEventListener('click', closePanel);
  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !sendBtn.disabled) handleSend();
  });
})();
