import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encode15, decode15, encodedLength, pieceBytes, pieceForm, pieceMessage, parsePiece, isPiece, announce, takeFiles,
  validMeta, toRanges, fromRanges, split, rootHash, sha256, Sender, SourceWindow, windowSize, pieceCount, pieceSize, type FileMeta
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
  // Out of order or overlapping: a short request must not cost more than the file's pieces
  assert.equal(fromRanges([[8, 10], [1, 4]], 10), null);
  assert.equal(fromRanges([[1, 4], [3, 6]], 10), null);
  const heavy = Array.from({ length: 10000 }, () => [0, 65536]);
  const t0 = performance.now();
  assert.equal(fromRanges(heavy, 65536), null);
  assert.ok(performance.now() - t0 < 50);
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

test('a source sends at most one window and never the same piece twice unless it got lost', () => {
  const s = new Sender();
  const all = Array.from({ length: 20 }, (_, k) => k);
  // Asked for everything at once (an older version): one window only
  assert.equal(s.want('f', 1, all, { cap: 4, q: 1 }), false);
  const sent: number[] = [];
  for (let job = s.next(); job; job = s.next()) sent.push(job.piece);
  assert.deepEqual(sent, [0, 1, 2, 3]);
  assert.equal(s.serial('f', 1), 1);
  // Moving the window on: what is on its way is not sent again
  assert.equal(s.want('f', 1, [2, 3, 4, 5], { cap: 4, q: 2 }), false);
  assert.deepEqual([s.next()?.piece, s.next()?.piece, s.next()], [4, 5, null]);
  // Nothing new in a request: answered right away
  assert.equal(s.want('f', 1, [4, 5], { cap: 4, q: 3 }), true);
  // Lost on the way: sent again
  assert.equal(s.want('f', 1, [4, 5], { cap: 4, q: 4, again: true }), false);
  assert.deepEqual([s.next()?.piece, s.next()?.piece], [4, 5]);
  // The same receiver starts the download over: everything counts as unsent
  assert.equal(s.want('f', 1, [0, 1], { cap: 4, q: 1 }), false);
  assert.equal(s.next()?.piece, 0);
});

test('a window asks for what is on its way plus the next pieces, and for more at half', () => {
  const have = new Set<number>();
  const w = new SourceWindow([3, 4, 5, 6, 7, 8, 9, 10], 4);
  assert.deepEqual(w.ask(k => have.has(k)), { pieces: [3, 4, 5, 6], q: 1 });
  have.add(3);
  assert.equal(w.got(3), false);
  have.add(5);
  assert.equal(w.got(5), true);
  assert.deepEqual(w.ask(k => have.has(k)), { pieces: [4, 6, 7, 8], q: 2 });
  for (const k of [4, 6, 7, 8]) { have.add(k); w.got(k); }
  assert.deepEqual(w.ask(k => have.has(k)).pieces, [9, 10]);
  assert.equal(w.more, false);
  assert.equal(windowSize(245_745), 8);
  assert.equal(windowSize(1_966_020), 2);
});

// The server in between: a queue per receiver that the receiver may stop reading
test('a receiver that stops reading holds its sources to one window each', () => {
  const size = 6, count = 200;
  const sources = [1, 2, 3];
  const senders = new Map(sources.map(id => [id, new Sender()]));
  const pipe: { from: number; piece: number }[] = [];
  const have = new Set<number>();
  const parts = split(Array.from({ length: count }, (_, k) => k), sources);
  const windows = new Map(sources.map(id => [id, new SourceWindow(parts.get(id)!, size)]));
  const ask = (id: number) => {
    const { pieces, q } = windows.get(id)!.ask(k => have.has(k));
    senders.get(id)!.want('f', 9, pieces, { cap: size, q });
  };
  sources.forEach(ask);
  let reading = false, most = 0;
  for (let tick = 0; have.size < count && tick < 10000; tick++) {
    // Each source sends a piece per tick if it has one
    for (const [id, s] of senders) {
      const job = s.next();
      if (job) pipe.push({ from: id, piece: job.piece });
    }
    most = Math.max(most, pipe.length);
    if (tick === 20) reading = true;
    if (!reading) continue;
    // The receiver reads two pieces per tick, slower than its sources send
    for (const { from, piece } of pipe.splice(0, 2)) {
      have.add(piece);
      if (windows.get(from)!.got(piece)) ask(from);
    }
  }
  assert.equal(have.size, count);
  assert.ok(most <= size * sources.length, `${most} pieces waited in the server`);
});
