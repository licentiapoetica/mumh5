import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFences, codeBlockHtml, highlightCode, languageId, detectLanguage, inOpenFence, tidyCode } from '../src/core/code.ts';

test('fences split composer text; the language follows the opening fence', () => {
  assert.deepEqual(splitFences('look:\n```py\ndef f(x):\n    return x\n```\nafter'), [
    { text: 'look:' }, { code: 'def f(x):\n    return x\n', lang: 'py' }, { text: 'after' }
  ]);
  // On one line: all code, no language
  assert.deepEqual(splitFences('```js```'), [{ code: 'js', lang: '' }]);
  assert.deepEqual(splitFences('a ```x = 1``` b'), [{ text: 'a ' }, { code: 'x = 1', lang: '' }, { text: 'b' }]);
  // Unclosed: stays text
  assert.deepEqual(splitFences('```js\nlet a'), [{ text: '```js\nlet a' }]);
  assert.deepEqual(splitFences('no code'), [{ text: 'no code' }]);
});

test('Enter continues an open fence', () => {
  assert.equal(inOpenFence('```js'), true);
  assert.equal(inOpenFence('```js\nlet a = 1;\n```'), false);
  assert.equal(inOpenFence('plain'), false);
});

test('a snippet goes out as escaped <pre> with its language as title', () => {
  assert.equal(codeBlockHtml('\n\nif (a < b && c) {}\n  \n', 'js'), '<pre title="javascript">if (a &lt; b &amp;&amp; c) {}</pre>');
  assert.equal(codeBlockHtml('SELECT id, name FROM users WHERE age > 30 ORDER BY name;'), '<pre title="sql">SELECT id, name FROM users WHERE age &gt; 30 ORDER BY name;</pre>');
  // Nothing recognisable: no title, and not guessed when told not to
  assert.equal(codeBlockHtml('hello everyone'), '<pre>hello everyone</pre>');
  assert.equal(codeBlockHtml('def f(x):\n    return [i for i in x]', null, false), '<pre>def f(x):\n    return [i for i in x]</pre>');
  assert.equal(tidyCode('\r\n  indented\r\n'), '  indented');
});

test('aliases resolve to the ids on the wire; unknown tags do not', () => {
  assert.equal(languageId('js'), 'javascript');
  assert.equal(languageId('PY'), 'python');
  assert.equal(languageId('html'), 'xml');
  assert.equal(languageId('toml'), 'ini');
  assert.equal(languageId('sh'), 'bash');
  assert.equal(languageId('ts'), 'typescript');
  assert.equal(languageId('klingon'), null);
  assert.equal(languageId(''), null);
});

test('detection: code is recognised, prose and ASCII tables are left plain', () => {
  assert.equal(detectLanguage('#include <stdio.h>\nint main(void) { printf("hi"); return 0; }'), 'cpp');
  assert.equal(detectLanguage('fn main() {\n    let v: Vec<i32> = vec![1, 2];\n    println!("{:?}", v);\n}'), 'rust');
  assert.equal(detectLanguage('hello everyone, the server will restart in 5 minutes'), null);
  assert.equal(detectLanguage('+-----+-----+\n| a   | b   |\n+-----+-----+'), null);
  assert.equal(detectLanguage('   '), null);
});

test('highlighted output keeps the code escaped', () => {
  const { html, lang } = highlightCode('<script>alert(1)</script>', 'html');
  assert.equal(lang, 'xml');
  assert.ok(!/<script/i.test(html), html);
  assert.match(html, /<span class="hljs-name">script<\/span>/);
  // Only spans with classes, nothing else
  assert.deepEqual([...new Set([...highlightCode('const a = `x${1}` // c', 'js').html.matchAll(/<(\w+)/g)].map(m => m[1]))], ['span']);
  assert.deepEqual(highlightCode('just <words>', 'nope'), { html: 'just &lt;words&gt;', lang: null });
});
