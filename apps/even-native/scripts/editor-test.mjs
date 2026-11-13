// Tests the rich text editor's converters (assets/editor/markdown.js), which
// are pure string functions: `node scripts/editor-test.mjs` from apps/even-native.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../assets/editor/markdown.js', import.meta.url));
const module = { exports: {} };
new Function('module', 'require', readFileSync(file, 'utf8'))(module, createRequire(import.meta.url));
const Md = module.exports;

let failed = 0;
let passed = 0;
function same(name, actual, expected) {
  if (actual === expected) return passed++;
  failed++;
  console.error(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}
/** Markdown → editor HTML → markdown gives the markdown back, and the HTML is what is expected. */
function round(name, md, html) {
  const shown = Md.mdToHtml(md);
  if (html !== undefined) same(`${name} (html)`, shown, html);
  same(`${name} (round trip)`, Md.htmlToMd(shown), md);
  // And once more: what was written reads back the same.
  same(`${name} (stable)`, Md.htmlToMd(Md.mdToHtml(Md.htmlToMd(shown))), md);
}

// Every construct tiptap's StarterKit and task lists write.
round('paragraph', 'Hello world', '<p>Hello world</p>');
round('two paragraphs', 'One\n\nTwo', '<p>One</p><p>Two</p>');
round('heading 1', '# Title', '<h1>Title</h1>');
round('heading 2', '## Sub *title*', '<h2>Sub <em>title</em></h2>');
round('heading 3', '### Small', '<h3>Small</h3>');
round('heading 6', '###### Tiny', '<h6>Tiny</h6>');
round('bold', 'A **bold** word', '<p>A <strong>bold</strong> word</p>');
round('italic', 'An *italic* word', '<p>An <em>italic</em> word</p>');
round('strike', 'A ~~gone~~ word', '<p>A <s>gone</s> word</p>');
round('bold italic', '***both***', '<p><em><strong>both</strong></em></p>');
round('nested marks', '**bold and *italic* inside**', '<p><strong>bold and <em>italic</em> inside</strong></p>');
round('inline code', 'Run `cargo test` now', '<p>Run <code>cargo test</code> now</p>');
round('code with backtick', 'A ``a`b`` span', '<p>A <code>a`b</code> span</p>');
round('code keeps marks literal', '`**not bold**`', '<p><code>**not bold**</code></p>');
round('link', 'See [the site](https://example.com) here', '<p>See <a href="https://example.com">the site</a> here</p>');
round('link with title', '[x](https://example.com "Title")', '<p><a href="https://example.com" title="Title">x</a></p>');
round('bold link', '**[x](https://example.com)**', '<p><strong><a href="https://example.com">x</a></strong></p>');
round('hard break', 'Line one  \nLine two', '<p>Line one<br>Line two</p>');
round('horizontal rule', 'Above\n\n---\n\nBelow', '<p>Above</p><hr><p>Below</p>');
round('blockquote', '> Quoted\n>\n> More', '<blockquote><p>Quoted</p><p>More</p></blockquote>');
round('nested blockquote', '> Outer\n>\n> > Inner', '<blockquote><p>Outer</p><blockquote><p>Inner</p></blockquote></blockquote>');
round('code block', '```\nlet a = 1;\n  let b = 2;\n```', '<pre>let a = 1;\n  let b = 2;</pre>');
round('code block with language', '```rust\nfn main() {}\n```', '<pre data-lang="rust">fn main() {}</pre>');
round('code block keeps markup', '```\n<b>&amp; **x**\n```', '<pre>&lt;b&gt;&amp;amp; **x**</pre>');
round('bullet list', '- One\n- Two\n- Three', '<ul><li>One</li><li>Two</li><li>Three</li></ul>');
round('ordered list', '1. One\n2. Two', '<ol><li>One</li><li>Two</li></ol>');
round('ordered list from 3', '3. Three\n4. Four', '<ol start="3"><li>Three</li><li>Four</li></ol>');
round('nested list', '- One\n  - Inner\n  - Other\n- Two', '<ul><li>One</li><ul><li>Inner</li><li>Other</li></ul><li>Two</li></ul>');
round('ordered in bullet', '- One\n  1. First\n  2. Second', '<ul><li>One</li><ol><li>First</li><li>Second</li></ol></ul>');
round('bullet in ordered', '1. One\n   - Inner', '<ol><li>One</li><ul><li>Inner</li></ul></ol>');
round('task list', '- [ ] Open\n- [x] Done', '<ul data-type="taskList"><li data-checked="false">Open</li><li data-checked="true">Done</li></ul>');
round('nested task list', '- [ ] Open\n  - [x] Inner', '<ul data-type="taskList"><li data-checked="false">Open</li><ul data-type="taskList"><li data-checked="true">Inner</li></ul></ul>');
round('list with marks', '- **Bold** and `code`\n- [link](https://example.com)');
round('paragraph in list item', '- One\n\n  Second paragraph\n- Two', '<ul><li>One<p>Second paragraph</p></li><li>Two</li></ul>');
round('quote with list', '> - One\n> - Two', '<blockquote><ul><li>One</li><li>Two</li></ul></blockquote>');
round('empty document', '', '');
round(
  'everything',
  '# Title\n\nSome **bold**, *italic*, ~~struck~~ and `code` with a [link](https://example.com).\n\n## List\n\n- One\n  - Nested\n- Two\n\n1. First\n2. Second\n\n- [ ] Todo\n- [x] Done\n\n> A quote\n\n```js\nconsole.log(1);\n```\n\n---\n\nThe end  \nwith a break'
);

// Text that only looks like markdown stays text.
round('literal star', '3\\* and a \\*word\\*', '<p>3* and a *word*</p>');
round('spaced star', '2 * 3 * 4', '<p>2 * 3 * 4</p>');
round('snake case', 'a snake_case_name and \\_edge\\_', '<p>a snake_case_name and _edge_</p>');
round('literal backtick', 'a \\` tick', '<p>a ` tick</p>');
round('literal hash', '\\# not a heading', '<p># not a heading</p>');
round('literal dash', '\\- not a list', '<p>- not a list</p>');
round('literal number', '1\\. not a list', '<p>1. not a list</p>');
round('literal quote', '\\> not a quote', '<p>&gt; not a quote</p>');
round('literal tag', 'a \\<b> tag &amp;amp; an & sign', '<p>a &lt;b&gt; tag &amp;amp; an &amp; sign</p>');
round('literal bracket', '\\[not](a link) but [this] is fine', '<p>[not](a link) but [this] is fine</p>');
round('picture stays words', '![alt](https://example.com/a.png)', '<p>![alt](https://example.com/a.png)</p>');
round('backslash path', 'C:\\Users\\me', '<p>C:\\Users\\me</p>');

// Reading other people's markdown: forgiving in, tiptap's spelling out.
same('star bullets', Md.htmlToMd(Md.mdToHtml('* One\n* Two')), '- One\n- Two');
same('underscore marks', Md.htmlToMd(Md.mdToHtml('__bold__ and _italic_')), '**bold** and *italic*');
same('soft break', Md.mdToHtml('one\ntwo'), '<p>one two</p>');
same('backslash break', Md.mdToHtml('one\\\ntwo'), '<p>one<br>two</p>');
same('setext heading', Md.mdToHtml('Title\n=====\n\nSub\n---'), '<h1>Title</h1><h2>Sub</h2>');
same('closing hashes', Md.mdToHtml('## Title ##'), '<h2>Title</h2>');
same('loose list', Md.htmlToMd(Md.mdToHtml('- One\n\n- Two')), '- One\n- Two');
same('tilde fence', Md.mdToHtml('~~~\ncode\n~~~'), '<pre>code</pre>');
same('bare address', Md.mdToHtml('Go to https://example.com/a_b. Now'), '<p>Go to <a href="https://example.com/a_b">https://example.com/a_b</a>. Now</p>');
same('angle address', Md.mdToHtml('<https://example.com>'), '<p><a href="https://example.com">https://example.com</a></p>');
same('script address refused', Md.mdToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
same('html is words', Md.mdToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
same('mixed task list stays bullets', Md.mdToHtml('- [ ] a\n- b'), '<ul><li>[ ] a</li><li>b</li></ul>');
same('empty paragraphs', Md.htmlToMd('<p>a</p><p><br></p><p><br></p><p>b</p>'), 'a\n\n&nbsp;\n\nb');
same('empty paragraph read', Md.mdToHtml('a\n\n&nbsp;\n\nb'), '<p>a</p><p><br></p><p>b</p>');
same('rule cuts paragraph', Md.mdToHtml('a\n***\nb'), '<p>a</p><hr><p>b</p>');
same('list cuts paragraph', Md.mdToHtml('a\n- b'), '<p>a</p><ul><li>b</li></ul>');
same('number does not cut paragraph', Md.mdToHtml('in\n2024. it'), '<p>in 2024. it</p>');

// What the browser's editing leaves behind reads as the same markdown.
same('webkit tags', Md.htmlToMd('<p><b>bold</b> <i>it</i> <strike>gone</strike> <u>under</u></p>'), '**bold** *it* ~~gone~~ under');
same('div lines', Md.htmlToMd('<div>one</div><div><br></div><div>two</div>'), 'one\n\ntwo');
same('loose text', Md.htmlToMd('one<br>two<p>three</p>'), 'one  \ntwo\n\nthree');
same('trailing break', Md.htmlToMd('<p>text<br></p>'), 'text');
same('style spans', Md.htmlToMd('<p><span style="font-weight: 700">b</span><span style="font-style:italic">i</span></p>'), '**b***i*');
same('space inside mark', Md.htmlToMd('<p>a<b> bold </b>b</p>'), 'a **bold** b');
same('nbsp', Md.htmlToMd('<p>a &nbsp;b&nbsp;</p>'), 'a  b');
same('zero width', Md.htmlToMd('<p><code>x</code>\u200by</p>'), '`x`y');
same('list under list', Md.htmlToMd('<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>'), '- a\n  - b\n- c');
same('list in paragraph', Md.htmlToMd('<p>a<ul><li>b</li></ul></p>'), 'a\n\n- b');
same('pre with code', Md.htmlToMd('<pre><code class="language-ts">let a\n</code></pre>'), '```ts\nlet a\n```');
same('pre with breaks', Md.htmlToMd('<pre>a<br>b<br></pre>'), '```\na\nb\n```');
same('tiptap task item', Md.htmlToMd('<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p></div></li></ul>'), '- [x] Done');
same('github task item', Md.htmlToMd('<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> Open</li></ul>'), '- [ ] Open');
same('tiptap list item', Md.htmlToMd('<ul><li><p>One</p></li><li><p>Two</p><ul><li><p>In</p></li></ul></li></ul>'), '- One\n- Two\n  - In');
same('heading with break', Md.htmlToMd('<h2>a<br>b</h2>'), '## a b');
same('quote without paragraph', Md.htmlToMd('<blockquote>quoted</blockquote>'), '> quoted');

// Pasted HTML: only the editor's own tags come out.
same('script and handlers', Md.sanitize('<p onclick="x()">a<script>alert(1)</script><img src=x onerror=alert(1)></p><style>p{}</style>', 'html'), '<p>a</p>');
same('script address', Md.sanitize('<a href="javascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a>', 'html'), '<p>xy</p>');
same('data address', Md.sanitize('<a href="data:text/html,<script>1</script>">x</a>', 'html'), '<p>x</p>');
same('iframe and form', Md.sanitize('<iframe src="https://x"></iframe><form><input value="a"><button>b</button>text</form>', 'html'), '<p>text</p>');
same('svg', Md.sanitize('<svg><script>1</script><a xlink:href="javascript:1">x</a></svg>after', 'html'), '<p>after</p>');
same('attribute breakout', Md.sanitize('<a href="https://a.b/&quot;onmouseover=&quot;x">t</a>', 'html'), '<p><a href="https://a.b/&quot;onmouseover=&quot;x">t</a></p>');
same('unclosed tag', Md.sanitize('<p>a<b>b<p>c', 'html'), '<p>a<strong>b</strong></p><p>c</p>');
same('comment', Md.sanitize('<!-- <script> --><p>a</p><!--[if mso]><p>b</p><![endif]-->', 'html'), '<p>a</p>');
same('html keeps formatting', Md.sanitize('<div><b>b</b> <i>i</i> <u>u</u> <s>s</s> <a href="https://x.y">l</a></div><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>', 'html'), '<p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <a href="https://x.y">l</a></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote><p>q</p></blockquote>');
same('html has no headings', Md.sanitize('<h1>Title</h1><hr><pre>a\nb</pre>', 'html'), '<p>Title</p><p>a<br>b</p>');
same('markdown has no underline or picture', Md.sanitize('<p><u>u</u><img src="https://x.y/a.png"></p>', 'markdown'), '<p>u</p>');
same('font size', Md.sanitize('<span style="font-size: 18px; color: red">big</span><span style="font-size: expression(1)">x</span>', 'html'), '<p><span style="font-size:18px">big</span>x</p>');
same('google docs bold wrapper', Md.sanitize('<b style="font-weight:normal"><p><span style="font-weight:700">a</span></p><p>b</p></b>', 'html'), '<p><strong>a</strong></p><p>b</p>');
same('mark around blocks', Md.sanitize('<b><p>a</p><p>b</p></b>', 'html'), '<p><strong>a</strong></p><p><strong>b</strong></p>');
same('picture', Md.sanitize('<img src="data:image/png;base64,AAAA" width="40" onload="x()"><img src="data:text/html;base64,AAAA"><img src="file:///etc/passwd">', 'html'), '<p><img src="data:image/png;base64,AAAA" width="40"></p>');
same('table', Md.sanitize('<table><tr><td>a</td><td>b</td></tr></table>', 'html'), '<p>a</p><p>b</p>');
same('whitespace', Md.sanitize('<div>\n  <p>\n    a\n    b\n  </p>\n</div>\n', 'html'), '<p>a b</p>');
same('signature', Md.sanitize('<p>Hi</p><p></p><div data-signature><p>Jorn</p></div>', 'html'), '<p>Hi</p><p><br></p><div data-signature=""><p>Jorn</p></div>');
same('gmail blank line', Md.sanitize('<div>a</div><div><br></div><div>b</div>', 'html'), '<p>a</p><p><br></p><p>b</p>');
same('entities', Md.sanitize('<p>&lt;b&gt; &amp;amp; &#x41;&#66; &copy;</p>', 'html'), '<p>&lt;b&gt; &amp;amp; AB ©</p>');

// What mail sends.
const mail = Md.htmlToEmail('<p>Hi <b>there</b></p><p><br></p><ul><li>one</li></ul><blockquote><p>q</p></blockquote><div data-signature=""><p>Jorn</p></div>');
same(
  'mail html',
  mail.html,
  '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5"><p style="margin:0">Hi <strong>there</strong></p><p style="margin:0"><br></p><ul style="margin:0;padding-left:1.5em"><li>one</li></ul><blockquote style="margin:0;padding-left:12px;border-left:2px solid #d0d0d0;color:#555555"><p style="margin:0">q</p></blockquote><div data-signature=""><p style="margin:0">Jorn</p></div></div>'
);
same('mail text', mail.text, 'Hi there\n\none\nq\nJorn');
same('mail written', mail.written, true);
// Mail leaves with a list inside its item, as HTML has it; the editor shows it after the item (WebKit's way).
same('mail nested list', Md.htmlToEmail('<ul><li>a</li><ul><li>b</li></ul></ul>').html.replace(/ style="[^"]*"/g, ''), '<div><ul><li>a<ul><li>b</li></ul></li></ul></div>');
same('mail reads its own html back', Md.htmlToEmail(Md.sanitize(mail.html, 'html')).html, mail.html);
same('only a signature is not written', Md.htmlToEmail('<p><br></p><div data-signature=""><p>Jorn</p></div>').written, false);
same('empty mail', Md.htmlToEmail('<p><br></p>').html, '');
same('picture counts as written', Md.htmlToEmail('<p><img src="data:image/png;base64,AAAA"></p>').written, true);

// Plain text and the markdown guess.
same('plain text', Md.treeToHtml(Md.textToTree('one\ntwo\n\nthree')), '<p>one</p><p>two</p><p>three</p>');
same('plain text escapes', Md.treeToHtml(Md.textToTree('<b>&')), '<p>&lt;b&gt;&amp;</p>');
same('looks like markdown', Md.looksLikeMarkdown('# Title\ntext'), true);
same('does not look like markdown', Md.looksLikeMarkdown('Just a sentence.'), false);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
