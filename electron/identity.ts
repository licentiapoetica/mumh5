import forge from 'node-forge';
import { createHash } from 'node:crypto';

export interface Identity {
  certPem: string;
  keyPem: string;
  fingerprint: string;
}

// Self-signed client certificate, the same kind the desktop Mumble client generates.
// Mumble servers identify registered users by the hash of this certificate.
export function generateIdentity(name: string, email = ''): Identity {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20);
  const attrs: { name: string; value: string }[] = [{ name: 'commonName', value: name || 'mumh5 user' }];
  if (email) attrs.push({ name: 'emailAddress', value: email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  return { certPem, keyPem: forge.pki.privateKeyToPem(keys.privateKey), fingerprint: certFingerprint(certPem) };
}

// SHA-1 of the DER certificate, the hash Mumble shows and stores for users.
export function certFingerprint(certPem: string): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))).getBytes();
  return createHash('sha1').update(Buffer.from(der, 'binary')).digest('hex');
}

// Read a PKCS#12 file (.p12/.pfx, as exported by the desktop Mumble client).
export function identityFromP12(bytes: Uint8Array, password: string): Identity {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.binary.raw.encode(bytes);
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), password);
  } catch {
    throw new Error('Could not open the file. Wrong password, or not a PKCS#12 certificate.');
  }
  const bags = (type: string) => p12.getBags({ bagType: type })[type] ?? [];
  const cert = bags(forge.pki.oids.certBag).find(b => b.cert)?.cert;
  const key = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)].find(b => b.key)?.key;
  if (!cert || !key) throw new Error('The file does not contain both a certificate and its private key.');
  const certPem = forge.pki.certificateToPem(cert);
  return { certPem, keyPem: forge.pki.privateKeyToPem(key), fingerprint: certFingerprint(certPem) };
}

// PKCS#12 with 3DES, which the desktop Mumble client and other tools can import.
export function identityToP12(id: Identity, password: string, friendlyName: string): Uint8Array {
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    forge.pki.privateKeyFromPem(id.keyPem),
    [forge.pki.certificateFromPem(id.certPem)],
    password,
    { algorithm: '3des', friendlyName }
  );
  return new Uint8Array(Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
}

// Common name of a certificate, used as the default identity name
export function certCommonName(certPem: string): string {
  const cn = forge.pki.certificateFromPem(certPem).subject.getField('CN');
  return cn ? String(cn.value) : '';
}

