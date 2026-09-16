/* =====================================================
   Configuración de Supabase
   ===================================================== */

// Datos de TU proyecto: Supabase → Project Settings → API
//   supabaseUrl → "Project URL"
//   supabaseKey → la clave pública: "anon" o "publishable"
//
// Estas dos son públicas por diseño y pueden estar en GitHub: lo que protege
// tus datos son el login y las reglas RLS de la base de datos.
// NUNCA pongas aquí la clave "service_role" ni la "secret".
const CAERLEON_PROD = {
  supabaseUrl: 'https://mowpouwtwesxmwhanzck.supabase.co',
  supabaseKey: 'sb_publishable_0xe1ru2LgE0ZZWYmn5A2Vg_dAQwSLIC',
};

// Supabase local (Docker) para pruebas: se activa abriendo la página con ?dev=1
// y se desactiva con ?dev=0. Son las claves de demostración del CLI de Supabase.
const CAERLEON_DEV = {
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
};

(function () {
  let dev = false;
  try {
    const flag = new URLSearchParams(location.search).get('dev');
    if (flag !== null) sessionStorage.setItem('caerleon_dev', flag === '1' ? '1' : '0');
    dev = sessionStorage.getItem('caerleon_dev') === '1';
  } catch (e) { /* sin sessionStorage: producción */ }
  window.CAERLEON_CONFIG = dev ? CAERLEON_DEV : CAERLEON_PROD;
  window.CAERLEON_CONFIG.mode = dev ? 'dev' : 'prod';
})();
