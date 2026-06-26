// AI Shopping Assistant — storefront widget (Step B: UI shell only).
// Renders a floating launcher + chat panel. Not wired to the backend yet —
// that's Step C (App Proxy → Express /api/chat). Kept dependency-free (vanilla
// JS) so it runs directly from Shopify's CDN with no build step.

(function () {
  var root = document.getElementById('srit-chat-root');
  if (!root) return;

  var accent = root.dataset.accent || '#5c6ac4';
  var title = root.dataset.title || 'Shopping Assistant';
  var greeting = root.dataset.greeting || 'Hi! How can I help you shop today?';

  // --- Launcher button ------------------------------------------------------
  var launcher = document.createElement('button');
  launcher.id = 'srit-chat-launcher';
  launcher.style.background = accent;
  launcher.setAttribute('aria-label', 'Open shopping assistant');
  launcher.innerHTML = '&#128172;'; // speech balloon

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
    d.textContent = s;
    return d.innerHTML;
  }

  function addMessage(text, who) {
    var el = document.createElement('div');
    el.className = 'srit-msg srit-msg-' + who;
    if (who === 'user') el.style.background = accent;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function openPanel() {
    panel.classList.add('srit-open');
    if (!messages.childElementCount) addMessage(greeting, 'assistant');
    input.focus();
  }
  function closePanel() {
    panel.classList.remove('srit-open');
  }

  function handleSend() {
    var text = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    input.value = '';
    // Step C will replace this stub with a streamed reply from /api/chat.
    addMessage(
      "I'm connected to the storefront, but not to the catalog yet — that's the next step. 🔌",
      'assistant'
    );
  }

  // --- Events ---------------------------------------------------------------
  launcher.addEventListener('click', function () {
    panel.classList.contains('srit-open') ? closePanel() : openPanel();
  });
  panel.querySelector('#srit-chat-close').addEventListener('click', closePanel);
  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleSend();
  });
})();
