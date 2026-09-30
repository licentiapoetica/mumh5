import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicList, pingServer } from '../electron/publist.ts';

test('parses the public server list XML', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><servers>
    <server name="Tom &amp; Jerry" ca="1" continent_code="EU" country="Germany" country_code="DE" ip="voice.example.org" port="64738" region="Hessen" url="https://example.org"/>
    <server name="No port" ip="10.0.0.1" country_code="US" continent_code="NA" url="javascript:alert(1)"/>
    <server name="<C> Contra Clan" ca="0" continent_code="NA" country="United States" country_code="US" ip="mumble.poonbox.com" port="64738" url="www.poonbox.com"/>
    <server name="" ip="bad"/>
  </servers>`;
  assert.deepEqual(parsePublicList(xml), [
    { name: 'Tom & Jerry', host: 'voice.example.org', port: 64738, url: 'https://example.org', country: 'Germany', countryCode: 'de', continent: 'eu', ca: true },
    { name: 'No port', host: '10.0.0.1', port: 64738, url: '', country: 'Unknown', countryCode: 'us', continent: 'na', ca: false },
    { name: '<C> Contra Clan', host: 'mumble.poonbox.com', port: 64738, url: 'http://www.poonbox.com', country: 'United States', countryCode: 'us', continent: 'na', ca: false }
  ]);
});

const target = process.env.MUMBLE_TEST_HOST;
test('UDP ping reports users and version', { skip: !target }, async () => {
  const [host, port] = target!.split(':');
  const r = await pingServer(host, Number(port));
  assert.ok(r, 'server answered');
  assert.match(r!.version, /^1\.\d+\.\d+$/);
  assert.ok(r!.maxUsers > 0 && r!.ping >= 0);
  assert.equal(await pingServer('127.0.0.1', 9, 500), null, 'no answer gives null');
});
