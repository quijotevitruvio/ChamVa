// Emite una clave de licencia de ChamVa (válida 1 año por defecto), firmada con
// tu clave PRIVADA. NO subas la privada al repo.
//
// Uso:
//   node tools/sign-license.mjs "Nombre del cliente" [meses]
//
// La clave privada se lee de la variable de entorno CHAMVA_PRIVATE_KEY
// (base64 PKCS8) o del archivo tools/private-key.txt (ignorado por git).
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

function loadPrivateB64() {
  if (process.env.CHAMVA_PRIVATE_KEY) return process.env.CHAMVA_PRIVATE_KEY.trim();
  try {
    return readFileSync(new URL('./private-key.txt', import.meta.url), 'utf8').trim();
  } catch {
    console.error(
      'Falta la clave privada. Define CHAMVA_PRIVATE_KEY o crea tools/private-key.txt',
    );
    process.exit(1);
  }
}

const rawArgs = process.argv.slice(2);
const raw = rawArgs.includes('--raw'); // imprime SOLO la clave (para scripts)
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const name = positional[0] || 'Cliente';
const months = Number(positional[1] || 12);

const privB64 = loadPrivateB64();
const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privB64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

const exp = Math.floor(Date.now() / 1000) + Math.round(months * 30.44 * 86400);
const payloadJson = JSON.stringify({ n: name, exp });
const payloadB64 = Buffer.from(payloadJson, 'utf8')
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

// Firma IEEE P1363 (raw r||s) — el formato que espera WebCrypto.
const sig = crypto.sign('sha256', Buffer.from(payloadB64, 'utf8'), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
});
const sigB64 = sig
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

const licenseKey = `${payloadB64}.${sigB64}`;
if (raw) {
  process.stdout.write(licenseKey);
} else {
  console.log('\nLicencia para:', name);
  console.log('Caduca:', new Date(exp * 1000).toISOString().slice(0, 10));
  console.log('\nCLAVE (entrégasela al cliente):\n');
  console.log(licenseKey);
  console.log('');
}
