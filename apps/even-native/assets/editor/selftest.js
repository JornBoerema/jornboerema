// The demo's self-test (EVEN_EDITOR_DEMO=selftest or selftest-html): types into
// the page through the script, never the keyboard, and prints what the typing
// shortcuts and commands made of it. Not part of the editor's own page.
(function () {
  var d = __even.debug;
  var html = window.EVEN_INIT.mode === 'html';
  function log(message) {
    window.ipc.postMessage(JSON.stringify({ t: 'log', message: message }));
  }
  function show(name) {
    log(name + ' => ' + JSON.stringify(d.content()) + '\n      ' + d.html());
  }
  function typed(name, start, text) {
    __even.set(start);
    d.caret(null, true);
    d.type(text);
    show(name);
  }
  function command(name, start, select, run) {
    __even.set(start);
    if (select) d.selectText(select);
    else d.caret(null, true);
    run();
    show(name);
  }
  try {
    if (html) {
      var signed = '<p>Old text</p><p>more</p><p></p><div data-signature><p>Groet, Jorn</p></div>';
      command('set body', signed, 'Old', function () { __even.setBody('<p>New</p><p></p><p>text</p>'); });
      command('set body, undone', signed, 'Old', function () { __even.setBody('<p>New</p>'); __even.exec('undo'); });
      command('set body without signature', '<p>Old</p>', 'Old', function () { __even.setBody('<p>New</p><p>text</p>'); });
      command('stream', signed, 'Old', function () { __even.startStream(); __even.streamBody('<p>Stre</p>'); __even.streamBody('<p>Streamed</p><p>now</p>'); });
      command('stream finished', signed, 'Old', function () { __even.startStream(); __even.streamBody('<p>Stre</p>'); __even.finishStream('<p>Done</p>'); });
      command('stream finished, undone', signed, 'Old', function () { __even.startStream(); __even.streamBody('<p>Stre</p>'); __even.finishStream('<p>Done</p>'); __even.exec('undo'); });
      command('stream cancelled', signed, 'Old', function () { __even.startStream(); __even.streamBody('<p>Stre</p>'); __even.cancelStream(); });
      command('stream into empty', '<p></p><div data-signature><p>Groet</p></div>', null, function () { __even.startStream(); __even.streamBody(''); __even.streamBody('<p>Hi</p>'); __even.finishStream('<p>Hi there</p>'); });
    }
    typed('bold rule', '', 'a **bold** b');
    typed('italic rule', '', 'an *italic* b');
    typed('strike rule', '', 'a ~~gone~~ b');
    typed('code rule', '', 'a `code` b');
    typed('bullets', '', '- one\ntwo\n\nafter');
    typed('numbers', '', '1. one\ntwo\n\nafter');
    typed('quote', '', '> quoted\n\nafter');
    typed('autolink', '', 'see https://example.com now');
    typed('enter in paragraph', html ? '<p>one</p>' : 'one', '\ntwo');
    command('bold command', html ? '<p>hello world</p>' : 'hello world', 'world', function () { __even.exec('bold'); });
    command('bold off', html ? '<p>hello <strong>world</strong></p>' : 'hello **world**', 'world', function () { __even.exec('bold'); });
    command('italic strike', html ? '<p>hello world</p>' : 'hello world', 'world', function () { __even.exec('italic'); __even.exec('strike'); });
    command('link command', html ? '<p>hello world</p>' : 'hello world', 'world', function () { __even.exec('link', 'example.com'); });
    command('unlink', html ? '<p>a <a href="https://x.y">link</a></p>' : 'a [link](https://x.y)', 'link', function () { __even.exec('link', ''); });
    command('bullet command', html ? '<p>one</p>' : 'one', null, function () { __even.exec('bulletList'); });
    command('bullet off', html ? '<ul><li>one</li></ul>' : '- one', 'one', function () { __even.exec('bulletList'); });
    command('numbers from bullets', html ? '<ul><li>one</li></ul>' : '- one', 'one', function () { __even.exec('orderedList'); });
    command('quote command', html ? '<p>one</p><p>two</p>' : 'one\n\ntwo', 'two', function () { __even.exec('quote'); });
    command('quote off', html ? '<blockquote><p>one</p></blockquote>' : '> one', 'one', function () { __even.exec('quote'); });
    command('tab indents', html ? '<ul><li>a</li><li>b</li></ul>' : '- a\n- b', 'b', function () { __even.combo('tab'); });
    command('shift-tab outdents', html ? '<ul><li>a<ul><li>b</li></ul></li></ul>' : '- a\n  - b', 'b', function () { __even.combo('shift-tab'); });
    command('enter on empty item', html ? '<ul><li>a</li></ul>' : '- a', null, function () { d.type('\n\nout'); });
    command('enter in empty quote line', html ? '<blockquote><p>q</p></blockquote>' : '> q', 'q', function () { d.caret('blockquote', true); d.type('\n\nout'); });
    command('paste html', html ? '<p>start </p>' : 'start', null, function () {
      var data = new DataTransfer();
      data.setData('text/html', '<meta charset="utf-8"><b onclick="x()">bold</b> <script>alert(1)</script><a href="javascript:1">bad</a> <a href="https://ok.example">ok</a>');
      data.setData('text/plain', 'bold bad ok');
      document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    command('paste lines', html ? '<p>start</p>' : 'start', null, function () { __even.paste('one\ntwo', false); });
    __even.set(html ? '<p>a <strong>bold</strong> word</p>' : 'a **bold** *it* word');
    d.selectText('bold');
    log('marks in bold => ' + JSON.stringify(d.marks()));
    if (html) {
      command('underline', '<p>hello world</p>', 'world', function () { __even.exec('underline'); });
      command('font size', '<p>hello world</p>', 'world', function () { __even.exec('fontSize', '18px'); });
      command('font size off', '<p>hello <span style="font-size:18px">big world</span></p>', 'world', function () { __even.exec('fontSize', null); });
      command('signature', '<p>Hi</p>', null, function () { __even.exec('signature', '<div>Groet,<br></div><div><b>Jorn</b></div>'); });
      command('signature swapped', '<p>Hi</p><p></p><div data-signature><p>Old</p></div>', 'Hi', function () { __even.exec('signature', '<p>New</p>'); });
      command('signature removed', '<p>Hi</p><p></p><div data-signature><p>Old</p></div>', 'Hi', function () { __even.exec('signature', ''); });
      command('image', '<p>pic: </p>', null, function () { __even.exec('image', { src: 'data:image/png;base64,iVBORw0KGgo=', width: 900 }); });
      command('heading rule is off', '', null, function () { d.type('# not a heading'); });
    } else {
      typed('heading 1', '', '# Title\nnext');
      typed('heading 3', '', '### Small\nnext');
      typed('tasks', '', '[ ] todo\nnext\n\nafter');
      typed('task done', '', '[x] done');
      typed('task in bullet', '', '- [ ] todo');
      typed('code block', '', '```rust \nfn x() {}\n  y\n\n\nout');
      typed('code block by enter', '', '```\nlet a;');
      typed('rule', '', '---after');
      typed('ordered from 3', '', '3. three\nfour');
      command('heading command', 'one', null, function () { __even.exec('heading', 2); });
      command('heading off', '## one', 'one', function () { __even.exec('heading', 2); });
      command('task command', 'one', null, function () { __even.exec('taskList'); });
      command('task to bullets', '- [ ] one', 'one', function () { __even.exec('bulletList'); });
      command('code block command', 'one', null, function () { __even.exec('codeBlock'); });
      command('rule command', 'one\n\ntwo', 'one', function () { __even.exec('rule'); });
      command('code command', 'hello world', 'world', function () { __even.exec('code'); });
      command('backspace in heading', '# one', null, function () { d.caret('h1', false); log('  handled: ' + __even.combo('backspace')); });
      command('tab indents task', '- [ ] a\n- [x] b', 'b', function () { __even.combo('tab'); });
      command('paste markdown', 'start', null, function () { __even.paste('# Pasted\n\n- a\n- **b**', false); });
      command('paste plain markdown', 'start ', null, function () { __even.paste('**not bold**', true); });
      command('heading shortcut', 'one', null, function () { __even.combo('cmd-alt-1'); });
      // Notes: the blocks "/" offers (note-editor.tsx's slash menu).
      __even.slash({ blocks: [{ id: 'paragraph', label: 'Text' }, { id: 'h1', label: 'Heading 1' }, { id: 'h2', label: 'Heading 2' }, { id: 'taskList', label: 'Checklist' }, { id: 'horizontalRule', label: 'Divider' }], empty: 'No blocks found.' });
      var key = function (name) { document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); };
      __even.set('');
      d.caret(null, true);
      d.type('/');
      log('slash all => ' + JSON.stringify(d.slash()));
      d.type('head');
      log('slash head => ' + JSON.stringify(d.slash()));
      key('ArrowDown');
      key('Enter');
      d.type('Title');
      show('slash heading 2');
      __even.set('one');
      d.caret(null, true);
      d.type('\n/check');
      key('Enter');
      d.type('todo');
      show('slash checklist');
      __even.set('');
      d.caret(null, true);
      d.type('/zzz');
      log('slash none => ' + JSON.stringify(d.slash()));
      key('Escape');
      log('slash escaped => ' + JSON.stringify(d.slash()));
      __even.set('text /head');
      d.caret(null, true);
      log('slash mid-line => ' + JSON.stringify(d.slash()));
      __even.slash(null);
      __even.set('- [ ] a\n- [x] b');
      d.selectText('b');
      log('marks in task => ' + JSON.stringify(d.marks()));
    }
    log('fonts: Inter ' + document.fonts.check('15px Inter') + ', body ' + getComputedStyle(document.body).fontFamily);
  } catch (error) {
    log('ERROR ' + error.message + '\n' + error.stack);
  }
  log('done');
})();
