// The rich text editor inside the webview (src/editor.rs): a contenteditable
// document that behaves as the web apps' tiptap editors do. No library: the
// browser's own editing commands do the work, so undo stays the browser's.
//
//   apps/notes-web/src/components/note-editor.tsx          markdown
//   apps/todo-web/src/components/board/description-editor.tsx   markdown
//   apps/mail-web/src/components/rich-text-editor.tsx      HTML
//
// The app talks to it through `window.__even` and hears back through
// `window.ipc.postMessage` (JSON; see `Message` in src/editor.rs).
(function () {
  'use strict';
  var Md = EvenMd;
  var init = window.EVEN_INIT || {};
  var mode = init.mode === 'html' ? 'html' : 'markdown';
  var E = document.getElementById('editor');
  var root = document.documentElement;
  var editable = true;
  /** What the app last heard or said the content is. */
  var lastContent = '';
  /** Our own commands are running: their input events are not typing. */
  var applying = false;
  var pending = 0;
  var lastRange = null;
  var lastMarks = '';
  var lastHeight = -1;
  var internalDrag = false;

  function post(message) {
    try {
      window.ipc.postMessage(JSON.stringify(message));
    } catch (error) {
      /* No app listening: a plain browser, while testing. */
    }
  }
  function cmd(name, value) {
    try {
      return document.execCommand(name, false, value === undefined ? null : value);
    } catch (error) {
      return false;
    }
  }
  /** The browser rewrites any HTML into well-formed markup without running or loading it. */
  function normalize(html) {
    var template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template.innerHTML;
  }

  // ------------------------------------------------------------- selection

  function selection() {
    return window.getSelection();
  }
  function range() {
    var s = selection();
    if (!s.rangeCount) return null;
    var r = s.getRangeAt(0);
    var node = r.commonAncestorContainer;
    return node === E || E.contains(node) ? r : null;
  }
  function closest(node, selector) {
    for (; node && node !== E; node = node.parentNode) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
    }
    return null;
  }
  /** The line the node is in: a paragraph, heading, list item or code block. */
  function blockOf(node) {
    return closest(node, 'p,h1,h2,h3,h4,h5,h6,li,pre,div');
  }
  function topChild(node) {
    while (node && node.parentNode !== E) node = node.parentNode;
    return node;
  }
  function select(startNode, startOffset, endNode, endOffset) {
    var r = document.createRange();
    r.setStart(startNode, startOffset);
    if (endNode) r.setEnd(endNode, endOffset);
    else r.collapse(true);
    var s = selection();
    s.removeAllRanges();
    s.addRange(r);
    return r;
  }
  function caretIn(element, atEnd) {
    var r = document.createRange();
    r.selectNodeContents(element);
    r.collapse(!atEnd);
    var s = selection();
    s.removeAllRanges();
    s.addRange(r);
  }
  /** The text of a range, with line breaks as newlines. */
  function rangeText(r) {
    var holder = document.createElement('div');
    holder.appendChild(r.cloneContents());
    holder.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
    return holder.textContent.replace(/\u200b/g, '');
  }
  function before(block, r) {
    var part = document.createRange();
    part.selectNodeContents(block);
    part.setEnd(r.startContainer, r.startOffset);
    return part;
  }
  function after(block, r) {
    var part = document.createRange();
    part.selectNodeContents(block);
    part.setStart(r.endContainer, r.endOffset);
    return part;
  }
  function atStart(block, r) {
    var part = before(block, r);
    return part.toString().replace(/\u200b/g, '') === '' && !part.cloneContents().querySelector('img,br');
  }
  /** A list item's own text, without the lists inside it. */
  function ownText(item) {
    var copy = item.cloneNode(true);
    copy.querySelectorAll('ul,ol').forEach(function (list) { list.remove(); });
    return copy.querySelector('img') ? 'x' : copy.textContent.replace(/\u200b/g, '').trim();
  }
  /** Runs a change to the elements and puts the selection back where it was in the text. */
  function keepSelection(run) {
    var r = range();
    var saved = r && [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
    run();
    if (!saved || !E.contains(saved[0]) || !E.contains(saved[2])) return;
    try {
      select(saved[0], Math.min(saved[1], size(saved[0])), saved[2], Math.min(saved[3], size(saved[2])));
    } catch (error) {
      /* The place is gone; the browser's own choice stands. */
    }
  }
  function size(node) {
    return node.nodeType === 3 ? node.length : node.childNodes.length;
  }
  function unwrap(element) {
    element.replaceWith.apply(element, Array.prototype.slice.call(element.childNodes));
  }
  /** The selection again after the view lost it: a toolbar click lands outside the webview. */
  function restore() {
    if (range()) return;
    if (lastRange && E.contains(lastRange.commonAncestorContainer)) {
      var s = selection();
      s.removeAllRanges();
      s.addRange(lastRange);
    } else caretIn(E.lastElementChild || E, true);
  }

  // --------------------------------------------------------------- content

  function serialize() {
    var html = E.innerHTML;
    if (mode === 'markdown') return { content: Md.htmlToMd(html), text: '', written: false };
    var mail = Md.htmlToEmail(html);
    return { content: mail.html, text: mail.text, written: mail.written };
  }
  function flush() {
    if (pending) clearTimeout(pending);
    pending = 0;
    var now = serialize();
    if (now.content === lastContent) return;
    lastContent = now.content;
    // Mail: what is written above the signature, known before the change is told.
    if (mode === 'html') post({ t: 'body', text: bodyText() });
    post({ t: 'change', content: now.content, text: now.text, written: now.written });
  }
  /** Something in the document changed: tell the app soon, and keep the page's own state right. */
  function changed() {
    if (!pending) pending = setTimeout(flush, 40);
    measure();
    marksSoon();
  }

  function isEmpty() {
    var first = E.firstElementChild;
    if (!first || first.tagName !== 'P' || first.textContent.replace(/\u200b/g, '') !== '' || first.querySelector('img')) return false;
    for (var next = first.nextElementSibling; next; next = next.nextElementSibling) {
      // Mail shows the placeholder above a signature too.
      if (mode !== 'html' || !next.hasAttribute('data-signature')) return false;
    }
    return true;
  }
  var INLINE = { B: 1, I: 1, U: 1, S: 1, STRIKE: 1, A: 1, SPAN: 1, CODE: 1, FONT: 1, STRONG: 1, EM: 1, BR: 1, IMG: 1 };
  var BLOCKS = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR|DIV)$/;

  /**
   * Takes out what WebKit's editing leaves behind: the looks it copies onto
   * text it moves (a quote's grey, the page's font size), and a paragraph
   * around a list it made inside one.
   */
  function tidy() {
    var fonts = E.querySelectorAll('font');
    var styled = E.querySelectorAll('[style]');
    var wrapped = E.querySelectorAll('p > ul, p > ol, p > blockquote, p > pre, p > hr, p > p, p > div');
    if (!fonts.length && !styled.length && !wrapped.length) return;
    keepSelection(function () {
      fonts.forEach(unwrap);
      styled.forEach(function (element) {
        // Only a text size mail set itself stays.
        var keep = mode === 'html' && element.tagName === 'SPAN' && /^\d/.test(element.style.fontSize) ? element.style.fontSize : '';
        element.removeAttribute('style');
        if (keep) element.style.fontSize = keep;
        else if (element.tagName === 'SPAN' && !element.attributes.length) unwrap(element);
      });
      wrapped.forEach(function (child) {
        var paragraph = child.parentNode;
        if (!paragraph || paragraph.tagName !== 'P' || !paragraph.parentNode) return;
        // The blocks come out; the text between them stays in paragraphs of its own.
        var parts = document.createDocumentFragment();
        var line = null;
        while (paragraph.firstChild) {
          var node = paragraph.firstChild;
          if (node.nodeType === 1 && BLOCKS.test(node.tagName)) {
            line = null;
            parts.appendChild(node);
          } else {
            if (!line) line = parts.appendChild(document.createElement('p'));
            line.appendChild(node);
          }
        }
        Array.prototype.slice.call(parts.childNodes).forEach(function (part) {
          if (part.tagName === 'P' && part.textContent === '' && !part.querySelector('img')) part.remove();
        });
        paragraph.replaceWith(parts);
      });
    });
  }

  /** Keeps the document in the shape the rest relies on, after the browser's own editing. */
  function fixup() {
    if (!E.firstChild) {
      E.innerHTML = '<p><br></p>';
      if (document.activeElement === E) caretIn(E.firstChild, false);
    }
    var r = range();
    if (r) {
      // Text or a <div> straight under the editor, where the caret is, becomes a paragraph.
      var top = r.startContainer === E ? E.childNodes[Math.min(r.startOffset, E.childNodes.length - 1)] : topChild(r.startContainer);
      if (top && (top.nodeType === 3 || (top.nodeType === 1 && (INLINE[top.tagName] || (top.tagName === 'DIV' && !top.hasAttribute('data-signature')))))) cmd('formatBlock', 'p');
    }
    tidy();
    // A line break left between blocks is nobody's line.
    for (var stray = E.firstChild; stray; ) {
      var following = stray.nextSibling;
      if (stray.nodeType === 1 && stray.tagName === 'BR' && E.childNodes.length > 1) stray.remove();
      stray = following;
    }
    if (mode === 'markdown') {
      // A list made by indenting a task is a task list; an item moved between kinds follows its list.
      E.querySelectorAll('ul:not([data-type])').forEach(function (list) {
        for (var child = list.firstElementChild; child; child = child.nextElementSibling) {
          if (child.tagName === 'LI' && child.hasAttribute('data-checked')) {
            list.setAttribute('data-type', 'taskList');
            break;
          }
        }
      });
      E.querySelectorAll('li').forEach(function (item) {
        var task = item.parentNode.nodeType === 1 && item.parentNode.getAttribute('data-type') === 'taskList';
        if (task && !item.hasAttribute('data-checked')) item.setAttribute('data-checked', 'false');
        else if (!task && item.hasAttribute('data-checked')) item.removeAttribute('data-checked');
      });
      // Somewhere to type after a block the caret can't leave by itself.
      var last = E.lastElementChild;
      if (last && /^(PRE|HR|BLOCKQUOTE)$/.test(last.tagName)) E.insertAdjacentHTML('beforeend', '<p><br></p>');
    } else {
      var first = E.firstElementChild;
      if (first && first.hasAttribute('data-signature')) E.insertAdjacentHTML('afterbegin', '<p><br></p>');
    }
    E.classList.toggle('is-empty', isEmpty());
  }

  function setContent(content) {
    var tree = mode === 'markdown' ? Md.mdToTree(content) : Md.htmlToTree(normalize(content), 'html');
    applying = true;
    E.innerHTML = Md.treeToHtml(tree) || '<p><br></p>';
    fixup();
    applying = false;
    if (pending) clearTimeout(pending);
    pending = 0;
    lastRange = null;
    // What the document now reads as, so only a real edit is reported.
    var read = serialize();
    lastContent = read.content;
    // Mail sends an opened draft as the editor reads it, also when nothing is changed (the web's onCreate).
    if (mode === 'html') post({ t: 'read', content: read.content, text: read.text, written: read.written, body: bodyText() });
    measure();
    marksSoon();
  }

  /** Runs one of our own edits: not typing, then the usual tidying and telling. */
  function edit(run) {
    if (!editable) return;
    restore();
    applying = true;
    try {
      run();
      fixup();
    } finally {
      applying = false;
    }
    changed();
  }

  // -------------------------------------------------------------- commands

  function inList() {
    var r = range();
    return r ? closest(r.startContainer, 'ul,ol') : null;
  }
  function leaveLists() {
    for (var guard = 0; guard < 8 && inList(); guard++) cmd('outdent');
  }
  function setList(kind) {
    var list = inList();
    var task = !!list && list.getAttribute('data-type') === 'taskList';
    var current = !list ? null : list.tagName === 'OL' ? 'ol' : task ? 'task' : 'ul';
    if (current === kind) {
      cmd(list.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
      return;
    }
    if (kind === 'ol') cmd('insertOrderedList');
    else if (!list || list.tagName === 'OL') cmd('insertUnorderedList');
    list = inList();
    if (!list) return;
    if (kind === 'task') list.setAttribute('data-type', 'taskList');
    else {
      list.removeAttribute('data-type');
      for (var item = list.firstElementChild; item; item = item.nextElementSibling) item.removeAttribute('data-checked');
    }
  }
  function setQuote(on) {
    var r = range();
    if (!r) return;
    var quote = closest(r.startContainer, 'blockquote');
    if (on === undefined) on = !quote;
    if (!on) {
      if (quote) cmd('outdent');
      return;
    }
    if (quote || closest(r.startContainer, 'li')) return;
    // WebKit indents with a blockquote of its own; without its looks it is ours.
    cmd('indent');
    r = range();
    quote = r && closest(r.startContainer, 'blockquote');
    if (quote) {
      quote.removeAttribute('class');
      quote.removeAttribute('style');
      return;
    }
    var block = r && topChild(r.startContainer);
    if (block && block.nodeType === 1) {
      var wrapper = document.createElement('blockquote');
      block.replaceWith(wrapper);
      wrapper.appendChild(block);
      caretIn(block, true);
    }
  }
  function setHeading(level) {
    if (mode !== 'markdown') return;
    var r = range();
    if (!r) return;
    var block = blockOf(r.startContainer);
    if (level && block && block.tagName === 'H' + level) level = 0;
    leaveLists();
    cmd('formatBlock', level ? 'h' + level : 'p');
  }
  function setCodeBlock(lang) {
    if (mode !== 'markdown') return;
    var r = range();
    if (!r) return;
    if (closest(r.startContainer, 'pre')) {
      cmd('formatBlock', 'p');
      return;
    }
    leaveLists();
    cmd('formatBlock', 'pre');
    r = range();
    var pre = r && closest(r.startContainer, 'pre');
    if (pre && lang) pre.setAttribute('data-lang', lang);
  }
  function insertRule() {
    if (mode !== 'markdown') return;
    leaveLists();
    var r = range();
    var block = r && topChild(r.startContainer);
    var rule = document.createElement('hr');
    // After the line the caret is on; in its place when that line is empty.
    if (block && block.nodeType === 1 && block.tagName === 'P' && block.textContent === '') block.replaceWith(rule);
    else if (block) block.after(rule);
    else E.appendChild(rule);
    var next = rule.nextElementSibling;
    if (!next || next.tagName === 'HR') {
      rule.insertAdjacentHTML('afterend', '<p><br></p>');
      next = rule.nextElementSibling;
    }
    caretIn(next, false);
  }
  function toggleCode() {
    var r = range();
    if (!r) return;
    var code = closest(r.startContainer, 'code');
    if (code && !closest(code, 'pre')) {
      var text = code.textContent;
      var s = selection();
      var whole = document.createRange();
      whole.selectNode(code);
      s.removeAllRanges();
      s.addRange(whole);
      cmd('insertText', text);
      return;
    }
    if (r.collapsed || closest(r.startContainer, 'pre')) return;
    wrapCode(r, r.toString());
  }
  /**
   * Puts `text` as inline code in place of the range, the caret after it.
   * By hand: WebKit's own insert turns <code> into a styled span. The
   * zero-width space gives the caret a place outside the code; it never
   * reaches the content.
   */
  function wrapCode(r, text) {
    if (!text) return;
    var code = document.createElement('code');
    code.textContent = text;
    r.deleteContents();
    r.insertNode(code);
    var gap = document.createTextNode('\u200b');
    code.after(gap);
    select(gap, 1);
  }
  /** A link's address as the web normalizes it: `example.com` becomes `https://example.com`. */
  function address(url) {
    url = String(url || '').trim();
    if (!url) return '';
    if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = 'https://' + url;
    return Md.safeHref(url) || '';
  }
  function setLink(url) {
    var r = range();
    if (!r) return;
    var link = closest(r.startContainer, 'a');
    var href = address(url);
    if (link && (r.collapsed || link.contains(r.endContainer))) {
      // The whole link, as tiptap's extendMarkRange.
      r = document.createRange();
      r.selectNodeContents(link);
      var s = selection();
      s.removeAllRanges();
      s.addRange(r);
    }
    if (!href) {
      if (!r.collapsed) cmd('unlink');
      return;
    }
    if (r.collapsed) cmd('insertHTML', '<a href="' + Md.escape(href) + '">' + Md.escape(href) + '</a>');
    else cmd('createLink', href);
  }
  function setFontSize(size) {
    if (mode !== 'html') return;
    var r = range();
    if (!r || r.collapsed) return;
    size = /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/.test(size || '') ? size : null;
    // The browser marks the selection with <font size>; those become the span mail reads.
    cmd('fontSize', '7');
    var first = null;
    var last = null;
    E.querySelectorAll('font[size="7"]').forEach(function (font) {
      font.querySelectorAll('span').forEach(function (span) {
        span.style.fontSize = '';
        if (!span.getAttribute('style')) span.replaceWith.apply(span, Array.prototype.slice.call(span.childNodes));
      });
      var outer = closest(font.parentNode, 'span[style*="font-size"]');
      var made;
      if (size || outer) {
        made = document.createElement('span');
        // Inside a sized stretch, "normal" is the message's own size again.
        made.style.fontSize = size || '14px';
        while (font.firstChild) made.appendChild(font.firstChild);
        font.replaceWith(made);
        first = first || made;
        last = made;
      } else {
        var children = Array.prototype.slice.call(font.childNodes);
        font.replaceWith.apply(font, children);
        first = first || children[0];
        last = children[children.length - 1] || last;
      }
    });
    if (first && last) {
      var whole = document.createRange();
      whole.setStartBefore(first);
      whole.setEndAfter(last);
      var s = selection();
      s.removeAllRanges();
      s.addRange(whole);
    }
  }
  function insertHtml(html) {
    var clean = Md.treeToFragment(Md.htmlToTree(normalize(html), mode));
    if (clean) cmd('insertHTML', clean);
  }
  /** The signature as one block at the end; swapping mailboxes swaps it whole (the web's replaceSignature). */
  function setSignature(html) {
    if (mode !== 'html') return;
    var tree = Md.htmlToTree(normalize(html), 'html').filter(function (block) { return block.tag !== 'sig'; });
    var found = E.querySelector(':scope > div[data-signature]');
    var body = tree.length ? Md.treeToHtml(tree) : '';
    if (found) {
      if (body) found.innerHTML = body;
      else found.remove();
    } else if (body) {
      // A blank line keeps the signature apart from what is written above it.
      E.insertAdjacentHTML('beforeend', '<p><br></p><div data-signature="">' + body + '</div>');
    }
  }

  var IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  /** Pictures start at most this wide. */
  var IMAGE_START_WIDTH = 600;
  var MAX_WIDTH = 1200;
  var KEEP_BYTES = 300 * 1024;
  function insertImage(src, width) {
    if (mode !== 'html') return;
    var html = '<img src="' + Md.escape(src) + '"' + (width ? ' width="' + Math.round(Math.min(width, IMAGE_START_WIDTH)) + '"' : '') + '>';
    insertHtml(html);
  }
  function readAsDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }
  /** A pasted or dropped picture as a data URL; large photos are scaled down (the web's prepareImage). */
  function prepareImage(file) {
    return createImageBitmap(file).then(function (bitmap) {
      var width = bitmap.width;
      var height = bitmap.height;
      if (file.type === 'image/gif' || (file.size <= KEEP_BYTES && width <= MAX_WIDTH)) {
        bitmap.close();
        return readAsDataUrl(file).then(function (src) { return { src: src, width: width }; });
      }
      var scale = Math.min(1, MAX_WIDTH / width);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      var type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('encode')); }, type, 0.85);
      })
        .then(readAsDataUrl)
        .then(function (src) { return { src: src, width: canvas.width }; });
    });
  }
  function imageFiles(data) {
    var files = [];
    if (!data || !data.files) return files;
    for (var i = 0; i < data.files.length; i++) {
      if (IMAGE_TYPES.indexOf(data.files[i].type) >= 0) files.push(data.files[i]);
    }
    return files;
  }
  function insertImages(files) {
    files.forEach(function (file) {
      prepareImage(file).then(
        function (image) { edit(function () { insertImage(image.src, image.width); }); },
        function () { post({ t: 'failed', what: 'image' }); }
      );
    });
  }

  var COMMANDS = {
    bold: function () { cmd('bold'); },
    italic: function () { cmd('italic'); },
    underline: function () { if (mode === 'html') cmd('underline'); },
    strike: function () { cmd('strikeThrough'); },
    code: toggleCode,
    bulletList: function () { setList('ul'); },
    orderedList: function () { setList('ol'); },
    taskList: function () { if (mode === 'markdown') setList('task'); },
    quote: function () { setQuote(); },
    codeBlock: function () { setCodeBlock(); },
    rule: insertRule,
    heading: setHeading,
    link: setLink,
    fontSize: setFontSize,
    image: function (image) { insertImage(image.src, image.width); },
    html: insertHtml,
    signature: setSignature,
    undo: function () { cmd('undo'); },
    redo: function () { cmd('redo'); },
  };
  function exec(name, value) {
    if (name === 'editLink') return openLink();
    var run = COMMANDS[name];
    if (run) edit(function () { run(value); });
  }

  // ----------------------------------------------------- typing shortcuts

  /** Takes away what was typed up to the caret in this block, then turns the block into something. */
  function replaceMarker(block, r, make) {
    var typed = before(block, r);
    var s = selection();
    s.removeAllRanges();
    s.addRange(typed);
    cmd('delete');
    make();
    return true;
  }
  /** `# `, `- `, `1. `, `[ ] `, `> `, ``` and --- at the start of a line, as tiptap's input rules. */
  function blockRules(r) {
    var block = blockOf(r.startContainer);
    if (!block || block.tagName === 'PRE') return false;
    var typed = before(block, r).toString().replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
    var paragraph = (block.tagName === 'P' || block.tagName === 'DIV') && !closest(block, 'li');
    var m;
    if (mode === 'markdown' && paragraph && /^(---|—-|___ |\*\*\* )$/.test(typed)) return replaceMarker(block, r, insertRule);
    if (typed.charAt(typed.length - 1) !== ' ') return false;
    var marker = typed.slice(0, -1);
    if (block.tagName === 'LI') {
      var list = block.parentNode;
      if (mode === 'markdown' && list.tagName === 'UL' && list.getAttribute('data-type') !== 'taskList' && (m = /^\[( |x|X)?\]$/.exec(marker))) {
        return replaceMarker(block, r, function () {
          list.setAttribute('data-type', 'taskList');
          block.setAttribute('data-checked', m[1] && m[1] !== ' ' ? 'true' : 'false');
        });
      }
      return false;
    }
    if (!paragraph) return false;
    if (/^[-+*]$/.test(marker)) return replaceMarker(block, r, function () { setList('ul'); });
    if ((m = /^(\d{1,9})\.$/.exec(marker))) {
      return replaceMarker(block, r, function () {
        setList('ol');
        var list = inList();
        if (list && m[1] !== '1') list.setAttribute('start', m[1]);
      });
    }
    if (marker === '>') return replaceMarker(block, r, function () { setQuote(true); });
    if (mode !== 'markdown') return false;
    if ((m = /^(#{1,6})$/.exec(marker))) return replaceMarker(block, r, function () { cmd('formatBlock', 'h' + m[1].length); });
    if ((m = /^\[( |x|X)?\]$/.exec(marker))) {
      return replaceMarker(block, r, function () {
        setList('task');
        var now = range();
        var item = now && closest(now.startContainer, 'li');
        if (item) item.setAttribute('data-checked', m[1] && m[1] !== ' ' ? 'true' : 'false');
      });
    }
    if ((m = /^```([a-z]*)$/.exec(marker))) return replaceMarker(block, r, function () { setCodeBlock(m[1]); });
    return false;
  }
  /** `**bold**`, `*italic*`, `~~strike~~` and `` `code` `` as they are closed. */
  function markRules(r) {
    var node = r.startContainer;
    if (node.nodeType !== 3 || closest(node, 'code,pre')) return false;
    var text = node.data.slice(0, r.startOffset);
    var m;
    var tag;
    var command;
    var width;
    if ((m = /(^|[^`])`([^`]+)`$/.exec(text))) {
      tag = 'code';
      width = 1;
    } else if ((m = /(^|\s)\*\*([^*\s][^*]*)\*\*$/.exec(text)) || (m = /(^|\s)__([^_\s][^_]*)__$/.exec(text))) {
      tag = 'b';
      command = 'bold';
      width = 2;
    } else if ((m = /(^|\s)~~([^~\s][^~]*)~~$/.exec(text))) {
      tag = 'strike';
      command = 'strikeThrough';
      width = 2;
    } else if ((m = /(^|\s)\*([^*\s][^*]*)\*$/.exec(text)) || (m = /(^|\s)_([^_\s][^_]*)_$/.exec(text))) {
      tag = 'i';
      command = 'italic';
      width = 1;
    } else return false;
    var start = m.index + m[1].length;
    var typed = select(node, start, node, r.startOffset);
    if (tag === 'code') {
      wrapCode(typed, m[2]);
      return true;
    }
    cmd('insertHTML', '<' + tag + '>' + Md.escape(m[2]) + '</' + tag + '>');
    // Before the mark is switched off below: tidying later would move the caret and switch it on again.
    tidy();
    // What is typed next is plain again, as tiptap drops the mark after its rule.
    if (command && document.queryCommandState(command)) cmd(command);
    return true;
  }
  /** A web address followed by a space becomes a link (tiptap's autolink). */
  function linkRule(r) {
    var node = r.startContainer;
    if (node.nodeType !== 3 || closest(node, 'a,code,pre')) return false;
    var text = node.data.slice(0, r.startOffset).replace(/\u00a0/g, ' ');
    var m = /(^|\s)(https?:\/\/[^\s]+?)([.,;:!?)]*) $/.exec(text);
    if (!m || !Md.safeHref(m[2])) return false;
    var start = m.index + m[1].length;
    select(node, start, node, start + m[2].length);
    cmd('createLink', m[2]);
    // Back behind the space that was typed.
    var s = selection();
    s.collapseToEnd();
    for (var step = 0; step <= m[3].length; step++) s.modify('move', 'forward', 'character');
    return true;
  }
  function afterEnter() {
    var r = range();
    if (!r) return;
    var block = blockOf(r.startContainer);
    // Enter at the end of a heading goes on in a paragraph.
    if (block && /^H[1-6]$/.test(block.tagName) && block.textContent === '') cmd('formatBlock', 'p');
    var item = closest(r.startContainer, 'li');
    if (item && item.hasAttribute('data-checked')) item.setAttribute('data-checked', 'false');
  }

  E.addEventListener('input', function (event) {
    if (applying) return;
    applying = true;
    try {
      var type = event.inputType || '';
      var r = range();
      if (type === 'insertParagraph') afterEnter();
      else if (r && r.collapsed && (type === '' || type === 'insertText' || type === 'insertReplacementText')) blockRules(r) || markRules(r) || linkRule(r);
      fixup();
    } finally {
      applying = false;
    }
    changed();
  });

  // ------------------------------------------------------------------ keys

  var KEYS = { Enter: 'enter', Escape: 'escape', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ' ': 'space', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown' };
  /** The keys as the app writes shortcuts: `cmd-shift-x`, `escape`. */
  function comboOf(event) {
    var key = event.key;
    if (!key || key === 'Meta' || key === 'Shift' || key === 'Alt' || key === 'Control' || key === 'Dead' || key === 'Unidentified' || key === 'CapsLock') return null;
    var name;
    // Option and shift change what a key types; its place on the keyboard says which it is.
    if ((event.altKey || event.shiftKey) && /^Digit\d$/.test(event.code)) name = event.code.slice(5);
    else if (event.altKey && /^Key[A-Z]$/.test(event.code)) name = event.code.slice(3).toLowerCase();
    else if (KEYS[key]) name = KEYS[key];
    else name = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
    return (event.metaKey ? 'cmd-' : '') + (event.ctrlKey ? 'ctrl-' : '') + (event.altKey ? 'alt-' : '') + (event.shiftKey ? 'shift-' : '') + name;
  }

  function enterKey() {
    var r = range();
    if (!r) return false;
    var pre = closest(r.startContainer, 'pre');
    if (pre) {
      // Three Enters at the end of a code block leave it, as tiptap does.
      if (r.collapsed && rangeText(after(pre, r)).replace(/\n$/, '') === '' && /\n\n$/.test(rangeText(before(pre, r)))) {
        edit(function () {
          var s = selection();
          s.modify('extend', 'backward', 'character');
          s.modify('extend', 'backward', 'character');
          cmd('delete');
          pre.insertAdjacentHTML('afterend', '<p><br></p>');
          caretIn(pre.nextElementSibling, false);
        });
        return true;
      }
      edit(function () { cmd('insertLineBreak'); });
      return true;
    }
    if (!r.collapsed) return false;
    var block = blockOf(r.startContainer);
    var item = closest(r.startContainer, 'li');
    var m;
    if (mode === 'markdown' && block && !item && (block.tagName === 'P' || block.tagName === 'DIV') && (m = /^```([a-z]*)$/.exec(before(block, r).toString())) && after(block, r).toString() === '') {
      edit(function () { replaceMarker(block, r, function () { setCodeBlock(m[1]); }); });
      return true;
    }
    // Enter on an empty item leaves the list, one level at a time.
    if (item && ownText(item) === '' && !item.querySelector('ul,ol')) {
      edit(function () { cmd('outdent'); });
      return true;
    }
    // Enter on an empty line in a quote leaves the quote.
    if (block && !item && closest(block, 'blockquote') && block.textContent.replace(/\u200b/g, '') === '') {
      edit(function () { cmd('outdent'); });
      return true;
    }
    return false;
  }
  function backspaceKey() {
    var r = range();
    if (!r || !r.collapsed) return false;
    var block = blockOf(r.startContainer);
    if (!block || !atStart(block, r)) return false;
    // At the start of a heading or code block, Backspace makes it a paragraph again.
    if (/^(H[1-6]|PRE)$/.test(block.tagName)) {
      edit(function () { cmd('formatBlock', 'p'); });
      return true;
    }
    var quote = closest(block, 'blockquote');
    if (quote && !closest(block, 'li') && (quote.firstElementChild === block || quote.firstChild === block || block === quote)) {
      edit(function () { cmd('outdent'); });
      return true;
    }
    return false;
  }
  function tabKey(back) {
    var r = range();
    if (!r) return false;
    var item = closest(r.startContainer, 'li');
    if (item) {
      // Deeper only under an item before it, as tiptap's sinkListItem.
      if (back) edit(function () { cmd('outdent'); });
      else if (item.previousElementSibling) edit(function () { cmd('indent'); });
      return true;
    }
    if (!back && closest(r.startContainer, 'pre')) {
      edit(function () { cmd('insertText', '\t'); });
      return true;
    }
    return false;
  }

  /** Shortcuts the editor answers itself. The rest of ⌘… goes to the app. */
  var SHORTCUTS = {
    'cmd-b': 'bold',
    'cmd-i': 'italic',
    'cmd-u': 'underline',
    'cmd-shift-x': 'strike',
    'cmd-shift-s': 'strike',
    'cmd-e': 'code',
    'cmd-shift-7': 'orderedList',
    'cmd-shift-8': 'bulletList',
    'cmd-shift-9': 'taskList',
    'cmd-shift-b': 'quote',
    'cmd-alt-c': 'codeBlock',
    'cmd-z': 'undo',
    'cmd-shift-z': 'redo',
    'cmd-y': 'redo',
  };
  /** What stays the system's or the browser's own: moving and deleting by line, windows, the emoji picker. */
  var NATIVE = /^cmd-(shift-)?(left|right|up|down|backspace|delete|home|end)$|^cmd-(q|w|h|m|`|tab|space)$|^cmd-ctrl-|^cmd-alt-(h|m|escape)$/;

  /**
   * One key combination. `true`: it was ours, the browser must not act on it too.
   * Also called by the app, for combinations the window saw before the page did.
   */
  function combo(name) {
    if (!editable && name !== 'escape' && name.indexOf('cmd-') !== 0) return false;
    if (SHORTCUTS[name]) {
      exec(SHORTCUTS[name]);
      return true;
    }
    var m = /^cmd-alt-([0-6])$/.exec(name);
    if (m) {
      exec('heading', +m[1]);
      return true;
    }
    switch (name) {
      case 'cmd-k':
        openLink();
        return true;
      case 'enter':
        return enterKey();
      case 'backspace':
        return backspaceKey();
      case 'tab':
      case 'shift-tab':
        if (!tabKey(name !== 'tab')) post({ t: 'key', key: name });
        return true;
      case 'escape':
        // What was typed last reaches the app first: Escape may close what the editor is in.
        flush();
        post({ t: 'key', key: name });
        return true;
      // The Edit menu does these when the app has one; otherwise they arrive here.
      case 'cmd-a':
        caretIn(E, false);
        selection().selectAllChildren(E);
        return true;
      case 'cmd-c':
        if (!cmd('copy')) post({ t: 'copy', text: selection().toString() });
        return true;
      case 'cmd-x':
        if (editable && !cmd('cut')) {
          post({ t: 'copy', text: selection().toString() });
          edit(function () { cmd('delete'); });
        }
        return true;
      case 'cmd-v':
      case 'cmd-shift-v':
        if (editable) post({ t: 'paste', plain: name !== 'cmd-v' });
        return true;
    }
    if (name.indexOf('cmd-') === 0 && !NATIVE.test(name)) {
      post({ t: 'key', key: name });
      return true;
    }
    return false;
  }

  E.addEventListener('keydown', function (event) {
    if (event.isComposing) return;
    var name = comboOf(event);
    if (name && combo(name)) event.preventDefault();
  });

  // ----------------------------------------------------------------- paste

  function pasteContent(text, html, plain) {
    edit(function () {
      var r = range();
      if (!r) return;
      text = String(text || '').replace(/\r\n?/g, '\n');
      if (closest(r.startContainer, 'pre')) {
        if (text) cmd('insertHTML', Md.escape(text).replace(/\n/g, '<br>'));
        return;
      }
      if (html && !plain) {
        var clean = Md.treeToFragment(Md.htmlToTree(normalize(html), mode));
        if (clean) {
          cmd('insertHTML', clean);
          return;
        }
      }
      if (!text) return;
      var one = text.trim();
      // An address pasted over words links them (tiptap's linkOnPaste).
      if (!r.collapsed && /^https?:\/\/\S+$/.test(one) && Md.safeHref(one)) {
        cmd('createLink', one);
        return;
      }
      if (mode === 'markdown' && !plain && Md.looksLikeMarkdown(text)) cmd('insertHTML', Md.treeToFragment(Md.mdToTree(text)));
      else if (one.indexOf('\n') >= 0) cmd('insertHTML', Md.treeToFragment(Md.textToTree(text)));
      else cmd('insertText', text);
    });
  }
  E.addEventListener('paste', function (event) {
    event.preventDefault();
    var data = event.clipboardData;
    if (!data || !editable) return;
    var html = data.getData('text/html');
    var files = imageFiles(data);
    // Copied web content brings its own pictures along in the HTML.
    if (mode === 'html' && files.length && !html) insertImages(files);
    else pasteContent(data.getData('text/plain'), html, false);
  });
  E.addEventListener('dragstart', function () { internalDrag = true; });
  E.addEventListener('dragend', function () { internalDrag = false; });
  E.addEventListener('dragover', function (event) {
    if (!internalDrag) event.preventDefault();
  });
  E.addEventListener('drop', function (event) {
    // Moving text inside the editor is the browser's own.
    if (internalDrag) return;
    event.preventDefault();
    if (!editable) return;
    var data = event.dataTransfer;
    var at = document.caretRangeFromPoint ? document.caretRangeFromPoint(event.clientX, event.clientY) : null;
    if (at && E.contains(at.startContainer)) {
      var s = selection();
      s.removeAllRanges();
      s.addRange(at);
    }
    var files = imageFiles(data);
    if (mode === 'html' && files.length) insertImages(files);
    else if (data) pasteContent(data.getData('text/plain'), data.getData('text/html'), false);
  });

  // ----------------------------------------------------------------- mouse

  E.addEventListener('mousedown', function (event) {
    var item = event.target;
    if (!editable || item.nodeType !== 1 || !item.matches('li[data-checked]')) return;
    var box = item.getBoundingClientRect();
    var line = parseFloat(getComputedStyle(item).lineHeight) || 24;
    // The box is drawn in the item's left padding (editor.css).
    if (event.clientX - box.left > 22 || event.clientY - box.top > line + 4) return;
    event.preventDefault();
    item.setAttribute('data-checked', item.getAttribute('data-checked') === 'true' ? 'false' : 'true');
    changed();
  });
  E.addEventListener('click', function (event) {
    var link = closest(event.target, 'a');
    if (!link) return;
    event.preventDefault();
    // Editing a link's words needs plain clicks; ⌘-click follows it. Read-only text follows at once.
    if (event.metaKey || !editable) post({ t: 'link', url: link.getAttribute('href') || '' });
  });

  // ------------------------------------------------------------ link field

  var field = document.getElementById('link');
  var fieldInput = field.querySelector('input');
  var fieldRange = null;
  var fieldOpen = false;
  function openLink() {
    if (!editable) return;
    restore();
    var r = range();
    if (!r) return;
    var link = closest(r.startContainer, 'a');
    // As on the web: a link is put on selected words, or changed where the caret is in one.
    if (r.collapsed && !link) return;
    fieldRange = r.cloneRange();
    fieldInput.value = link ? link.getAttribute('href') || '' : '';
    var box = r.collapsed ? link.getBoundingClientRect() : r.getBoundingClientRect();
    fieldOpen = true;
    if (bubble) bubble.hidden = true;
    field.hidden = false;
    var width = field.offsetWidth;
    var height = field.offsetHeight;
    var left = Math.max(8, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 8));
    var top = box.top - height - 8 >= 4 ? box.top - height - 8 : box.bottom + 8;
    field.style.left = left + window.scrollX + 'px';
    field.style.top = top + window.scrollY + 'px';
    fieldInput.focus();
    fieldInput.select();
  }
  function closeLink(apply) {
    if (!fieldOpen) return;
    fieldOpen = false;
    field.hidden = true;
    E.focus();
    if (fieldRange) {
      var s = selection();
      s.removeAllRanges();
      s.addRange(fieldRange);
    }
    fieldRange = null;
    if (apply) exec('link', fieldInput.value);
  }
  fieldInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeLink(true);
    } else if (event.key === 'Escape') {
      // Handled here, so Escape doesn't also close what the editor is in.
      event.preventDefault();
      closeLink(false);
    }
    event.stopPropagation();
  });
  fieldInput.addEventListener('blur', function () {
    if (!fieldOpen) return;
    fieldOpen = false;
    field.hidden = true;
    fieldRange = null;
    flush();
    post({ t: 'blur' });
  });

  // ------------------------------------------------- what the app is told

  function marks() {
    var out = { bold: false, italic: false, underline: false, strike: false, code: false, link: null, heading: 0, bulletList: false, orderedList: false, taskList: false, quote: false, codeBlock: false, fontSize: null, range: false };
    var r = range();
    if (!r) return out;
    var list = false;
    for (var node = r.startContainer; node && node !== E; node = node.parentNode) {
      if (node.nodeType !== 1) continue;
      var tag = node.tagName;
      if (tag === 'B' || tag === 'STRONG') out.bold = true;
      else if (tag === 'I' || tag === 'EM') out.italic = true;
      else if (tag === 'U') out.underline = true;
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') out.strike = true;
      else if (tag === 'CODE') out.code = true;
      else if (tag === 'A') out.link = out.link || node.getAttribute('href') || '';
      else if (tag === 'SPAN' && node.style.fontSize) out.fontSize = out.fontSize || node.style.fontSize;
      else if (/^H[1-6]$/.test(tag)) out.heading = +tag.charAt(1);
      else if (tag === 'BLOCKQUOTE') out.quote = true;
      else if (tag === 'PRE') out.codeBlock = true;
      else if ((tag === 'UL' || tag === 'OL') && !list) {
        // The innermost list, as tiptap's isActive.
        list = true;
        if (tag === 'OL') out.orderedList = true;
        else if (node.getAttribute('data-type') === 'taskList') out.taskList = true;
        else out.bulletList = true;
      }
    }
    // What the next typed letter will be: ⌘B with nothing selected changes no element yet.
    try {
      if (!out.heading && document.queryCommandState('bold')) out.bold = true;
      if (document.queryCommandState('italic')) out.italic = true;
      if (document.queryCommandState('strikeThrough')) out.strike = true;
      if (mode === 'html' && out.link === null && document.queryCommandState('underline')) out.underline = true;
    } catch (error) {
      /* The element walk above stands. */
    }
    out.range = !r.collapsed;
    return out;
  }
  var marksQueued = false;
  function marksSoon() {
    if (marksQueued) return;
    marksQueued = true;
    requestAnimationFrame(function () {
      marksQueued = false;
      if (!range()) return;
      var now = marks();
      var text = JSON.stringify(now);
      if (text === lastMarks) return;
      lastMarks = text;
      post({ t: 'selection', marks: now });
    });
  }
  document.addEventListener('selectionchange', function () {
    var r = range();
    if (r) lastRange = r.cloneRange();
    marksSoon();
  });

  /** How tall the content is, so a host can give the view exactly that. */
  function measure() {
    var style = getComputedStyle(E);
    var last = E.lastElementChild;
    var bottom = last ? last.offsetTop + last.offsetHeight : parseFloat(style.paddingTop) || 0;
    var height = Math.ceil(bottom + (parseFloat(style.paddingBottom) || 0));
    if (height === lastHeight) return;
    lastHeight = height;
    post({ t: 'height', px: height });
  }
  if (window.ResizeObserver) new ResizeObserver(measure).observe(E);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  E.addEventListener('focus', function () {
    if (!fieldOpen) post({ t: 'focus' });
  });
  E.addEventListener('blur', function () {
    if (fieldOpen) return;
    // What was typed last reaches the app before it hears the editor was left.
    flush();
    post({ t: 'blur' });
  });

  // ------------------------------------------------------- mail: the body

  function signatureBlock() {
    return mode === 'html' ? E.querySelector(':scope > div[data-signature]') : null;
  }
  /** Everything above the signature, the blank line before it included (the web's bodyRange). */
  function bodyNodes() {
    var end = signatureBlock();
    var nodes = [];
    for (var node = E.firstChild; node && node !== end; node = node.nextSibling) nodes.push(node);
    return nodes;
  }
  /** What is written above the signature, as plain text (the web's bodyText). */
  function bodyText() {
    var html = '';
    bodyNodes().forEach(function (node) { html += node.nodeType === 1 ? node.outerHTML : Md.escape(node.textContent || ''); });
    return Md.htmlToEmail(html).text;
  }
  /** `html` as the editor holds it, without a signature of its own. */
  function bodyHtml(html) {
    var tree = Md.htmlToTree(normalize(html), 'html').filter(function (block) { return block.tag !== 'sig'; });
    return Md.treeToHtml(tree);
  }
  /** Everything above the signature becomes `html`, as one undo step; the blank line before the signature stays. */
  function setBody(html) {
    if (mode !== 'html') return;
    edit(function () {
      var end = signatureBlock();
      var nodes = bodyNodes();
      var last = nodes[nodes.length - 1];
      var r = document.createRange();
      r.setStart(E, 0);
      // Up to the end of the last line, never past it: a selection that touches the signature takes its text along.
      if (last && last.nodeType === 1) r.setEnd(last, last.childNodes.length);
      else if (end) r.setEndBefore(end);
      else r.setEnd(E, E.childNodes.length);
      var s = selection();
      s.removeAllRanges();
      s.addRange(r);
      // The browser leaves what follows the selection alone while it cannot be edited.
      if (end) end.contentEditable = 'false';
      var content = bodyHtml(html) + (end ? '<p><br></p>' : '');
      cmd('insertHTML', content || '<p><br></p>');
      if (end) end.removeAttribute('contenteditable');
    });
    if (E.firstElementChild) caretIn(E.firstElementChild, false);
  }
  /** The elements above the signature before text started streaming in, kept as they are so undo still knows them. */
  var beforeStream = null;
  function startStream() {
    if (mode !== 'html' || beforeStream) return;
    beforeStream = { nodes: bodyNodes(), away: false };
  }
  function quietly(run) {
    applying = true;
    try {
      run();
    } finally {
      applying = false;
    }
    E.classList.toggle('is-empty', isEmpty());
    changed();
  }
  function streamedNodes() {
    return bodyNodes().filter(function (node) { return beforeStream.nodes.indexOf(node) < 0; });
  }
  /** Shows text as it is written, without filling the undo history. */
  function streamBody(html) {
    if (!beforeStream) return;
    quietly(function () {
      var end = signatureBlock();
      if (!beforeStream.away) beforeStream.nodes.forEach(function (node) { node.remove(); });
      else streamedNodes().forEach(function (node) { node.remove(); });
      beforeStream.away = true;
      var content = (bodyHtml(html) || '<p><br></p>') + (end ? '<p><br></p>' : '');
      if (end) end.insertAdjacentHTML('beforebegin', content);
      else E.insertAdjacentHTML('afterbegin', content);
    });
  }
  function restoreBeforeStream() {
    var saved = beforeStream;
    if (!saved) return false;
    if (saved.away) {
      quietly(function () {
        var end = signatureBlock();
        streamedNodes().forEach(function (node) { node.remove(); });
        saved.nodes.forEach(function (node) { E.insertBefore(node, end); });
      });
    }
    beforeStream = null;
    return true;
  }
  /** The result as a single undo step back to how it was. */
  function finishStream(html) {
    restoreBeforeStream();
    setBody(html);
  }
  function cancelStream() {
    restoreBeforeStream();
  }

  // ------------------------------------------------ mail: the format menu

  // The web's bubble menu (FormatMenu in rich-text-editor.tsx): formatting
  // appears on the selection, so the writing surface stays empty.
  var bubble = null;
  var bubbleLabels = null;
  var bubbleIcons = {};
  var choosingSize = false;
  var TEXT_SIZES = [['small', '12px'], ['normal', ''], ['large', '18px'], ['huge', '24px']];
  var TOOLS = ['bold', 'italic', 'underline', 'strike', 'link', 'size', 'bulletList', 'orderedList', 'quote'];
  function drawBubble() {
    var now = marks();
    var html = '';
    if (choosingSize) {
      TEXT_SIZES.forEach(function (size) {
        var on = (now.fontSize || '') === size[1];
        html += '<button type="button" class="size' + (on ? ' on' : '') + '" data-size="' + size[1] + '" aria-pressed="' + on + '"' + (size[1] ? ' style="font-size:' + size[1] + '"' : '') + '>' + Md.escape((bubbleLabels.sizes || {})[size[0]] || size[0]) + '</button>';
      });
    } else {
      TOOLS.forEach(function (tool) {
        var on = tool === 'size' ? now.fontSize !== null : tool === 'link' ? now.link !== null : !!now[tool];
        html += '<button type="button"' + (on ? ' class="on"' : '') + ' data-tool="' + tool + '" aria-pressed="' + on + '" aria-label="' + Md.escape(bubbleLabels[tool] || tool) + '">' + (bubbleIcons[tool] || '') + '</button>';
      });
    }
    if (bubble.innerHTML !== html) bubble.innerHTML = html;
  }
  function showBubble() {
    if (!bubble || !bubbleLabels) return;
    var r = range();
    if (!r || r.collapsed) choosingSize = false;
    if (!editable || fieldOpen || !r || r.collapsed || document.activeElement !== E) {
      bubble.hidden = true;
      return;
    }
    drawBubble();
    bubble.hidden = false;
    var box = r.getBoundingClientRect();
    var width = bubble.offsetWidth;
    var height = bubble.offsetHeight;
    var left = Math.max(8, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 8));
    var top = box.top - height - 8 >= 4 ? box.top - height - 8 : box.bottom + 8;
    bubble.style.left = left + window.scrollX + 'px';
    bubble.style.top = top + window.scrollY + 'px';
  }
  var bubbleQueued = false;
  function bubbleSoon() {
    if (!bubble || bubbleQueued) return;
    bubbleQueued = true;
    requestAnimationFrame(function () {
      bubbleQueued = false;
      showBubble();
    });
  }
  /** Turns the menu on with its words and signs, or off with nothing. */
  function setBubble(config) {
    bubbleLabels = config && mode === 'html' ? config.labels || {} : null;
    bubbleIcons = (config && config.icons) || {};
    if (!bubbleLabels) {
      if (bubble) bubble.hidden = true;
      return;
    }
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'bubble';
      bubble.hidden = true;
      document.body.appendChild(bubble);
      // Keeps the text selected; a normal click would move focus off it.
      bubble.addEventListener('mousedown', function (event) { event.preventDefault(); });
      bubble.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('button') : null;
        if (!button) return;
        if (button.hasAttribute('data-size')) {
          exec('fontSize', button.getAttribute('data-size') || null);
          choosingSize = false;
        } else {
          var tool = button.getAttribute('data-tool');
          if (tool === 'link') {
            bubble.hidden = true;
            return openLink();
          }
          if (tool === 'size') choosingSize = true;
          else exec(tool);
        }
        showBubble();
      });
      document.addEventListener('selectionchange', bubbleSoon);
      E.addEventListener('focus', bubbleSoon);
      E.addEventListener('blur', bubbleSoon);
      E.addEventListener('input', bubbleSoon);
      window.addEventListener('scroll', bubbleSoon, true);
      window.addEventListener('resize', bubbleSoon);
    }
    bubbleSoon();
  }

  // ----------------------------------------------------------- for the app

  function setTheme(vars) {
    for (var name in vars) {
      if (name === 'scheme') root.style.colorScheme = vars[name];
      else root.style.setProperty('--' + name, vars[name]);
    }
  }
  function setPlaceholder(text) {
    // As a CSS string, for the ::before in editor.css.
    root.style.setProperty('--placeholder', JSON.stringify(String(text || '')));
  }
  function setEditable(on) {
    editable = !!on;
    E.contentEditable = editable ? 'true' : 'false';
    root.classList.toggle('read-only', !editable);
    if (!editable && fieldOpen) closeLink(false);
  }

  window.__even = {
    set: setContent,
    theme: setTheme,
    look: setTheme,
    placeholder: setPlaceholder,
    editable: setEditable,
    exec: exec,
    combo: combo,
    paste: function (text, plain) { pasteContent(text, '', !!plain); },
    focus: function (where) {
      E.focus();
      if (where === 'start') caretIn(E.firstElementChild || E, false);
      else if (where === 'end') caretIn(E.lastElementChild || E, true);
      else restore();
    },
    blur: function () { E.blur(); },
    /** Mail: the text above the signature (AI writing), and the format menu on the selection. */
    setBody: setBody,
    startStream: startStream,
    streamBody: streamBody,
    finishStream: finishStream,
    cancelStream: cancelStream,
    bubble: setBubble,
    /** For tests and the demo: typing without a keyboard, and a look at the document. */
    debug: {
      type: function (text) {
        restore();
        for (var i = 0; i < text.length; i++) {
          var c = text.charAt(i);
          if (c === '\n') {
            if (!combo('enter')) {
              cmd('insertParagraph');
              E.dispatchEvent(new InputEvent('input', { inputType: 'insertParagraph' }));
            }
          } else {
            cmd('insertText', c);
          }
        }
      },
      html: function () { return E.innerHTML; },
      content: function () { return serialize().content; },
      marks: marks,
      caret: function (selector, atEnd) {
        var target = selector ? E.querySelector(selector) : E.lastElementChild;
        if (target) caretIn(target, atEnd !== false);
      },
      selectText: function (text) {
        var walker = document.createTreeWalker(E, NodeFilter.SHOW_TEXT);
        for (var node = walker.nextNode(); node; node = walker.nextNode()) {
          var at = node.data.indexOf(text);
          if (at >= 0) return !!select(node, at, node, at + text.length);
        }
        return false;
      },
    },
  };

  // ------------------------------------------- notes: the blocks "/" offers
  // apps/notes-web/src/components/note-editor.tsx: "/" at the start of a
  // paragraph lists what the line can become; typing on narrows the list,
  // ↑ ↓ choose, Enter makes it, Escape puts the list away.

  var slashBlocks = null;
  var slashEmpty = '';
  var slashBox = null;
  /** The open list: the paragraph it is for, what is typed after the "/", the chosen row. */
  var slash = null;
  /** The line the list was put away on with Escape: it stays away until the line changes. */
  var slashShut = null;
  function slashOptions() {
    var query = slash.query.toLowerCase();
    return slashBlocks.filter(function (block) { return block.label.toLowerCase().indexOf(query) >= 0; });
  }
  function readSlash() {
    if (!slashBlocks || !editable || mode !== 'markdown') return null;
    var r = range();
    if (!r || !r.collapsed) return null;
    var block = blockOf(r.startContainer);
    if (!block || block.tagName !== 'P') return null;
    var m = /^\/([^\n]*)$/.exec(block.textContent.replace(/​/g, ''));
    return m ? { block: block, query: m[1], index: 0 } : null;
  }
  function drawSlash() {
    if (!slash) {
      if (slashBox) slashBox.hidden = true;
      return;
    }
    if (!slashBox) {
      slashBox = document.createElement('div');
      slashBox.id = 'slash';
      slashBox.setAttribute('role', 'listbox');
      // A press on the list must not take the caret out of the text.
      slashBox.addEventListener('mousedown', function (event) { event.preventDefault(); });
      document.body.appendChild(slashBox);
    }
    var options = slashOptions();
    var chosen = null;
    slashBox.textContent = '';
    if (!options.length) {
      var none = document.createElement('p');
      none.textContent = slashEmpty;
      slashBox.appendChild(none);
    }
    options.forEach(function (option, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === slash.index % options.length ? 'true' : 'false');
      row.textContent = option.label;
      row.addEventListener('click', function () { applySlash(option.id); });
      slashBox.appendChild(row);
      if (index === slash.index % options.length) chosen = row;
    });
    var r = range();
    var line = (r && r.getClientRects()[0]) || slash.block.getBoundingClientRect();
    var box = E.getBoundingClientRect();
    slashBox.hidden = false;
    slashBox.style.left = box.left + (parseFloat(getComputedStyle(E).paddingLeft) || 0) + window.scrollX + 'px';
    slashBox.style.top = line.bottom + window.scrollY + 4 + 'px';
    if (chosen) chosen.scrollIntoView({ block: 'nearest' });
    else slashBox.scrollIntoView({ block: 'nearest' });
  }
  function updateSlash() {
    var next = readSlash();
    if (next && slashShut === next.block.textContent) next = null;
    else slashShut = null;
    if (next && slash && slash.block === next.block && slash.query === next.query) next.index = slash.index;
    slash = next;
    drawSlash();
  }
  /** The line loses its "/…" and becomes the block (the web's deleteRange and formatBlock). */
  function applySlash(id) {
    var block = slash && slash.block;
    slash = null;
    drawSlash();
    if (!block || !E.contains(block)) return;
    edit(function () {
      var whole = document.createRange();
      whole.selectNodeContents(block);
      var s = selection();
      s.removeAllRanges();
      s.addRange(whole);
      cmd('delete');
      if (/^h[1-3]$/.test(id)) cmd('formatBlock', id);
      else if (id === 'bulletList') setList('ul');
      else if (id === 'orderedList') setList('ol');
      else if (id === 'taskList') setList('task');
      else if (id === 'blockquote') setQuote(true);
      else if (id === 'codeBlock') setCodeBlock();
      else if (id === 'horizontalRule') insertRule();
    });
  }
  // Before the editor's own keys: while the list is open, these are the list's.
  document.addEventListener('keydown', function (event) {
    if (!slash || event.isComposing) return;
    var options = slashOptions();
    var key = event.key;
    if (key === 'Escape') {
      slashShut = slash.block.textContent;
      slash = null;
      drawSlash();
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && options.length) {
      slash.index = ((slash.index % options.length) + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      drawSlash();
    } else if (key === 'Enter' && options.length) {
      applySlash(options[slash.index % options.length].id);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  E.addEventListener('input', updateSlash);
  E.addEventListener('blur', function () {
    slash = null;
    drawSlash();
  });
  document.addEventListener('selectionchange', updateSlash);
  /** Turns the list on: `{ blocks: [{ id, label }], empty }`, or `null` for off. */
  window.__even.slash = function (config) {
    slashBlocks = config && config.blocks && config.blocks.length ? config.blocks : null;
    slashEmpty = (config && config.empty) || '';
    updateSlash();
  };
  window.__even.debug.slash = function () {
    return slash ? slashOptions().map(function (option) { return option.label; }) : null;
  };

  // ------------------------------------ for a host that scrolls the editor
  // An issue's description (src/todo/description.rs) is as tall as its text
  // and sits in a pane the app scrolls. The view then covers only the part of
  // the text that pane has in sight: the page is told how far down that part
  // starts, never scrolls by itself, and hands the wheel to the app.

  var fitted = false;
  var fitTop = 0;
  var wheelSum = 0;
  var wheelQueued = false;
  function sendWheel(dy) {
    wheelSum += dy;
    if (wheelQueued) return;
    wheelQueued = true;
    requestAnimationFrame(function () {
      wheelQueued = false;
      var sum = wheelSum;
      wheelSum = 0;
      if (sum) post({ t: 'wheel', dy: sum });
    });
  }
  /** Asks the app to scroll when the caret is outside the part in sight. */
  function revealCaret() {
    if (!fitted || document.activeElement !== E) return;
    var r = range();
    if (!r || !r.collapsed) return;
    var line = r.getClientRects()[0] || (blockOf(r.startContainer) || E).getBoundingClientRect();
    if (line.bottom > window.innerHeight) sendWheel(line.bottom - window.innerHeight + 8);
    else if (line.top < 0) sendWheel(line.top - 8);
  }
  window.__even.scroll = function (top) {
    if (!fitted) {
      fitted = true;
      root.classList.add('fitted');
      window.addEventListener('wheel', function (event) {
        // A pinch is not a scroll.
        if (event.ctrlKey) return;
        event.preventDefault();
        sendWheel(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY);
      }, { passive: false });
      // The browser moves the page to follow the caret; it goes back, and the app scrolls instead.
      window.addEventListener('scroll', function () {
        if (Math.abs(window.scrollY - fitTop) >= 0.5) window.scrollTo(0, fitTop);
      });
      window.addEventListener('resize', function () { window.scrollTo(0, fitTop); });
      E.addEventListener('input', revealCaret);
      E.addEventListener('keyup', revealCaret);
    }
    fitTop = Math.max(0, +top || 0);
    window.scrollTo(0, fitTop);
  };

  cmd('defaultParagraphSeparator', 'p');
  cmd('styleWithCSS', 'false');
  setTheme(init.theme || {});
  setTheme(init.look || {});
  setPlaceholder(init.placeholder);
  field.hidden = true;
  fieldInput.placeholder = init.linkPlaceholder || '';
  setContent('');
  setEditable(init.editable !== false);
  post({ t: 'ready' });
})();
