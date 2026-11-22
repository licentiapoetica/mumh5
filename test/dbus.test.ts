import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus, Kind, Reader, Writer, decodeMessage, encodeMessage, messageLength, socketPath, splitSignature } from '../electron/dbus.ts';
import { colorFromResponse, portalHex } from '../electron/portal-color.ts';

test('signatures split into complete types', () => {
  assert.deepEqual(splitSignature('sa{sv}'), ['s', 'a{sv}']);
  assert.deepEqual(splitSignature('ua{sv}(ddd)aa(yv)'), ['u', 'a{sv}', '(ddd)', 'aa(yv)']);
  assert.throws(() => splitSignature('a{sv'));
  assert.throws(() => splitSignature('z'));
});

test('values survive marshalling with D-Bus alignment', () => {
  const sig = 'ysa{sv}(ddd)btx';
  const values = [7, 'hello', [['handle_token', ['s', 'mumh5_1']], ['n', ['u', 3]]], [0.25, 0.5, 1], true, 2n ** 40n, -5n];
  const w = new Writer();
  w.writeAll(sig, values);
  const bytes = w.bytesWritten();
  // y, then the string length aligned to 4
  assert.equal(bytes[0], 7);
  assert.equal(bytes.readUInt32LE(4), 5);
  assert.deepEqual(new Reader(bytes).readAll(sig), values);
});

test('array length leaves out the padding before the first element', () => {
  const w = new Writer();
  w.write('a(yy)', [[1, 2]]);
  const bytes = w.bytesWritten();
  // length 4, padding to 8, then two bytes
  assert.equal(bytes.readUInt32LE(0), 2);
  assert.equal(bytes.length, 10);
});

test('a big-endian body is read too', () => {
  const b = Buffer.alloc(16);
  b.writeUInt32BE(3, 0);
  b.write('abc\0', 4);
  b.writeUInt32BE(9, 8);
  assert.deepEqual(new Reader(b, 0, 0, false).readAll('su'), ['abc', 9]);
});

test('messages round-trip through the framing', () => {
  const raw = encodeMessage({
    kind: Kind.Call, serial: 3, destination: 'org.freedesktop.portal.Desktop', path: '/org/freedesktop/portal/desktop',
    interface: 'org.freedesktop.portal.Screenshot', member: 'PickColor', signature: 'sa{sv}', body: ['', [['handle_token', ['s', 't']]]]
  });
  assert.equal(raw.length % 1, 0);
  assert.equal(messageLength(raw.subarray(0, raw.length - 1)), 0, 'waits for the whole message');
  assert.equal(messageLength(Buffer.concat([raw, Buffer.from([1, 2, 3])])), raw.length);
  const m = decodeMessage(raw);
  assert.equal(m.kind, Kind.Call);
  assert.equal(m.serial, 3);
  assert.equal(m.member, 'PickColor');
  assert.equal(m.path, '/org/freedesktop/portal/desktop');
  assert.deepEqual(m.body, ['', [['handle_token', ['s', 't']]]]);
});

test('bus addresses become socket paths', () => {
  assert.equal(socketPath('unix:path=/run/user/1000/bus'), '/run/user/1000/bus');
  assert.equal(socketPath('unix:abstract=/tmp/dbus-x,guid=abc'), '\0/tmp/dbus-x');
  assert.equal(socketPath('tcp:host=localhost,port=1;unix:path=/b'), '/b');
  assert.equal(socketPath('tcp:host=localhost,port=1'), null);
});

test('portal answers become colors', () => {
  assert.equal(portalHex([1, 0.5, 0]), '#ff8000');
  assert.equal(portalHex([2, -1, 0]), '#ff0000');
  assert.equal(portalHex([1, 0]), null);
  assert.equal(colorFromResponse([0, [['color', ['(ddd)', [0, 0, 1]]]]]), '#0000ff');
  assert.equal(colorFromResponse([1, []]), null, 'cancelled');
  assert.equal(colorFromResponse([0, []]), null);
});

// Talks to the real session bus when there is one; opens nothing on screen
test('the session bus answers', { skip: !process.env.DBUS_SESSION_BUS_ADDRESS && 'no session bus' }, async () => {
  const bus = await Bus.session();
  try {
    assert.match(bus.name, /^:\d+\.\d+$/);
    const [id] = await bus.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'GetId' });
    assert.match(String(id), /^[0-9a-f]{32}$/);
    await assert.rejects(bus.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'NoSuchMethod' }), /UnknownMethod|NoSuchMethod/);
  } finally {
    bus.close();
  }
});
