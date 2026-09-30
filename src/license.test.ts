import { describe, expect, it } from 'vitest';
import { PERMANENT_EXP, isPermanent, verifyLicense } from './license';

// Genera un par de claves ECDSA P-256 y firma un payload igual que
// tools/sign-license.mjs. Así el test no depende de la clave privada real.
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function makeIssuer() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const pubB64 = Buffer.from(spki).toString('base64');
  const sign = async (payload: object) => {
    const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      new TextEncoder().encode(payloadB64),
    );
    return `${payloadB64}.${b64url(sig)}`;
  };
  return { pubB64, sign };
}

const NOW = 1_800_000_000_000; // epoch ms fijo
const inOneYear = Math.floor(NOW / 1000) + 365 * 86400;

describe('verifyLicense', () => {
  it('acepta una clave firmada y vigente', async () => {
    const { pubB64, sign } = await makeIssuer();
    const key = await sign({ n: 'Ana Pérez', exp: inOneYear });
    const info = await verifyLicense(key, pubB64, NOW);
    expect(info).toEqual({ name: 'Ana Pérez', exp: inOneYear, type: 'anual' });
  });

  it('lee el tipo firmado y acepta permanentes', async () => {
    const { pubB64, sign } = await makeIssuer();
    const key = await sign({ n: 'Colegio San José', exp: PERMANENT_EXP, t: 'educativa' });
    const info = await verifyLicense(key, pubB64, NOW);
    expect(info).toEqual({ name: 'Colegio San José', exp: PERMANENT_EXP, type: 'educativa' });
    expect(isPermanent(info!)).toBe(true);
  });

  it('un tipo desconocido cuenta como anual', async () => {
    const { pubB64, sign } = await makeIssuer();
    const info = await verifyLicense(await sign({ n: 'X', exp: inOneYear, t: 'vip' }), pubB64, NOW);
    expect(info?.type).toBe('anual');
  });

  it('no se puede cambiar el tipo sin romper la firma', async () => {
    const { pubB64, sign } = await makeIssuer();
    const key = await sign({ n: 'Ana', exp: inOneYear, t: 'anual' });
    const [, sig] = key.split('.');
    const forged = b64url(
      new TextEncoder().encode(JSON.stringify({ n: 'Ana', exp: PERMANENT_EXP, t: 'permanente' })),
    );
    expect(await verifyLicense(`${forged}.${sig}`, pubB64, NOW)).toBeNull();
  });

  it('rechaza exp no numérico', async () => {
    const { pubB64, sign } = await makeIssuer();
    expect(await verifyLicense(await sign({ n: 'Ana', exp: '9999999999' }), pubB64, NOW)).toBeNull();
  });

  it('rechaza una clave caducada', async () => {
    const { pubB64, sign } = await makeIssuer();
    const key = await sign({ n: 'Ana', exp: Math.floor(NOW / 1000) - 10 });
    expect(await verifyLicense(key, pubB64, NOW)).toBeNull();
  });

  it('rechaza si se manipula el payload (firma inválida)', async () => {
    const { pubB64, sign } = await makeIssuer();
    const key = await sign({ n: 'Ana', exp: inOneYear });
    const [, sig] = key.split('.');
    const forged = b64url(
      new TextEncoder().encode(JSON.stringify({ n: 'Ana', exp: inOneYear + 9e6 })),
    );
    expect(await verifyLicense(`${forged}.${sig}`, pubB64, NOW)).toBeNull();
  });

  it('rechaza claves firmadas por otro emisor', async () => {
    const a = await makeIssuer();
    const b = await makeIssuer();
    const key = await a.sign({ n: 'Ana', exp: inOneYear });
    expect(await verifyLicense(key, b.pubB64, NOW)).toBeNull();
  });

  it('rechaza basura sin explotar', async () => {
    const { pubB64 } = await makeIssuer();
    for (const junk of ['', 'abc', 'a.b', '....', 'x'.repeat(500)]) {
      expect(await verifyLicense(junk, pubB64, NOW)).toBeNull();
    }
  });
});
