import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import tls from 'node:tls';
import { test } from 'node:test';
import { generateIdentity } from '../electron/identity.ts';
import { MumpeerLink, loopbackLanes } from '../electron/mumpeer.ts';

test('mumpeer sends no bind credential to a mismatched certificate or ALPN', async t => {
  const serverIdentity = generateIdentity('Relay');
  const client = generateIdentity('Client');
  const fingerprint = new X509Certificate(serverIdentity.certPem).fingerprint256.replaceAll(':', '').toLowerCase();
  for (const [pin, protocols] of [['00'.repeat(32), ['mumpeer/1']], [fingerprint, undefined]] as const) {
    let bytes = 0;
    const server = tls.createServer({
      cert: serverIdentity.certPem, key: serverIdentity.keyPem, requestCert: true, rejectUnauthorized: false,
      minVersion: 'TLSv1.3', ALPNProtocols: protocols && [...protocols]
    }, socket => socket.on('data', data => { bytes += data.length; }));
    t.after(() => server.close());
    const listening = once(server.listen(0, '127.0.0.1'), 'listening');
    await listening;
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const link = new MumpeerLink({ host: '127.0.0.1', tcp: address.port, fp: pin }, 'A'.repeat(43), client.certPem, client.keyPem, () => {}, { lanes: loopbackLanes });
    await assert.rejects(link.ready, /certificate or protocol did not match/);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(bytes, 0);
  }
});
