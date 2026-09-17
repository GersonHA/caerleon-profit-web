/* =====================================================
   Caerleon Profit - cloud-ui.js
   Login, carga inicial, guardado automático y tiempo real con Supabase.
   La lógica de datos está en cloud-core.js; aquí solo va lo del navegador.
   ===================================================== */

(function () {
  'use strict';

  const Cloud = window.CaerleonCloud;
  const cfg = window.CAERLEON_CONFIG || {};
  const CACHE_OWNER_KEY = 'caerleon_cache_owner_v1';

  let client = null;
  let store = null;
  let user = null;
  let pushTimer = null;
  let retryTimer = null;
  let reloading = false;
  let reloadQueued = false;

  const $ = (id) => document.getElementById(id);
  const App = () => window.CaerleonApp;

  // =====================================================
  // Pantallas y estado
  // =====================================================

  /** loading | setup | login | error | app  (ver styles.css) */
  function setScreen(name) {
    document.body.dataset.screen = name;
  }

  const STATUS_TEXT = {
    ok: 'Guardado en la nube',
    syncing: 'Guardando…',
    warn: 'Sin conexión',
    error: 'Error al guardar',
    idle: 'Conectando…',
  };

  function setStatus(kind, text) {
    document.querySelectorAll('[data-cloud-status]').forEach((el) => {
      el.className = `sync-status ${kind}`;
      const txt = el.querySelector('.txt');
      if (txt) txt.textContent = text || STATUS_TEXT[kind];
    });
  }

  function toast(msg, type) {
    if (App()) App().showToast(msg, type);
  }

  function translateAuthError(err) {
    const msg = (err && err.message) || String(err);
    if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
    if (/email not confirmed/i.test(msg)) return 'Tu email todavía no está confirmado.';
    if (/fetch|network/i.test(msg)) return 'No hay conexión con Supabase. Revisa tu internet.';
    if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
    return msg;
  }

  function isConfigured() {
    return /^https?:\/\//.test(cfg.supabaseUrl || '')
      && typeof cfg.supabaseKey === 'string'
      && cfg.supabaseKey.length > 20;
  }

  // =====================================================
  // Login
  // =====================================================

  function waitForLogin() {
    setScreen('login');
    const form = $('loginForm');
    const errorEl = $('loginError');
    const btn = $('loginSubmit');
    setTimeout(() => $('loginEmail').focus(), 50);

    return new Promise((resolve) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Entrando…';
        try {
          const { data, error } = await client.auth.signInWithPassword({
            email: $('loginEmail').value.trim(),
            password: $('loginPassword').value,
          });
          if (error) throw error;
          $('loginPassword').value = '';
          resolve(data.session);
        } catch (err) {
          errorEl.textContent = translateAuthError(err);
          form.classList.remove('shake');
          void form.offsetWidth; // reinicia la animación
          form.classList.add('shake');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Entrar';
        }
      });
    });
  }

  // =====================================================
  // Carga inicial
  // =====================================================

  function waitForRetry(message) {
    setScreen('error');
    $('bootErrorMsg').textContent = message;
    return new Promise((resolve) => {
      $('bootRetry').onclick = () => {
        setScreen('loading');
        resolve();
      };
    });
  }

  async function loadWithRetry() {
    for (;;) {
      try {
        return await store.loadAll();
      } catch (err) {
        console.error('[Cloud] Error cargando datos:', err);
        await waitForRetry(`No se pudieron cargar tus datos: ${translateAuthError(err)}`);
      }
    }
  }

  /** State de la app a partir de lo que hay en la nube (con valores por defecto donde falte). */
  function buildState(remote) {
    const base = App().defaults();
    const current = App().getState() || {};
    const precios = {};
    for (const tier of Object.keys(base.precios)) {
      precios[tier] = remote.precios[tier] || base.precios[tier];
    }
    return {
      precios,
      sellos: { ...base.sellos, ...remote.sellos },
      registro: remote.registro,
      dashboard: remote.dashboard ?? current.dashboard ?? null,
      theme: remote.theme || current.theme || 'light',
      premium: remote.premium !== undefined ? remote.premium
        : (current.premium !== undefined ? current.premium : true),
    };
  }

  function markCacheOwner() {
    try { localStorage.setItem(CACHE_OWNER_KEY, user.id); } catch (e) { /* opcional */ }
  }

  /**
   * Datos que este navegador tenía guardados de la versión anterior (sin
   * nube). Solo se ofrecen si no pertenecen ya a otra cuenta.
   */
  function legacyLocalData() {
    let owner = null;
    try { owner = localStorage.getItem(CACHE_OWNER_KEY); } catch (e) { /* opcional */ }
    if (owner && owner !== user.id) return null;
    if (owner === user.id) return null; // ya es una copia de la nube
    const local = App().loadLocalState();
    return local.registro.length > 0 ? local : null;
  }

  async function loadInitial() {
    store = new Cloud.CloudStore(client, user.id);
    const remote = await loadWithRetry();
    const local = remote.registro.length === 0 ? legacyLocalData() : null;

    store.acceptRemote(remote);

    if (local && confirm(
      `Encontré ${local.registro.length} operaciones guardadas en este navegador ` +
      '(de la versión anterior, sin nube).\n\n¿Subirlas a tu cuenta?'
    )) {
      App().setState({
        precios: local.precios,
        sellos: local.sellos,
        registro: App().normalize(local.registro),
        dashboard: local.dashboard || null,
        theme: local.theme || 'light',
        premium: local.premium !== undefined ? local.premium : true,
      });
      markCacheOwner();
      $('bootLoadingMsg').textContent = `Subiendo ${local.registro.length} operaciones…`;
      await pushNow();
      toast(`☁️ ${local.registro.length} operaciones subidas a tu cuenta`, 'success');
      return;
    }

    App().setState(buildState(remote));
    markCacheOwner();
    App().saveLocal(); // copia local de lo que hay en la nube
  }

  // =====================================================
  // Guardado
  // =====================================================

  function schedulePush() {
    if (!store || !store.ready) return;
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    setStatus('syncing');
    pushTimer = setTimeout(pushNow, 600);
  }

  async function pushNow() {
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!store || !store.ready) return null;
    setStatus('syncing');
    try {
      const result = await store.push(App().getState());
      setStatus('ok', `Guardado ${new Date().toLocaleTimeString()}`);
      return result;
    } catch (err) {
      console.error('[Cloud] Error guardando:', err);
      setStatus('error', 'No se pudo guardar · reintentando');
      toast(`⚠️ No se pudo guardar en la nube: ${translateAuthError(err)}`, 'error');
      retryTimer = setTimeout(schedulePush, 5000);
      return null;
    }
  }

  function hasUnsaved() {
    return !!pushTimer || (store && store.ready && store.hasPending(App().getState()));
  }

  // =====================================================
  // Cambios desde otros dispositivos
  // =====================================================

  async function syncFromCloud({ announce = true, force = false } = {}) {
    if (!store || !store.ready) return;
    if (reloading) {
      reloadQueued = true;
      return;
    }
    reloading = true;
    try {
      // Lo local va primero: nunca se pisa un cambio sin guardar.
      if (hasUnsaved()) await pushNow();
      const remote = await store.loadAll();

      if (store.matchesBaseline(remote)) {
        setStatus('ok', 'Sincronizado');
        if (force) toast('☁️ Ya tienes la última versión', 'info');
        return;
      }
      if (hasUnsaved()) {
        // Editaste algo mientras llegaban los datos: se guarda y se reintenta.
        reloadQueued = true;
        return;
      }

      App().setState(buildState(remote));
      store.acceptRemote(remote);
      App().saveLocal();
      App().refreshAllViews();
      setStatus('ok', 'Sincronizado');
      if (announce) toast('☁️ Datos actualizados desde otro dispositivo', 'info');
    } catch (err) {
      console.warn('[Cloud] No se pudo sincronizar:', err);
      setStatus('warn');
    } finally {
      reloading = false;
      if (reloadQueued) {
        reloadQueued = false;
        setTimeout(() => syncFromCloud({ announce }), 500);
      }
    }
  }

  // =====================================================
  // Cuenta
  // =====================================================

  async function signOut() {
    if (hasUnsaved()) await pushNow();
    if (hasUnsaved() && !confirm('Hay cambios que no se pudieron guardar en la nube. ¿Cerrar sesión igual?')) {
      return;
    }
    if (store) store.unsubscribe();
    await client.auth.signOut();
    location.reload();
  }

  function fillAccountInfo() {
    document.querySelectorAll('[data-user-email]').forEach((el) => {
      el.textContent = user.email;
    });
  }

  function bindAccountButtons() {
    document.querySelectorAll('[data-action="logout"]').forEach((b) => {
      b.addEventListener('click', signOut);
    });
    const reload = $('btnCloudReload');
    if (reload) reload.addEventListener('click', () => syncFromCloud({ announce: true, force: true }));
  }

  // =====================================================
  // API pública (la usa app.js)
  // =====================================================

  async function boot() {
    setScreen('loading');

    if (!window.supabase || !Cloud) {
      await waitForRetry('No se cargaron las librerías de la página. Recarga.');
      location.reload();
    }
    if (!isConfigured()) {
      setScreen('setup');
      return new Promise(() => {}); // se queda en la pantalla de configuración
    }

    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });

    let session = null;
    try {
      ({ data: { session } } = await client.auth.getSession());
    } catch (err) {
      console.warn('[Cloud] Sesión no disponible:', err);
    }
    if (!session) session = await waitForLogin();
    user = session.user;

    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.reload();
    });

    setScreen('loading');
    await loadInitial();
    fillAccountInfo();
    bindAccountButtons();
    setScreen('app');
    setStatus('idle');
  }

  const SAFETY_SYNC_MS = 2 * 60 * 1000;

  function start() {
    store.subscribe(
      () => syncFromCloud({ announce: true }),
      (status) => {
        if (status === 'SUBSCRIBED') setStatus('ok', 'Sincronizado');
        // Conectado (o reconectado): traer lo que haya cambiado mientras tanto.
        else if (status === 'READY') syncFromCloud({ announce: true });
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('warn', 'Tiempo real desconectado');
      }
    );

    // Respaldo por si se perdió algún aviso (Supabase limita avisos por segundo).
    setInterval(() => {
      if (document.visibilityState === 'visible') syncFromCloud({ announce: true });
    }, SAFETY_SYNC_MS);

    // Al volver a la pestaña o recuperar internet: ponerse al día.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncFromCloud({ announce: true });
    });
    window.addEventListener('online', () => syncFromCloud({ announce: true }));
    window.addEventListener('offline', () => setStatus('warn'));

    // Avisar antes de cerrar si algo no llegó a la nube.
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsaved()) {
        pushNow();
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  window.CloudSync = {
    boot,
    start,
    schedulePush,
    pushNow,
    syncFromCloud,
    signOut,
    // Para pruebas y depuración desde la consola
    get store() { return store; },
    get user() { return user; },
  };
})();
