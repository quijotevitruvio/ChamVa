// Datos del autor, enlaces de apoyo y clave pública de licencias.
// La clave PRIVADA correspondiente NO está aquí (es secreta del autor; se usa
// con tools/sign-license.mjs para emitir claves de licencia).

export const AUTHOR = {
  name: 'Andrés Valencia Tobón',
  email: 'andres@librosmedellin.com',
  github: 'https://github.com/quijotevitruvio',
  linkedin: 'https://www.linkedin.com/in/andr%C3%A9s-valencia-tob%C3%B3n/',
  paypal: 'https://paypal.me/bibliotecologo',
};

// Clave pública (SPKI, base64) para verificar licencias firmadas — offline.
export const LICENSE_PUBLIC_KEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9h9iiYEObvbbiPyyIEv8wFCcM9e4WVQ4eYCLJj0tz9uNsGX29Ij1Axbtfsj9CspHO7fFwyIUH65oGnLK2nylZA==';
