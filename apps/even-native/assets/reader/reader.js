// The open conversation's own script, the only one its page runs (the policy
// names its nonce). It folds and unfolds what is on the page, names controls
// in a tooltip, and tells the app what was asked for: `act:VIEW[:argument]`.
// The mail can't post messages itself: its scripts are stripped and blocked,
// and it sits in a shadow root, where its markup can't reach these controls.
// `VIEW` says which page asked, so a click in one being replaced is dropped.
(function () {
  'use strict';
  var post = function (message) { window.ipc.postMessage(message); };
  var send = function (act, argument) { post(act + ':' + VIEW + (argument == null ? '' : ':' + argument)); };
  var find = function (selector, root) { return (root || document).querySelector(selector); };
  var article = function (part) { return find('article[data-part="' + part + '"]'); };
  var root = document.documentElement;

  // Tooltips: after a rest of 600 ms, and at once for the neighbours of one that just showed.
  var tip = document.getElementById('tip');
  var tipTimer = 0, tipHidden = 0, tipFor = null;
  function showTip(text, kbd, anchor) {
    tip.textContent = text;
    if (kbd) {
      var key = document.createElement('kbd');
      key.textContent = kbd;
      tip.appendChild(key);
    }
    tip.className = 'on' + (kbd ? ' kbd' : '');
    var width = tip.offsetWidth, height = tip.offsetHeight, page = root.clientWidth;
    var centre = (anchor.left + anchor.right) / 2;
    var top = anchor.top - height - 6, side = 'top';
    if (top < 4) { top = anchor.bottom + 6; side = 'bottom'; }
    var left = Math.min(Math.max(4, centre - width / 2), page - width - 4);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.setProperty('--ax', Math.min(Math.max(10, centre - left), width - 10) + 'px');
    tip.classList.add(side);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (tip.classList.contains('on')) tipHidden = Date.now();
    tip.className = '';
    tipFor = null;
  }
  function wantTip(owner, text, kbd, anchor) {
    if (tipFor === owner) return;
    hideTip();
    tipFor = owner;
    tipTimer = setTimeout(function () { showTip(text, kbd, anchor); }, Date.now() - tipHidden < 400 ? 0 : 600);
  }
  document.addEventListener('mouseover', function (event) {
    var element = event.target.closest ? event.target.closest('[data-tip]') : null;
    if (element) wantTip(element, element.dataset.tip, element.dataset.kbd, element.getBoundingClientRect());
    else if (tipFor && typeof tipFor !== 'string') hideTip();
  });
  root.addEventListener('mouseleave', function () { if (typeof tipFor !== 'string') hideTip(); });
  window.addEventListener('scroll', function () {
    root.classList.toggle('scrolled', window.scrollY > 0);
    if (typeof tipFor !== 'string') hideTip();
  }, { passive: true });

  var SKELETON = '<div class="lines"><div class="sk" style="width:100%"></div><div class="sk" style="width:91.6667%"></div><div class="sk" style="width:66.6667%"></div></div>';

  function setTranslated(part, on) {
    var message = article(part);
    if (!message) return;
    message.classList.toggle('translated', on);
    var button = find('[data-act="translate"]', message);
    if (!button) return;
    button.setAttribute('aria-pressed', on);
    button.lastChild.textContent = on ? button.dataset.on : button.dataset.off;
  }

  function toggleQuote(button, message) {
    var host = find('.mail', message);
    var quote = host && host.shadowRoot && host.shadowRoot.getElementById('even-quote');
    if (!quote) return;
    var show = button.getAttribute('aria-expanded') !== 'true';
    quote.style.setProperty('display', show ? 'block' : 'none', 'important');
    button.setAttribute('aria-expanded', show);
    button.dataset.tip = show ? button.dataset.hide : button.dataset.show;
  }

  // Which messages and quotes are unfolded, for the page that takes this
  // one's place ("show images", a setting that changed): `f` or `u` for the
  // long thread, then a 0 or 1 per message for open, and again for its quote.
  function folds() {
    var messages = find('.messages'), open = '', quotes = '';
    document.querySelectorAll('article[data-part]').forEach(function (message) {
      var quote = find('[data-act="quote"]', message);
      open += message.classList.contains('open') ? '1' : '0';
      quotes += quote && quote.getAttribute('aria-expanded') === 'true' ? '1' : '0';
    });
    return (messages && messages.classList.contains('folded') ? 'f' : 'u') + '.' + open + '.' + quotes;
  }
  function unfold(state) {
    var parts = state.split('.'), messages = find('.messages');
    var articles = document.querySelectorAll('article[data-part]');
    // Another number of messages: not the page these folds were of.
    if (parts.length !== 3 || parts[1].length !== articles.length) return;
    if (parts[0] === 'u' && messages) messages.classList.remove('folded');
    articles.forEach(function (message, index) {
      var open = parts[1].charAt(index) === '1';
      if (message.classList.contains('open') !== open) {
        message.classList.toggle('open', open);
        var toggle = find('[data-act="toggle"][aria-expanded]', message);
        if (toggle) toggle.setAttribute('aria-expanded', open);
      }
      var quote = find('[data-act="quote"]', message);
      if (quote && parts[2].charAt(index) === '1' && quote.getAttribute('aria-expanded') !== 'true') toggleQuote(quote, message);
    });
  }
  function keep() { post('keep:' + VIEW + ':' + Math.round(window.scrollY) + ':' + folds()); }

  function closeMenus(except) {
    document.querySelectorAll('.mb.open').forEach(function (menu) {
      if (menu !== except) menu.classList.remove('open');
    });
  }

  document.addEventListener('click', function (event) {
    var element = event.target.closest ? event.target.closest('[data-act]') : null;
    closeMenus(event.target.closest ? event.target.closest('.mb') : null);
    if (!element || element.disabled) return;
    var act = element.dataset.act;
    var message = element.closest('article');
    var part = message ? message.dataset.part : null;
    hideTip();
    switch (act) {
      case 'toggle':
        message.classList.toggle('open');
        element.setAttribute('aria-expanded', message.classList.contains('open'));
        break;
      case 'unfold':
        find('.messages').classList.remove('folded');
        break;
      case 'quote':
        toggleQuote(element, message);
        break;
      case 'translate':
        if (message.classList.contains('translated')) {
          setTranslated(part, false);
          send('original', part);
        } else {
          var place = find('.tr', message);
          if (!place.firstChild) place.innerHTML = SKELETON;
          setTranslated(part, true);
          send('translate', part);
        }
        break;
      case 'download':
        if (element.classList.contains('busy')) return;
        element.classList.add('busy');
        post('download:' + VIEW + ':' + part + ':' + element.dataset.arg);
        break;
      case 'copy':
        element.classList.add('copied');
        setTimeout(function () { element.classList.remove('copied'); }, 2000);
        send('copy', element.dataset.arg);
        break;
      case 'menu':
        element.closest('.mb').classList.toggle('open');
        break;
      case 'images':
        keep();
        send('images', Math.round(window.scrollY));
        break;
      default:
        send(act, element.dataset.arg != null ? element.dataset.arg : part);
    }
  });

  // The app's shortcuts go on, so J and K keep working after a click in the mail.
  document.addEventListener('keydown', function (event) {
    var target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    var key = null;
    if (event.metaKey && !event.ctrlKey && !event.altKey && ['r', 'f', 'k', 'b'].indexOf(event.key) >= 0) key = 'cmd-' + event.key;
    else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === 'Escape' && find('.mb.open')) { closeMenus(null); event.preventDefault(); return; }
      if (event.shiftKey && (event.key === 'U' || event.key === 'u')) key = 'shift-u';
      else if (['j', 'k', 'x', 'e', 's', '#', 'i', '!', 'b', 'u', 'p', '?', '/', 'r', 'a', 'f', 't', 'c', 'Escape'].indexOf(event.key) >= 0) key = event.key;
    }
    if (key) { event.preventDefault(); post('key:' + key); }
  });

  // What the app tells the page.
  window.even = {
    // A card above the mail, or the suggested replies, arrived or changed.
    slot: function (id, html) {
      var slot = document.getElementById('slot-' + id);
      if (slot) slot.innerHTML = html;
    },
    // A translation arrived; `null` turns the message back to its original.
    translation: function (part, html) {
      var message = article(part);
      if (!message) return;
      if (html == null) return setTranslated(part, false);
      find('.tr', message).innerHTML = html;
    },
    downloaded: function (part, file) {
      var chip = find('article[data-part="' + part + '"] .chip[data-arg="' + file + '"]');
      if (chip) chip.classList.remove('busy');
    },
    unsubscribed: function (parts) {
      parts.forEach(function (part) {
        var button = find('article[data-part="' + part + '"] .unsub');
        if (button) { button.disabled = true; button.textContent = button.dataset.done; }
      });
    },
    // The page is about to be written again: it says how it stands.
    keep: keep,
    // An answer is being written below: the bar makes way.
    replying: function (on) { document.body.classList.toggle('replying', on); },
    // The name of a tool in the app's toolbar above the page, `right` from the page's edge.
    tip: function (text, kbd, right) {
      if (text == null) { if (typeof tipFor === 'string') hideTip(); return; }
      var edge = root.clientWidth - right;
      wantTip('tool' + right, text, kbd, { left: edge - 14, right: edge + 14, top: -100, bottom: 0 });
    }
  };

  if (KEPT) unfold(KEPT);
  if (SCROLL) window.scrollTo(0, SCROLL);
  root.classList.toggle('scrolled', window.scrollY > 0);
  post('ready:' + VIEW);
})();
