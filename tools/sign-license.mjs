// Emite una clave de licencia de ChamVa (válida 1 año por defecto), firmada con
// tu clave PRIVADA. NO subas la privada al repo.
//
// Uso:
//   node tools/sign-license.mjs "Nombre del cliente" [meses]
//   node tools/sign-license.mjs "Nombre" --tipo permanente
//   node tools/sign-license.mjs "Colegio X" --tipo educativa
// permanente/educativa no caducan (exp = 2100-01-01, válido también en
// versiones antiguas de la app).
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
const tipoIdx = rawArgs.indexOf('--tipo');
const tipo = tipoIdx >= 0 ? rawArgs[tipoIdx + 1] : 'anual';
if (!['anual', 'permanente', 'educativa'].includes(tipo)) {
  console.error('Tipo no válido: usa anual, permanente o educativa');
  process.exit(1);
}
const positional = rawArgs.filter((a, i) => !a.startsWith('--') && !(tipoIdx >= 0 && i === tipoIdx + 1));
const name = positional[0] || 'Cliente';
const months = Number(positional[1] || 12);
const PERMANENT_EXP = 4102444800; // 2100-01-01, igual que src/license.ts

const privB64 = loadPrivateB64();
const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privB64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

const exp =
  tipo === 'anual'
    ? Math.floor(Date.now() / 1000) + Math.round(months * 30.44 * 86400)
    : PERMANENT_EXP;
const payloadJson = JSON.stringify(tipo === 'anual' ? { n: name, exp } : { n: name, exp, t: tipo });
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
  console.log('Tipo:', tipo);
  console.log('Caduca:', tipo === 'anual' ? new Date(exp * 1000).toISOString().slice(0, 10) : 'nunca');
  console.log('\nCLAVE (entrégasela al cliente):\n');
  console.log(licenseKey);
  console.log('');
}
