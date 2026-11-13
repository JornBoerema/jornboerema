// The rich text editor's converters, as pure string functions: no DOM, so
// `node scripts/editor-test.mjs` can test them. src/editor.rs puts this file
// in the editor's document before editor.js.
//
// Everything goes through one small tree:
//   blocks: {tag:'p'|'h1'…'h6'|'blockquote'|'pre'|'ul'|'ol'|'hr'|'sig', attrs, children}
//   a list's children are {tag:'li', attrs:{checked?}, inline:[…], blocks:[…]}
//   inline: a string, or {tag:'strong'|'em'|'u'|'s'|'code'|'a'|'span'|'br'|'img', attrs, children}
// Markdown and HTML are both read into it and written from it, so what the
// editor shows (HTML) and what the app keeps (markdown, or mail HTML) agree.
var EvenMd = (function () {
  'use strict';

  var PUNCT = /[!-\/:-@\[-`{-~]/;
  var SPACE = /\s/;

  function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', hellip: '…', ndash: '–', mdash: '—', copy: '©', euro: '€' };
  function decodeEntity(body) {
    if (body.charAt(0) === '#') {
      var hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      var code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!(code > 0 && code < 0x110000) || (code >= 0xd800 && code < 0xe000)) return null;
      return String.fromCodePoint(code);
    }
    var known = ENTITIES[body] || ENTITIES[body.toLowerCase()];
    return known === undefined ? null : known;
  }
  function decode(text) {
    if (text.indexOf('&') < 0) return text;
    return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,10});/g, function (all, body) {
      var value = decodeEntity(body);
      return value === null ? all : value;
    });
  }

  /** Addresses a link may have. Anything with another scheme (javascript:, data:) is refused. */
  function safeHref(href) {
    href = String(href || '').trim();
    if (!href || /[\u0000-\u001f]/.test(href)) return null;
    var scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
    if (scheme && !/^(https?|mailto|tel)$/i.test(scheme[1])) return null;
    return href;
  }

  // ---------------------------------------------------------------- HTML in

  var VOID = { br: 1, hr: 1, img: 1, input: 1, meta: 1, link: 1, wbr: 1, col: 1, area: 1, base: 1, embed: 1, source: 1, track: 1, param: 1 };
  /** Elements whose text is not markup; it is skipped whole. */
  var RAW = { script: 1, style: 1, title: 1, textarea: 1, noscript: 1, iframe: 1, xmp: 1 };
  var CLOSES_P = { address: 1, article: 1, aside: 1, blockquote: 1, div: 1, dl: 1, fieldset: 1, footer: 1, form: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, header: 1, hr: 1, main: 1, nav: 1, ol: 1, p: 1, pre: 1, section: 1, table: 1, ul: 1 };

  /**
   * A small tolerant HTML reader. In the app the browser first rewrites pasted
   * HTML into well-formed markup, so this mostly sees clean input; whatever it
   * makes of the rest is still only data for `clean`, which builds its own tags.
   */
  function parseHtml(html) {
    var root = { tag: '#root', attrs: {}, children: [] };
    var stack = [root];
    var i = 0;
    var n = html.length;
    var open = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/y;
    var attr = /\s*([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
    var end = /\s*(\/?)>/y;
    function top() {
      return stack[stack.length - 1];
    }
    function text(value) {
      if (value) top().children.push(decode(value));
    }
    while (i < n) {
      var lt = html.indexOf('<', i);
      if (lt < 0) {
        text(html.slice(i));
        break;
      }
      if (lt > i) text(html.slice(i, lt));
      if (html.startsWith('<!--', lt)) {
        var close = html.indexOf('-->', lt + 4);
        i = close < 0 ? n : close + 3;
        continue;
      }
      if (html.charAt(lt + 1) === '!' || html.charAt(lt + 1) === '?') {
        var gt = html.indexOf('>', lt);
        i = gt < 0 ? n : gt + 1;
        continue;
      }
      open.lastIndex = lt;
      var m = open.exec(html);
      if (!m) {
        text('<');
        i = lt + 1;
        continue;
      }
      var tag = m[2].toLowerCase();
      var attrs = {};
      var at = open.lastIndex;
      for (;;) {
        end.lastIndex = at;
        var done = end.exec(html);
        if (done) {
          at = end.lastIndex;
          break;
        }
        attr.lastIndex = at;
        var a = attr.exec(html);
        if (!a || attr.lastIndex === at) {
          // Not a tag after all: skip to its end, or drop the rest.
          var stop = html.indexOf('>', at);
          at = stop < 0 ? n : stop + 1;
          break;
        }
        var name = a[1].toLowerCase();
        if (!(name in attrs)) attrs[name] = decode(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '');
        at = attr.lastIndex;
      }
      i = at;
      if (m[1]) {
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === tag) {
            stack.length = s;
            break;
          }
        }
        continue;
      }
      if (CLOSES_P[tag]) {
        // A block ends the paragraph it starts in, and the marks left open in it.
        for (var p = stack.length - 1; p > 0 && (stack[p].tag === 'p' || !BLOCK[stack[p].tag]); p--) {
          if (stack[p].tag === 'p') {
            stack.length = p;
            break;
          }
        }
      }
      if (tag === 'li') {
        for (var l = stack.length - 1; l > 0; l--) {
          if (stack[l].tag === 'ul' || stack[l].tag === 'ol') break;
          if (stack[l].tag === 'li') {
            stack.length = l;
            break;
          }
        }
      }
      var node = { tag: tag, attrs: attrs, children: [] };
      top().children.push(node);
      if (VOID[tag]) continue;
      if (RAW[tag]) {
        var rest = html.slice(i).search(new RegExp('</' + tag + '\\s*>', 'i'));
        if (rest < 0) i = n;
        else i = html.indexOf('>', i + rest) + 1;
        continue;
      }
      stack.push(node);
    }
    return root.children;
  }

  // ------------------------------------------------------------------ clean

  var DROP = { script: 1, style: 1, head: 1, title: 1, meta: 1, link: 1, iframe: 1, object: 1, embed: 1, svg: 1, math: 1, noscript: 1, template: 1, button: 1, select: 1, textarea: 1, canvas: 1, video: 1, audio: 1, input: 1, base: 1, xmp: 1, applet: 1, frame: 1, frameset: 1 };
  var BLOCK = { p: 1, div: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, blockquote: 1, pre: 1, ul: 1, ol: 1, li: 1, hr: 1, table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1, caption: 1, section: 1, article: 1, header: 1, footer: 1, main: 1, nav: 1, aside: 1, figure: 1, figcaption: 1, address: 1, dl: 1, dt: 1, dd: 1, center: 1, form: 1, fieldset: 1, details: 1, summary: 1, body: 1, html: 1 };
  var MARK = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', ins: 'u', s: 's', strike: 's', del: 's' };

  function isBlock(node) {
    return typeof node !== 'string' && BLOCK[node.tag] === 1;
  }
  /** Whether a block sits anywhere under these nodes: then they are a container, not a line of text. */
  function hasBlock(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string' || DROP[node.tag]) continue;
      if (BLOCK[node.tag] || hasBlock(node.children)) return true;
    }
    return false;
  }
  function textOf(nodes) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') out += node;
      else if (node.tag === 'br') out += '\n';
      else if (!DROP[node.tag]) out += textOf(node.children);
    }
    return out;
  }
  function styleOf(node, name) {
    var style = node.attrs.style;
    if (!style) return '';
    var m = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'i').exec(style);
    return m ? m[1].trim().toLowerCase() : '';
  }
  var IMAGE_SRC = /^(data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+|https?:\/\/[^\s"'<>]+|cid:[^\s"'<>]+)$/i;
  var FONT_SIZE = /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/;

  function inlineNode(tag, attrs, children) {
    return { tag: tag, attrs: attrs || {}, children: children || [] };
  }
  function wrapMarks(nodes, marks) {
    for (var i = marks.length - 1; i >= 0; i--) {
      if (!nodes.length) break;
      nodes = [inlineNode(marks[i].tag, marks[i].attrs, nodes)];
    }
    return nodes;
  }
  function pushText(out, text) {
    if (!text) return;
    if (typeof out[out.length - 1] === 'string') out[out.length - 1] += text;
    else out.push(text);
  }

  /** The marks an inline element stands for, by its tag and its style. */
  function marksOf(node, mode) {
    var marks = [];
    var tag = node.tag;
    var weight = styleOf(node, 'font-weight');
    var named = MARK[tag];
    // Google Docs wraps what it copies in <b style="font-weight:normal">.
    if (named === 'strong' && (weight === 'normal' || weight === '400')) named = null;
    if (named === 'u' && mode !== 'html') named = null;
    if (named) marks.push({ tag: named, attrs: {} });
    if (tag === 'a') {
      var href = safeHref(node.attrs.href);
      if (href) marks.push({ tag: 'a', attrs: node.attrs.title ? { href: href, title: node.attrs.title } : { href: href } });
    }
    if (node.attrs.style && tag !== 'a') {
      if (named !== 'strong' && /^(bold|bolder|[6-9]00)$/.test(weight)) marks.push({ tag: 'strong', attrs: {} });
      if (named !== 'em' && styleOf(node, 'font-style') === 'italic') marks.push({ tag: 'em', attrs: {} });
      var line = styleOf(node, 'text-decoration') + ' ' + styleOf(node, 'text-decoration-line');
      if (named !== 's' && line.indexOf('line-through') >= 0) marks.push({ tag: 's', attrs: {} });
      if (mode === 'html') {
        if (named !== 'u' && line.indexOf('underline') >= 0) marks.push({ tag: 'u', attrs: {} });
        var size = styleOf(node, 'font-size');
        if (FONT_SIZE.test(size)) marks.push({ tag: 'span', attrs: { size: size } });
      }
    }
    return marks;
  }

  /** Inline content: text and marks. Anything unknown is unwrapped to its text. */
  function cleanInline(nodes, mode, out) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') {
        pushText(out, node.replace(/\u200b/g, '').replace(/[ \t\r\n\f]+/g, ' '));
        continue;
      }
      var tag = node.tag;
      if (DROP[tag]) continue;
      if (tag === 'br') {
        out.push(inlineNode('br'));
        continue;
      }
      if (tag === 'img') {
        var src = node.attrs.src || '';
        if (mode === 'html' && IMAGE_SRC.test(src)) {
          var attrs = { src: src };
          if (/^\d{1,5}$/.test(node.attrs.width || '')) attrs.width = node.attrs.width;
          if (/^\d{1,5}$/.test(node.attrs.height || '')) attrs.height = node.attrs.height;
          if (node.attrs.alt) attrs.alt = node.attrs.alt;
          out.push(inlineNode('img', attrs));
        }
        continue;
      }
      if (tag === 'code' || tag === 'tt' || tag === 'kbd' || tag === 'samp') {
        var code = textOf(node.children).replace(/\u200b/g, '').replace(/\s+/g, ' ');
        if (code) out.push(inlineNode('code', {}, [code]));
        continue;
      }
      var inner = [];
      cleanInline(node.children, mode, inner);
      var wrapped = wrapMarks(inner, marksOf(node, mode));
      for (var w = 0; w < wrapped.length; w++) {
        if (typeof wrapped[w] === 'string') pushText(out, wrapped[w]);
        else out.push(wrapped[w]);
      }
    }
    return out;
  }

  function trimEdge(nodes, start) {
    while (nodes.length) {
      var index = start ? 0 : nodes.length - 1;
      var node = nodes[index];
      if (typeof node === 'string') {
        var trimmed = start ? node.replace(/^[ \t\r\n]+/, '') : node.replace(/[ \t\r\n]+$/, '');
        if (trimmed) {
          nodes[index] = trimmed;
          return;
        }
        nodes.splice(index, 1);
        continue;
      }
      if (node.tag === 'br' || node.tag === 'img' || node.tag === 'code') return;
      trimEdge(node.children, start);
      if (node.children.length) return;
      nodes.splice(index, 1);
    }
  }
  /** A line of text as a block holds it: no space at its edges, no `<br>` that only closes it. */
  function finishInline(nodes) {
    trimEdge(nodes, true);
    trimEdge(nodes, false);
    var last = nodes[nodes.length - 1];
    if (last && last.tag === 'br') {
      nodes.pop();
      trimEdge(nodes, false);
    }
    return nodes;
  }
  function onlySpace(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (typeof nodes[i] !== 'string' || /\S/.test(nodes[i].replace(/\u200b/g, ''))) return false;
    }
    return true;
  }

  function findCheckbox(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') {
        if (/\S/.test(node)) return null;
        continue;
      }
      if (node.tag === 'input') return (node.attrs.type || '').toLowerCase() === 'checkbox' ? { checked: 'checked' in node.attrs } : null;
      if (node.tag === 'label' || node.tag === 'p' || node.tag === 'div' || node.tag === 'span') return findCheckbox(node.children);
      return null;
    }
    return null;
  }

  function cleanItem(node, mode, marks) {
    var blocks = cleanBlocks(node.children, mode, marks);
    var item = { tag: 'li', attrs: {}, inline: [], blocks: blocks };
    if (blocks.length && blocks[0].tag === 'p') item.inline = blocks.shift().children;
    if (mode === 'markdown') {
      if (node.attrs['data-checked'] !== undefined) item.attrs.checked = node.attrs['data-checked'] === 'true';
      else {
        var box = findCheckbox(node.children);
        if (box) item.attrs.checked = box.checked;
      }
    }
    return item;
  }

  function cleanList(node, mode, marks) {
    var list = { tag: node.tag, attrs: {}, children: [] };
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (typeof child === 'string') continue;
      if (child.tag === 'li') {
        list.children.push(cleanItem(child, mode, marks));
      } else if (child.tag === 'ul' || child.tag === 'ol') {
        // WebKit nests a list straight under a list when a line is indented.
        var nested = cleanList(child, mode, marks);
        if (!nested.children.length) continue;
        if (!list.children.length) list.children.push({ tag: 'li', attrs: {}, inline: [], blocks: [] });
        list.children[list.children.length - 1].blocks.push(nested);
      } else if (!DROP[child.tag]) {
        list.children.push(cleanItem({ tag: 'li', attrs: {}, children: [child] }, mode, marks));
      }
    }
    if (mode === 'markdown') {
      var task = node.attrs['data-type'] === 'taskList' || / contains-task-list /.test(' ' + (node.attrs['class'] || '') + ' ');
      for (var t = 0; t < list.children.length && !task; t++) task = list.children[t].attrs.checked !== undefined;
      if (task && node.tag === 'ul') {
        list.attrs.task = true;
        for (var c = 0; c < list.children.length; c++) list.children[c].attrs.checked = list.children[c].attrs.checked === true;
      } else {
        for (var d = 0; d < list.children.length; d++) delete list.children[d].attrs.checked;
      }
    }
    if (node.tag === 'ol' && /^\d{1,9}$/.test(node.attrs.start || '') && node.attrs.start !== '1') list.attrs.start = parseInt(node.attrs.start, 10);
    return list;
  }

  /**
   * Blocks out of whatever HTML holds: only the tags the editor knows come
   * out, built here, so no script, style or handler survives.
   * `mode` is 'markdown' (notes, descriptions) or 'html' (mail).
   */
  function cleanBlocks(nodes, mode, marks) {
    marks = marks || [];
    var out = [];
    var run = [];
    function flush() {
      if (!run.length) return;
      var keep = !onlySpace(run);
      var inline = finishInline(wrapMarks(run, marks));
      run = [];
      if (keep) out.push({ tag: 'p', attrs: {}, children: inline });
    }
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') {
        cleanInline([node], mode, run);
        continue;
      }
      var tag = node.tag;
      if (DROP[tag]) continue;
      if (!BLOCK[tag]) {
        if (hasBlock(node.children)) {
          // A mark around blocks (<b><p>…</p></b>): the blocks stay, the mark moves inside.
          flush();
          out = out.concat(cleanBlocks(node.children, mode, marks.concat(marksOf(node, mode))));
        } else {
          cleanInline([node], mode, run);
        }
        continue;
      }
      flush();
      if (tag === 'hr') {
        if (mode === 'markdown') out.push({ tag: 'hr', attrs: {}, children: [] });
      } else if (tag === 'ul' || tag === 'ol') {
        var list = cleanList(node, mode, marks);
        if (list.children.length) out.push(list);
      } else if (tag === 'pre') {
        var code = textOf(node.children).replace(/\u200b/g, '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
        if (mode === 'markdown') {
          var lang = node.attrs['data-lang'] || '';
          for (var c = 0; c < node.children.length && !lang; c++) {
            var m = /(?:^|\s)language-([\w+#.-]+)/.exec((node.children[c].attrs && node.children[c].attrs['class']) || '');
            if (m) lang = m[1];
          }
          out.push({ tag: 'pre', attrs: /^[\w+#.-]{1,32}$/.test(lang) ? { lang: lang } : {}, children: code ? [code] : [] });
        } else {
          var lines = code.split('\n');
          var inline = [];
          for (var l = 0; l < lines.length; l++) {
            if (l) inline.push(inlineNode('br'));
            if (lines[l]) inline.push(lines[l]);
          }
          out.push({ tag: 'p', attrs: {}, children: inline });
        }
      } else if (tag === 'blockquote') {
        var quoted = cleanBlocks(node.children, mode, marks);
        out.push({ tag: 'blockquote', attrs: {}, children: quoted.length ? quoted : [{ tag: 'p', attrs: {}, children: [] }] });
      } else if (mode === 'html' && tag === 'div' && node.attrs['data-signature'] !== undefined) {
        out.push({ tag: 'sig', attrs: {}, children: cleanBlocks(node.children, mode, marks) });
      } else if (hasBlock(node.children)) {
        out = out.concat(cleanBlocks(node.children, mode, marks));
      } else {
        var heading = mode === 'markdown' && /^h[1-6]$/.test(tag);
        var text = finishInline(wrapMarks(cleanInline(node.children, mode, []), marks));
        // An empty <p> is a blank line; an empty <div> is nothing, unless a <br> held it open.
        if (!text.length && tag !== 'p' && !heading && !node.children.some(function (child) { return child.tag === 'br'; })) continue;
        if (!text.length && heading) continue;
        out.push({ tag: heading ? tag : 'p', attrs: {}, children: text });
      }
    }
    flush();
    return out;
  }

  function htmlToTree(html, mode) {
    return cleanBlocks(parseHtml(String(html || '')), mode === 'html' ? 'html' : 'markdown');
  }

  // --------------------------------------------------------------- HTML out

  /** Mail clients ignore stylesheets, so spacing lives on the elements (the web's toEmailHtml). */
  var EMAIL_STYLE = {
    p: 'margin:0',
    ul: 'margin:0;padding-left:1.5em',
    ol: 'margin:0;padding-left:1.5em',
    blockquote: 'margin:0;padding-left:12px;border-left:2px solid #d0d0d0;color:#555555',
    code: 'font-family:monospace;background:#f2f2f2;padding:1px 4px;border-radius:3px',
    img: 'max-width:100%;height:auto',
  };

  function inlineHtml(nodes, opts) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') out += esc(node).replace(/\u00a0/g, '&nbsp;');
      else if (node.tag === 'br') out += '<br>';
      else if (node.tag === 'img') {
        out += '<img src="' + esc(node.attrs.src) + '"';
        if (node.attrs.width) out += ' width="' + esc(node.attrs.width) + '"';
        if (node.attrs.height && !opts.email) out += ' height="' + esc(node.attrs.height) + '"';
        if (node.attrs.alt) out += ' alt="' + esc(node.attrs.alt) + '"';
        out += (opts.email ? ' style="' + EMAIL_STYLE.img + '"' : '') + '>';
      } else if (node.tag === 'a') {
        out += '<a href="' + esc(node.attrs.href) + '"' + (node.attrs.title ? ' title="' + esc(node.attrs.title) + '"' : '') + (opts.email ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + inlineHtml(node.children, opts) + '</a>';
      } else if (node.tag === 'span') {
        out += '<span style="font-size:' + esc(node.attrs.size) + '">' + inlineHtml(node.children, opts) + '</span>';
      } else if (node.tag === 'code') {
        out += '<code' + (opts.email ? ' style="' + EMAIL_STYLE.code + '"' : '') + '>' + inlineHtml(node.children, opts) + '</code>';
      } else {
        out += '<' + node.tag + '>' + inlineHtml(node.children, opts) + '</' + node.tag + '>';
      }
    }
    return out;
  }
  /** A block's text for the editor: an empty one, or one ending in a break, needs a `<br>` to hold the caret. */
  function lineHtml(nodes, opts) {
    var html = inlineHtml(nodes, opts);
    if (!nodes.length) return opts.editor || opts.email ? '<br>' : '';
    var last = nodes[nodes.length - 1];
    if (opts.editor && last.tag === 'br') html += '<br>';
    return html;
  }
  function style(tag, opts) {
    return opts.email && EMAIL_STYLE[tag] ? ' style="' + EMAIL_STYLE[tag] + '"' : '';
  }
  function blocksHtml(blocks, opts) {
    var out = '';
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var tag = block.tag;
      if (tag === 'hr') out += '<hr>';
      else if (tag === 'pre') {
        var code = block.children[0] || '';
        // The parser drops a newline right after <pre>; a second one keeps a first empty line.
        out += '<pre' + (block.attrs.lang ? ' data-lang="' + esc(block.attrs.lang) + '"' : '') + '>' + (code ? (code.charAt(0) === '\n' ? '\n' : '') + esc(code) : opts.editor ? '<br>' : '') + '</pre>';
      } else if (tag === 'blockquote') out += '<blockquote' + style(tag, opts) + '>' + blocksHtml(block.children, opts) + '</blockquote>';
      else if (tag === 'sig') out += '<div data-signature="">' + blocksHtml(block.children, opts) + '</div>';
      else if (tag === 'ul' || tag === 'ol') {
        out += '<' + tag + (block.attrs.task ? ' data-type="taskList"' : '') + (block.attrs.start ? ' start="' + block.attrs.start + '"' : '') + style(tag, opts) + '>';
        for (var l = 0; l < block.children.length; l++) {
          var item = block.children[l];
          // In the editor a list under an item follows the item, as WebKit's own
          // indenting writes it: its Tab, Shift-Tab and Enter then keep working.
          var inside = '';
          var following = '';
          for (var b = 0; b < item.blocks.length; b++) {
            var nested = blocksHtml([item.blocks[b]], opts);
            if (opts.editor && (item.blocks[b].tag === 'ul' || item.blocks[b].tag === 'ol')) following += nested;
            else inside += nested;
          }
          out += '<li' + (block.attrs.task ? ' data-checked="' + (item.attrs.checked ? 'true' : 'false') + '"' : '') + '>';
          out += (item.inline.length || !inside ? lineHtml(item.inline, opts) : '') + inside + '</li>' + following;
        }
        out += '</' + tag + '>';
      } else out += '<' + tag + style(tag, opts) + '>' + lineHtml(block.children, opts) + '</' + tag + '>';
    }
    return out;
  }
  /** What the editor shows. */
  function treeToHtml(blocks) {
    return blocksHtml(blocks, { editor: true });
  }
  /** For putting in at the caret: a single line stays a line, so it joins the paragraph it lands in. */
  function treeToFragment(blocks) {
    if (blocks.length === 1 && blocks[0].tag === 'p') return inlineHtml(blocks[0].children, { editor: true });
    return blocksHtml(blocks, { editor: true });
  }

  // --------------------------------------------------------------- text out

  function inlineText(nodes) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') out += node.replace(/\u00a0/g, ' ');
      else if (node.tag === 'br') out += '\n';
      else if (node.tag !== 'img') out += inlineText(node.children);
    }
    return out;
  }
  /** One line per paragraph, so the plain version keeps the same blank lines. */
  function blocksText(blocks, lines) {
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.tag === 'hr') continue;
      if (block.tag === 'pre') lines.push(block.children[0] || '');
      else if (block.tag === 'ul' || block.tag === 'ol') {
        for (var l = 0; l < block.children.length; l++) {
          lines.push(inlineText(block.children[l].inline));
          blocksText(block.children[l].blocks, lines);
        }
      } else if (block.tag === 'blockquote' || block.tag === 'sig') blocksText(block.children, lines);
      else lines.push(inlineText(block.children));
    }
    return lines;
  }
  function treeToText(blocks) {
    return blocksText(blocks, []).join('\n').trim();
  }
  function hasImage(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') continue;
      if (node.tag === 'img') return true;
      if (node.tag === 'li' ? hasImage(node.inline) || hasImage(node.blocks) : hasImage(node.children)) return true;
    }
    return false;
  }

  /**
   * What mail sends (the web's `emit`): the HTML with its spacing inline, the
   * plain text, and whether something besides the signature was written.
   */
  function treeToEmail(blocks) {
    var text = treeToText(blocks);
    var written = false;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].tag !== 'sig' && (treeToText([blocks[i]]) || hasImage([blocks[i]]))) written = true;
    }
    if (!text && !hasImage(blocks)) return { html: '', text: text, written: written };
    var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">' + blocksHtml(blocks, { email: true }) + '</div>';
    return { html: html, text: text, written: written };
  }

  // ----------------------------------------------------------- markdown out

  function escapeMd(text) {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\\(?=[!-\/:-@\[-`{-~])/g, '\\\\')
      .replace(/&(?=#?[a-zA-Z0-9]{1,10};)/g, '&amp;')
      .replace(/`/g, '\\`')
      .replace(/~~/g, '\\~~')
      .replace(/\*/g, function (star, at, all) {
        var before = at > 0 ? all.charAt(at - 1) : ' ';
        var after = at + 1 < all.length ? all.charAt(at + 1) : ' ';
        return SPACE.test(before) && SPACE.test(after) ? star : '\\*';
      })
      .replace(/_/g, function (bar, at, all) {
        var before = at > 0 ? all.charAt(at - 1) : ' ';
        var after = at + 1 < all.length ? all.charAt(at + 1) : ' ';
        var inWord = /[A-Za-z0-9\u00c0-\uffff]/;
        return inWord.test(before) && inWord.test(after) ? bar : SPACE.test(before) && SPACE.test(after) ? bar : '\\_';
      })
      .replace(/(^|[^!])\[(?=[^\]]*\]\()/g, '$1\\[')
      .replace(/<(?=[a-zA-Z\/!?])/g, '\\<');
  }
  /** Text at the start of a line that markdown would read as a block. */
  function escapeLineStart(line) {
    return line
      .replace(/^(\s*)([-+*])(?=\s|$)/, '$1\\$2')
      .replace(/^(\s*\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
      .replace(/^(\s*)(#{1,6})(?=\s|$)/, '$1\\$2')
      .replace(/^(\s*)>/, '$1\\>')
      .replace(/^(\s*)(=+|-{3,}|_{3,})(\s*)$/, '$1\\$2$3')
      .replace(/^(\s*)(~~~)/, '$1\\$2');
  }
  function wrapMd(mark, inner) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
  }
  function inlineMd(nodes, active) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (typeof node === 'string') {
        out += escapeMd(node);
        continue;
      }
      var tag = node.tag;
      if (tag === 'br') out += '  \n';
      else if (tag === 'img') continue;
      else if (tag === 'code') {
        var code = textOf(node.children);
        var longest = 0;
        (code.match(/`+/g) || []).forEach(function (run) { longest = Math.max(longest, run.length); });
        var fence = '`'.repeat(longest + 1);
        var pad = /^`|`$/.test(code) ? ' ' : '';
        out += fence + pad + code + pad + fence;
      } else if (tag === 'a') {
        var href = node.attrs.href;
        if (/[\s()<>]/.test(href)) href = '<' + href.replace(/[<>]/g, encodeURIComponent) + '>';
        out += '[' + inlineMd(node.children, active) + '](' + href + (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')';
      } else if ((tag === 'strong' || tag === 'em' || tag === 's') && !active[tag]) {
        var inside = Object.assign({}, active);
        inside[tag] = true;
        out += wrapMd(tag === 'strong' ? '**' : tag === 'em' ? '*' : '~~', inlineMd(node.children, inside));
      } else out += inlineMd(node.children, active);
    }
    return out;
  }
  function lineMd(nodes) {
    return inlineMd(nodes, {}).replace(/^[ \t]+|[ \t]+$/g, '').split('\n').map(escapeLineStart).join('\n');
  }
  function indent(text, by) {
    var pad = ' '.repeat(by);
    return text.split('\n').map(function (line) { return line ? pad + line : line; }).join('\n');
  }
  function listMd(list) {
    var lines = [];
    for (var i = 0; i < list.children.length; i++) {
      var item = list.children[i];
      var marker = list.tag === 'ol' ? (list.attrs.start || 1) + i + '. ' : list.attrs.task ? (item.attrs.checked ? '- [x] ' : '- [ ] ') : '- ';
      var by = list.tag === 'ol' ? marker.length : 2;
      var body = lineMd(item.inline);
      for (var b = 0; b < item.blocks.length; b++) {
        var block = item.blocks[b];
        var text = blockMd(block);
        if (text === null) continue;
        var nested = block.tag === 'ul' || block.tag === 'ol';
        body += (body ? (nested && (b === 0 || item.blocks[b - 1].tag === 'ul' || item.blocks[b - 1].tag === 'ol') ? '\n' : '\n\n') : '') + text;
      }
      var first = true;
      lines.push(
        body
          .split('\n')
          .map(function (line) {
            var out = first ? marker + line : line ? ' '.repeat(by) + line : line;
            first = false;
            return out;
          })
          .join('\n')
          .replace(/[ ]+$/, '')
      );
    }
    return lines.join('\n');
  }
  /** One block as markdown; `null` for an empty paragraph, which markdown has no word for. */
  function blockMd(block) {
    var tag = block.tag;
    if (tag === 'hr') return '---';
    if (tag === 'pre') {
      var code = block.children[0] || '';
      var longest = 2;
      (code.match(/^\s*`{3,}/gm) || []).forEach(function (run) { longest = Math.max(longest, run.trim().length); });
      var fence = '`'.repeat(longest + 1);
      return fence + (block.attrs.lang || '') + '\n' + code + '\n' + fence;
    }
    if (tag === 'blockquote') {
      return blocksMd(block.children)
        .split('\n')
        .map(function (line) { return line.trim() === '' ? '>' : '> ' + line; })
        .join('\n');
    }
    if (tag === 'ul' || tag === 'ol') return listMd(block);
    if (tag === 'sig') return blocksMd(block.children);
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(+tag.charAt(1)) + ' ' + inlineMd(block.children, {}).replace(/\s*\n/g, ' ');
    return block.children.length ? lineMd(block.children) : null;
  }
  /** As @tiptap/markdown writes it: a blank line between blocks; a second empty paragraph in a row is `&nbsp;`. */
  function blocksMd(blocks) {
    var out = [];
    var emptyBefore = false;
    for (var i = 0; i < blocks.length; i++) {
      var text = blockMd(blocks[i]);
      if (text === null) {
        if (emptyBefore) out.push('&nbsp;');
        emptyBefore = true;
        continue;
      }
      emptyBefore = false;
      out.push(text);
    }
    return out.join('\n\n');
  }
  function treeToMd(blocks) {
    return blocksMd(blocks);
  }

  // ------------------------------------------------------------ markdown in

  function mergeText(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item && item.d) item = item.d.repeat(item.n);
      if (typeof item === 'string') pushText(out, item);
      else out.push(item);
    }
    return out;
  }

  /** `[label](address "title")` starting at the `[`; null when it isn't one. */
  function readLink(src, at) {
    var depth = 0;
    var i = at;
    var n = src.length;
    for (; i < n; i++) {
      var c = src.charAt(i);
      if (c === '\\') i++;
      else if (c === '`') {
        var ticks = /`+/y;
        ticks.lastIndex = i;
        var run = ticks.exec(src)[0];
        var close = src.indexOf(run, i + run.length);
        i = close < 0 ? i + run.length - 1 : close + run.length - 1;
      } else if (c === '[') depth++;
      else if (c === ']' && --depth === 0) break;
    }
    if (i >= n || src.charAt(i + 1) !== '(') return null;
    var label = src.slice(at + 1, i);
    var dest = /\(\s*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?\s*\)/y;
    dest.lastIndex = i + 1;
    var m = dest.exec(src);
    if (!m) return null;
    var href = (m[1] !== undefined ? m[1] : m[2] || '').replace(/\\([!-\/:-@\[-`{-~])/g, '$1');
    var title = (m[3] !== undefined ? m[3] : m[4] || '').replace(/\\([!-\/:-@\[-`{-~])/g, '$1');
    return { label: label, href: href, title: title, end: dest.lastIndex };
  }

  function resolveEmphasis(items) {
    for (var ci = 0; ci < items.length; ci++) {
      var closer = items[ci];
      if (!closer || !closer.d || !closer.close || closer.n === 0) continue;
      if (closer.d === '~' && closer.n < 2) continue;
      var oi = -1;
      for (var k = ci - 1; k >= 0; k--) {
        var o = items[k];
        if (o && o.d === closer.d && o.open && o.n > 0 && (closer.d !== '~' || o.n >= 2)) {
          oi = k;
          break;
        }
      }
      if (oi < 0) continue;
      var opener = items[oi];
      var use = closer.d === '~' ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
      var node = inlineNode(closer.d === '~' ? 's' : use === 2 ? 'strong' : 'em', {}, mergeText(items.slice(oi + 1, ci)));
      items.splice(oi + 1, ci - oi - 1, node);
      ci = oi + 2;
      opener.n -= use;
      closer.n -= use;
      if (opener.n === 0) {
        items.splice(oi, 1);
        ci--;
      }
      if (closer.n === 0) items.splice(ci, 1);
      ci--;
    }
    return mergeText(items);
  }

  /** The text of a paragraph, heading or list line into marks. */
  function parseInline(src) {
    var items = [];
    var buf = '';
    var i = 0;
    var n = src.length;
    function flush() {
      if (buf) items.push(buf);
      buf = '';
    }
    while (i < n) {
      var c = src.charAt(i);
      if (c === '\\') {
        var next = src.charAt(i + 1);
        if (next && PUNCT.test(next)) {
          buf += next;
          i += 2;
          continue;
        }
        if (next === '\n') {
          flush();
          items.push(inlineNode('br'));
          i += 2;
          while (src.charAt(i) === ' ') i++;
          continue;
        }
      } else if (c === '\n') {
        var hard = / {2,}$/.test(buf);
        buf = buf.replace(/ +$/, '');
        if (hard) {
          flush();
          items.push(inlineNode('br'));
        } else buf += ' ';
        i++;
        while (src.charAt(i) === ' ') i++;
        continue;
      } else if (c === '`') {
        var ticks = /`+/y;
        ticks.lastIndex = i;
        var run = ticks.exec(src)[0];
        var from = i + run.length;
        var close = -1;
        var search = /`+/g;
        search.lastIndex = from;
        for (var found = search.exec(src); found; found = search.exec(src)) {
          if (found[0].length === run.length) {
            close = found.index;
            break;
          }
        }
        if (close >= 0) {
          var code = src.slice(from, close).replace(/\n/g, ' ');
          if (/^ .* $/.test(code) && /[^ ]/.test(code)) code = code.slice(1, -1);
          flush();
          items.push(inlineNode('code', {}, [code]));
          i = close + run.length;
          continue;
        }
        buf += run;
        i = from;
        continue;
      } else if (c === '&') {
        var entity = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,10});/y;
        entity.lastIndex = i;
        var e = entity.exec(src);
        var value = e ? decodeEntity(e[1]) : null;
        if (value !== null) {
          buf += value;
          i = entity.lastIndex;
          continue;
        }
      } else if (c === '<') {
        var auto = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/y;
        auto.lastIndex = i;
        var a = auto.exec(src);
        if (a && safeHref(a[1])) {
          flush();
          items.push(inlineNode('a', { href: a[1] }, [a[1]]));
          i = auto.lastIndex;
          continue;
        }
      } else if (c === '[' || (c === '!' && src.charAt(i + 1) === '[')) {
        var image = c === '!';
        var link = readLink(src, image ? i + 1 : i);
        if (link && image) {
          // Notes have no pictures; the words stay as they were written.
          buf += src.slice(i, link.end);
          i = link.end;
          continue;
        }
        var href = link ? safeHref(link.href) : null;
        if (href) {
          flush();
          items.push(inlineNode('a', link.title ? { href: href, title: link.title } : { href: href }, parseInline(link.label)));
          i = link.end;
          continue;
        }
      } else if (c === '*' || c === '_' || c === '~') {
        var len = 1;
        while (src.charAt(i + len) === c) len++;
        var before = i > 0 ? src.charAt(i - 1) : ' ';
        var after = i + len < n ? src.charAt(i + len) : ' ';
        var left = !SPACE.test(after) && (!PUNCT.test(after) || SPACE.test(before) || PUNCT.test(before));
        var right = !SPACE.test(before) && (!PUNCT.test(before) || SPACE.test(after) || PUNCT.test(after));
        flush();
        items.push({
          d: c,
          n: len,
          open: c === '_' ? left && (!right || PUNCT.test(before)) : left,
          close: c === '_' ? right && (!left || PUNCT.test(after)) : right,
        });
        i += len;
        continue;
      } else if (c === 'h' && (i === 0 || !/[A-Za-z0-9]/.test(src.charAt(i - 1)))) {
        var bare = /https?:\/\/[^\s<]+/y;
        bare.lastIndex = i;
        var u = bare.exec(src);
        if (u) {
          var url = u[0].replace(/[.,;:!?'"*_~)\]]+$/, '');
          if (url.length > 8) {
            flush();
            items.push(inlineNode('a', { href: url }, [url]));
            i += url.length;
            continue;
          }
        }
      }
      buf += c;
      i++;
    }
    flush();
    return resolveEmphasis(items);
  }

  var LIST = /^( *)([-*+]|(\d{1,9})([.)]))( +|$)(.*)$/;
  var RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
  var HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var QUOTE = /^ {0,3}>/;
  function blank(line) {
    return /^\s*$/.test(line);
  }
  function indentOf(line) {
    return /^ */.exec(line)[0].length;
  }
  function startsBlock(line) {
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line);
  }

  function parseList(lines, at, out) {
    var first = LIST.exec(lines[at]);
    var base = first[1].length;
    var ordered = first[3] !== undefined;
    var items = [];
    var i = at;
    while (i < lines.length) {
      var m = LIST.exec(lines[i]);
      if (!m || m[1].length < base || (m[3] !== undefined) !== ordered || RULE.test(lines[i])) break;
      var content = m[1].length + m[2].length + (m[5].length === 0 || m[5].length > 4 ? 1 : m[5].length);
      var body = [m[5].length > 4 ? m[5].slice(1) + m[6] : m[6]];
      i++;
      while (i < lines.length) {
        var line = lines[i];
        if (blank(line)) {
          var j = i;
          while (j < lines.length && blank(lines[j])) j++;
          if (j < lines.length && indentOf(lines[j]) >= content) {
            for (; i < j; i++) body.push('');
            continue;
          }
          break;
        }
        if (indentOf(line) >= content) {
          body.push(line.slice(content));
          i++;
          continue;
        }
        // A line that just runs on belongs to the paragraph above it.
        if (!LIST.test(line) && !startsBlock(line) && !blank(body[body.length - 1])) {
          body.push(line.trim());
          i++;
          continue;
        }
        break;
      }
      items.push(body);
      var skip = i;
      while (skip < lines.length && blank(lines[skip])) skip++;
      if (skip > i) {
        var again = skip < lines.length ? LIST.exec(lines[skip]) : null;
        if (again && again[1].length >= base && again[1].length < base + 2 && (again[3] !== undefined) === ordered && !RULE.test(lines[skip])) i = skip;
        else break;
      }
    }
    var task = !ordered && items.every(function (body) { return /^\[( |x|X)\](\s+|$)/.test(body[0]); });
    var list = { tag: ordered ? 'ol' : 'ul', attrs: {}, children: [] };
    if (task) list.attrs.task = true;
    if (ordered && first[3] !== '1') list.attrs.start = parseInt(first[3], 10);
    items.forEach(function (body) {
      var item = { tag: 'li', attrs: {}, inline: [], blocks: [] };
      if (task) {
        item.attrs.checked = body[0].charAt(1) !== ' ';
        body[0] = body[0].replace(/^\[.\]\s*/, '');
      }
      item.blocks = parseBlocks(body);
      if (item.blocks.length && item.blocks[0].tag === 'p') item.inline = item.blocks.shift().children;
      list.children.push(item);
    });
    out.push(list);
    return i;
  }

  function parseBlocks(lines) {
    var out = [];
    var para = [];
    function flush() {
      if (!para.length) return;
      var text = para.map(function (line) { return line.replace(/^\s+/, ''); }).join('\n').replace(/\s+$/, '');
      para = [];
      out.push({ tag: 'p', attrs: {}, children: text === '&nbsp;' ? [] : parseInline(text) });
    }
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (blank(line)) {
        flush();
        i++;
        continue;
      }
      var m = FENCE.exec(line);
      if (m) {
        flush();
        var code = [];
        var closing = new RegExp('^ {0,3}' + m[2].charAt(0) + '{' + m[2].length + ',}[ \\t]*$');
        i++;
        while (i < lines.length && !closing.test(lines[i])) {
          code.push(lines[i].replace(new RegExp('^ {0,' + m[1].length + '}'), ''));
          i++;
        }
        i++;
        var text = code.join('\n');
        out.push({ tag: 'pre', attrs: /^[\w+#.-]{1,32}$/.test(m[3]) ? { lang: m[3] } : {}, children: text ? [text] : [] });
        continue;
      }
      m = HEADING.exec(line);
      if (m) {
        flush();
        out.push({ tag: 'h' + m[1].length, attrs: {}, children: parseInline((m[2] || '').trim()) });
        i++;
        continue;
      }
      if (para.length && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) {
        // A line of = or - under text makes that text a heading.
        var level = line.trim().charAt(0) === '=' ? 1 : 2;
        var title = para.join('\n').trim();
        para = [];
        out.push({ tag: 'h' + level, attrs: {}, children: parseInline(title) });
        i++;
        continue;
      }
      if (RULE.test(line)) {
        flush();
        out.push({ tag: 'hr', attrs: {}, children: [] });
        i++;
        continue;
      }
      if (QUOTE.test(line)) {
        flush();
        var quoted = [];
        while (i < lines.length && (QUOTE.test(lines[i]) || (!blank(lines[i]) && quoted.length && !blank(quoted[quoted.length - 1]) && !startsBlock(lines[i]) && !LIST.test(lines[i])))) {
          quoted.push(lines[i].replace(/^ {0,3}> ?/, ''));
          i++;
        }
        var inner = parseBlocks(quoted);
        out.push({ tag: 'blockquote', attrs: {}, children: inner.length ? inner : [{ tag: 'p', attrs: {}, children: [] }] });
        continue;
      }
      m = LIST.exec(line);
      // Only a list that starts at 1 and says something may cut into a paragraph.
      if (m && (!para.length || (m[6] !== '' && (m[3] === undefined || m[3] === '1')))) {
        flush();
        i = parseList(lines, i, out);
        continue;
      }
      para.push(line);
      i++;
    }
    flush();
    return out;
  }

  function mdToTree(md) {
    var lines = String(md || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) {
        return line.replace(/^[ \t]+/, function (lead) { return lead.replace(/\t/g, '    '); });
      });
    return parseBlocks(lines);
  }

  // ------------------------------------------------------------- the pieces

  /** As the web's note editor decides whether pasted plain text is markdown. */
  function looksLikeMarkdown(text) {
    return /(^#{1,6} |^[-*] |^\d+\. |\*\*|```|\[[^\]]+\]\(https?:)/m.test(text);
  }
  /** Plain text as blocks: one paragraph per line, as ProseMirror pastes it. */
  function textToTree(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .filter(function (line, index, all) { return line !== '' || all.length === 1; })
      .map(function (line) { return { tag: 'p', attrs: {}, children: line ? [line] : [] }; });
  }

  return {
    escape: esc,
    safeHref: safeHref,
    parseHtml: parseHtml,
    htmlToTree: htmlToTree,
    mdToTree: mdToTree,
    textToTree: textToTree,
    treeToHtml: treeToHtml,
    treeToFragment: treeToFragment,
    treeToMd: treeToMd,
    treeToText: treeToText,
    treeToEmail: treeToEmail,
    looksLikeMarkdown: looksLikeMarkdown,
    /** Markdown as the HTML the editor shows. */
    mdToHtml: function (md) { return treeToHtml(mdToTree(md)); },
    /** The editor's HTML (or any HTML) as markdown. */
    htmlToMd: function (html) { return treeToMd(htmlToTree(html, 'markdown')); },
    /** Any HTML as the editor's own: only its tags, nothing that runs. */
    sanitize: function (html, mode) { return treeToHtml(htmlToTree(html, mode)); },
    /** The editor's HTML as mail sends it: {html, text, written}. */
    htmlToEmail: function (html) { return treeToEmail(htmlToTree(html, 'html')); },
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = EvenMd;
