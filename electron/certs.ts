import { X509Certificate } from 'node:crypto';

export interface CertDetails {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  fingerprint: string;     // SHA-1, the hash Mumble uses for users
  fingerprint256: string;
  subjectAltName: string;
  keyType: string;
  keyBits: number | null;
  ca: boolean;
  selfSigned: boolean;
  pem: string;
}

// Plain, IPC-safe summary of a certificate for the viewer
export function describeCert(input: string | Buffer | X509Certificate): CertDetails {
  const c = input instanceof X509Certificate ? input : new X509Certificate(input);
  const key = c.publicKey;
  const d = key.asymmetricKeyDetails;
  return {
    subject: c.subject,
    issuer: c.issuer,
    validFrom: new Date(c.validFrom).toISOString(),
    validTo: new Date(c.validTo).toISOString(),
    serialNumber: c.serialNumber,
    fingerprint: c.fingerprint,
    fingerprint256: c.fingerprint256,
    subjectAltName: c.subjectAltName ?? '',
    keyType: key.asymmetricKeyType ?? 'unknown',
    keyBits: d?.modulusLength ?? null,
    ca: c.ca,
    selfSigned: c.checkIssued(c),
    pem: c.toString()
  };
}
