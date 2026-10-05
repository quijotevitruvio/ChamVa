// Datos del autor, enlaces de apoyo y clave pública de licencias.
// La clave PRIVADA correspondiente NO está aquí (es secreta del autor; se usa
// con tools/sign-license.mjs para emitir claves de licencia).

export const APP_VERSION = '0.8.0';

export const AUTHOR = {
  name: 'Andrés Valencia Tobón',
  email: 'quijotevitruvio@gmail.com',
  github: 'https://github.com/quijotevitruvio',
  repo: 'https://github.com/quijotevitruvio/ChamVa',
  linkedin: 'https://www.linkedin.com/in/andr%C3%A9s-valencia-tob%C3%B3n/',
  paypal: 'https://paypal.me/bibliotecologo',
};

// Formas de apoyo y precios de las licencias (el autor los edita aquí).
export const SUPPORT = {
  sponsors: 'https://github.com/sponsors/quijotevitruvio',
  nequi: '3003000958',
};

export const LICENSE_PLANS = [
  { type: 'anual', label: 'Personal · 1 año', price: '$20.000 COP' },
  { type: 'permanente', label: 'Personal · permanente', price: '$60.000 COP' },
  {
    type: 'educativa',
    label: 'Institución educativa · permanente',
    price: '$150.000 COP',
    note: 'Gratis si el colegio la solicita formalmente por correo, justificando el uso educativo.',
  },
] as const;

// Meta de donaciones que se muestra en el aviso de apoyo. `raised` se
// actualiza a mano; con 0 solo se muestra la meta.
export const GOAL = {
  label: 'Certificado de firma de código para Windows (quita el aviso "editor desconocido")',
  target: 800000,
  raised: 0,
};

// Clave pública (SPKI, base64) para verificar licencias firmadas — offline.
export const LICENSE_PUBLIC_KEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9h9iiYEObvbbiPyyIEv8wFCcM9e4WVQ4eYCLJj0tz9uNsGX29Ij1Axbtfsj9CspHO7fFwyIUH65oGnLK2nylZA==';
