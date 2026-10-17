import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encode15, decode15, encodedLength, pieceBytes, pieceForm, pieceMessage, parsePiece, isPiece, announce, takeFiles,
  validMeta, toRanges, fromRanges, split, rootHash, sha256, Sender, pieceCount, pieceSize, type FileMeta
} from '../src/core/file-transfer.ts';

const random = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536));
  return b;
};

test('15 bits per character round-trip at every length', () => {
  for (let n = 0; n <= 64; n++) {
    const bytes = random(n);
    const text = encode15(bytes);
    assert.equal(text.length, encodedLength(n));
    assert.deepEqual(decode15(text, n), bytes);
  }
  const big = random(245_000);
  assert.deepEqual(decode15(encode15(big), big.length), big);
});

test('encoded text is plain XML characters only', () => {
  const text = encode15(random(10000));
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    assert.ok(c >= 0x4000 && c <= 0xbfff, `code point ${c.toString(16)}`);
  }
});

test('decoding refuses wrong lengths and foreign characters', () => {
  const text = encode15(random(30));
  assert.equal(decode15(text, 31), null);
  assert.equal(decode15(text.slice(0, -1), 30), null);
  assert.equal(decode15('A' + text.slice(1), 30), null);
});

test('piece size follows the server limits', () => {
  const stock = { allowHtml: true, messageLength: 5000, imageMessageLength: 131072 };
  assert.equal(pieceForm(stock), 'img');
  const c = pieceBytes(stock);
  assert.equal(c % 15, 0);
  assert.ok(c > 240_000 && c < 246_000, String(c));
  // The longest message stays inside the limit
  const msg = pieceMessage('img', 'a'.repeat(40), 9_999_999, encode15(random(c)));
  assert.ok(msg.length <= 131072, String(msg.length));
  // Without HTML only plain text, within the text limit
  const plain = { allowHtml: false, messageLength: 5000, imageMessageLength: 131072 };
  assert.equal(pieceForm(plain), 'text');
  assert.ok(pieceMessage('text', 'a'.repeat(40), 9_999_999, encode15(random(pieceBytes(plain)))).length <= 5000);
  // 0 is no limit
  assert.equal(pieceBytes({ allowHtml: true, messageLength: 5000, imageMessageLength: 0 }), Math.floor(((1 << 20) - 128) / 8) * 15);
});

test('pieces are recognized and parsed in both forms', () => {
  for (const form of ['img', 'text'] as const) {
    const payload = encode15(random(100));
    const msg = pieceMessage(form, 'abc123', 42, payload);
    assert.ok(isPiece(msg));
    assert.deepEqual(parsePiece(msg), { id: 'abc123', index: 42, payload });
  }
  assert.equal(isPiece('<img src="data:image/png;base64,AAAA"/>'), false);
  assert.equal(parsePiece('<img alt="mumh5:f:ABC:1" src="data:,x"/>'), null);
  assert.equal(parsePiece('<img alt="mumh5:f:abc:1" src="data:,x"'), null);
});

const meta: FileMeta = { i: 'k3f9abc', n: 'clip--final.mp4', s: 1_000_000, m: 'video/mp4', c: 245_745, h: 'ab'.repeat(32) };

test('announcements hide their marker from other clients and come back intact', () => {
  const html = announce(meta, '<b>clip--final.mp4</b> (976.6 KB)<br/><img src="data:image/jpeg;base64,/9j/AA=="/>');
  // A comment that other clients do not show, and nothing that would end it early
  const comment = html.slice(0, html.indexOf('-->') + 3);
  assert.ok(comment.startsWith('<!--mumh5:file:'));
  assert.ok(!comment.slice(4, -3).includes('--'));
  const got = takeFiles('before ' + html + ' after');
  assert.equal(got.html, 'before  after');
  assert.deepEqual(got.files, [{ meta, poster: 'data:image/jpeg;base64,/9j/AA==' }]);
  assert.deepEqual(takeFiles('no files here'), { html: 'no files here', files: [] });
});

test('announced details are checked', () => {
  assert.deepEqual(validMeta(meta), meta);
  assert.equal(validMeta({ ...meta, s: 0 }), null);
  assert.equal(validMeta({ ...meta, s: 3 * 1024 ** 3 }), null);
  assert.equal(validMeta({ ...meta, c: 1485 }), null);
  assert.equal(validMeta({ ...meta, s: 2 * 1024 ** 3, c: 15000 }), null, 'too many pieces');
  assert.equal(validMeta({ ...meta, h: 'xyz' }), null);
  assert.equal(validMeta({ ...meta, i: 'A/B' }), null);
  assert.equal(validMeta({ ...meta, m: 'text/html<script>' }), null);
  assert.equal(validMeta({ ...meta, n: '../../etc/passwd' })!.n, '.._.._etc_passwd');
  // A marker with broken details stays in the message as it was
  const bad = '<!--mumh5:file:%7B%7D-->x<!--/mumh5:file-->';
  assert.deepEqual(takeFiles(bad), { html: bad, files: [] });
});

test('piece ranges', () => {
  assert.deepEqual(toRanges([5, 1, 2, 3, 9, 8]), [[1, 4], [5, 6], [8, 10]]);
  assert.deepEqual(fromRanges([[1, 4], [8, 10]], 10), [1, 2, 3, 8, 9]);
  assert.equal(fromRanges([[1, 11]], 10), null);
  assert.equal(fromRanges([[3, 3]], 10), null);
  assert.equal(fromRanges('x', 10), null);
  assert.deepEqual([...split([0, 1, 2, 3, 4], [7, 8])], [[7, [0, 1, 2]], [8, [3, 4]]]);
  assert.equal(pieceCount(meta), 5);
  assert.equal(pieceSize(meta, 4), 1_000_000 - 4 * 245_745);
});

test('the file hash is the hash of the piece hashes', async () => {
  const a = random(100), b = random(50);
  const both = new Uint8Array(64);
  both.set(await sha256(a));
  both.set(await sha256(b), 32);
  const expected = [...await sha256(both)].map(x => x.toString(16).padStart(2, '0')).join('');
  assert.equal(await rootHash([await sha256(a), await sha256(b)]), expected);
});

test('a source sends each piece once to everyone who wants it, taking turns', () => {
  const s = new Sender();
  s.want('f', 1, [0, 1, 2, 3]);
  s.want('f', 2, [2, 3]);
  s.want('g', 3, [0]);
  const order: string[] = [];
  for (let job = s.next(); job; job = s.next()) order.push(`${job.file}${job.piece}>${job.to.join(',')}${job.finished.length ? ` done ${job.finished.join(',')}` : ''}`);
  assert.deepEqual(order, ['f0>1', 'f2>1,2', 'g0>3 done 3', 'f1>1', 'f3>1,2 done 1,2']);
  assert.equal(s.busy, false);
});

test('asking again replaces what was asked; nothing stops; leaving drops', () => {
  const s = new Sender();
  s.want('f', 1, [0, 1, 2]);
  s.want('f', 1, [2]);
  assert.deepEqual(s.next(), { file: 'f', piece: 2, to: [1], finished: [1] });
  s.want('f', 1, [0]);
  s.want('f', 1, []);
  assert.equal(s.busy, false);
  s.want('f', 1, [0]);
  s.want('f', 2, [0]);
  s.drop(1);
  assert.deepEqual(s.next(), { file: 'f', piece: 0, to: [2], finished: [2] });
  assert.equal(s.next(), null);
});
