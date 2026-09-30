// Verificación de licencias OFFLINE con firma ECDSA P-256 (SHA-256).
// Una clave de licencia tiene el formato:  <payloadB64url>.<firmaB64url>
//   payload = JSON { n: nombre, exp: epoch (segundos), t?: tipo }
//   Las permanentes llevan exp = PERMANENT_EXP (año 2100), así las versiones
//   antiguas de la app también las aceptan. `t` va dentro de lo firmado.
//   firma   = ECDSA P-256 (IEEE P1363) del texto payloadB64url, hecha por el
//             autor con su clave privada. La app la verifica con la pública.
import { LICENSE_PUBLIC_KEY_SPKI_B64 } from './branding';

const LS_KEY = 'chamva.license';

export type LicenseType = 'anual' | 'permanente' | 'educativa';
const TYPES: LicenseType[] = ['anual', 'permanente', 'educativa'];

/** 2100-01-01: fecha de caducidad de las licencias permanentes. */
export const PERMANENT_EXP = 4102444800;

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  anual: 'Personal (1 año)',
  permanente: 'Personal permanente',
  educativa: 'Institución educativa (permanente)',
};

export interface LicenseInfo {
  name: string;
  exp: number; // epoch segundos
  type: LicenseType;
}

export const isPermanent = (l: LicenseInfo) => l.exp >= PERMANENT_EXP;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return b64ToBytes(b64 + pad);
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function publicKey(spkiB64: string): Promise<CryptoKey> {
  let p = keyCache.get(spkiB64);
  if (!p) {
    p = crypto.subtle.importKey(
      'spki',
      b64ToBytes(spkiB64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    keyCache.set(spkiB64, p);
  }
  return p;
}

// Verifica firma + caducidad. Devuelve la info si la clave es válida y vigente.
// `spkiB64` permite verificar contra otra clave pública (tests).
export async function verifyLicense(
  key: string,
  spkiB64: string = LICENSE_PUBLIC_KEY_SPKI_B64,
  now: number = Date.now(),
): Promise<LicenseInfo | null> {
  try {
    const trimmed = key.trim();
    const dot = trimmed.indexOf('.');
    if (dot < 1) return null;
    const payloadB64 = trimmed.slice(0, dot);
    const sigB64 = trimmed.slice(dot + 1);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await publicKey(spkiB64),
      b64urlToBytes(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as {
      n?: unknown;
      exp?: unknown;
      t?: unknown;
    };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null; // caducada
    const type = TYPES.includes(payload.t as LicenseType) ? (payload.t as LicenseType) : 'anual';
    return { name: typeof payload.n === 'string' ? payload.n : '', exp: payload.exp, type };
  } catch {
    return null;
  }
}

// Guarda una clave válida y devuelve su info; null si no es válida.
export async function activateLicense(key: string): Promise<LicenseInfo | null> {
  const info = await verifyLicense(key);
  if (info) localStorage.setItem(LS_KEY, key.trim());
  return info;
}

// Lee la licencia guardada y la re-verifica (sigue vigente y firmada).
export async function getStoredLicense(): Promise<LicenseInfo | null> {
  const key = localStorage.getItem(LS_KEY);
  if (!key) return null;
  return verifyLicense(key);
}

export function clearLicense() {
  localStorage.removeItem(LS_KEY);
}
