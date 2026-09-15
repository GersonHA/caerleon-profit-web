/* =====================================================
   Caerleon Profit Calculator - app.js
   Toda la lógica: estado, cálculos, UI, charts, persistencia
   ===================================================== */

'use strict';

// =====================================================
// CONSTANTES Y DATOS AUXILIARES
// =====================================================

const TIPOS_OBJETO = [
  { nombre: 'Arma 2H',      matPorPaso: 384, baseId: '2H_CROSSBOW' },
  { nombre: 'Arma 1H',      matPorPaso: 288, baseId: 'MAIN_SWORD' },
  { nombre: 'Secundaria',   matPorPaso: 96,  baseId: 'OFF_SHIELD' },
  { nombre: 'Cabeza',       matPorPaso: 96,  baseId: 'HEAD_CLOTH_SET1' },
  { nombre: 'Pecho',        matPorPaso: 192, baseId: 'ARMOR_CLOTH_SET1' },
  { nombre: 'Pies',         matPorPaso: 96,  baseId: 'SHOES_CLOTH_SET1' },
  { nombre: 'Capa',         matPorPaso: 96,  baseId: 'CAPE' },
  { nombre: 'Bolsa',        matPorPaso: 192, baseId: 'BAG' },
];

// URLs de imágenes del CDN oficial de Albion Online
// Para usar imágenes locales, cambia a: const IMG_BASE = 'img'; y descarga las imágenes
const IMG_BASE = 'https://render.albiononline.com/v1/item';
function imgUrl(itemId) { return `${IMG_BASE}/${itemId}.png`; }

// Construye ID dinámico según tier (e.g., tier=4 + '2H_CROSSBOW' → 'T4_2H_CROSSBOW')
function tierItemId(baseId, tier) { return `T${tier}_${baseId}`; }
function tierMatId(mat, tier) { return `T${tier}_${mat.toUpperCase()}`; }

const MATERIAL_BASE = { runa: 'RUNE', alma: 'SOUL', relic: 'RELIC' };

const IP_BASE = { 4: 700, 5: 800, 6: 900, 7: 1000, 8: 1100 };

// Royal Sigil crafting data (only armor pieces — capes use Crest+Heart, not Sigils)
// Item ID format for Royal: T{tier}_{SLOT}_{MATERIAL}_ROYAL@{ench} (English IDs required by CDN)
// Sigil counts DOUBLED per tier (verified from albionfreemarket.com API):
//   T4 boots/helmet = 2 sigils, T5 = 4, T6 = 8
//   T4 chest        = 4 sigils, T5 = 8, T6 = 16
const ROYAL_SLOTS = {
  helmet: { sigilsPerCraft: { 4: 2, 5: 4, 6: 8 },   matPorPaso: 96,  name: 'Casco Real',   slot: 'HEAD'  },
  chest:  { sigilsPerCraft: { 4: 4, 5: 8, 6: 16 },  matPorPaso: 192, name: 'Peto Real',    slot: 'ARMOR' },
  boots:  { sigilsPerCraft: { 4: 2, 5: 4, 6: 8 },   matPorPaso: 96,  name: 'Botas Reales', slot: 'SHOES' },
};
const ROYAL_TIER_NAMES = {
  4: "Sello Real de Aprendiz",
  5: "Sello Real de Experto",
  6: "Sello Real de Maestro",
};
const ROYAL_MATERIAL_NAMES = { cloth: 'CLOTH', leather: 'LEATHER', plate: 'PLATE' };  // English for CDN
const ROYAL_MATERIAL_DISPLAY = { cloth: 'Tela', leather: 'Cuero', plate: 'Placa' };

const DEFAULT_PRECIOS = {
  4: { runa: 10,   alma: 66,    relic: 405    },
  5: { runa: 500,  alma: 2500,  relic: 10000  },
  6: { runa: 2500, alma: 12000, relic: 50000  },
  7: { runa: 10000,alma: 50000, relic: 200000 },
  8: { runa: 40000,alma: 200000,relic: 800000 },
};

const DEFAULT_SELLOS = {
  4: 4500,   // Sello Real de Aprendiz
  5: 25000,  // Sello Real de Experto
  6: 150000, // Sello Real de Maestro
};

// Royal Sigil CDN IDs (from gameinfo API format)
const ROYAL_SIGIL_IMG = {
  4: 'QUESTITEM_TOKEN_ROYAL_T4',
  5: 'QUESTITEM_TOKEN_ROYAL_T5',
  6: 'QUESTITEM_TOKEN_ROYAL_T6',
};

const STORAGE_KEY = 'caerleon_profit_data_v1';
const BACKUP_KEY = 'caerleon_profit_backup_v1';
const SYNC_CONFIG_KEY = 'caerleon_sync_config_v1';
const SYNC_FILENAME = 'caerleon-profit-data.json';

// GitHub Gist sync state
let syncConfig = loadSyncConfig();
let syncStatus = { state: 'idle', msg: 'Sin sincronizar', lastSync: null, remoteUpdated: null };
let syncTimer = null;
let syncInterval = null;
let syncInFlight = false;

// =====================================================
// STATE (carga desde localStorage o inicializa)
// =====================================================

let state = loadState();

// Dashboard period/goal state (not persisted - ephemeral UI)
let dashFilters = {
  period: 'month',     // 'week' | 'month' | 'custom'
  month: null,         // { year, month } when period='month'
  customFrom: null,    // YYYY-MM-DD
  customTo: null,      // YYYY-MM-DD
  goalAmount: 1000000,
  goalPeriod: 'month',
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migration: ensure all ops have ventas array and add date to venta events
      const registro = (parsed.registro || []).map(op => migrateOpVenta(op));
      return {
        precios: parsed.precios || structuredClone(DEFAULT_PRECIOS),
        sellos: parsed.sellos || structuredClone(DEFAULT_SELLOS),
        registro,
        theme: parsed.theme || 'light',
        premium: parsed.premium !== undefined ? parsed.premium : true,
      };
    }
  } catch (e) {
    console.error('Error cargando state:', e);
  }
  return {
    precios: structuredClone(DEFAULT_PRECIOS),
    sellos: structuredClone(DEFAULT_SELLOS),
    registro: [],
    theme: 'light',
    premium: true,
  };
}

// Migration helper: ensure op has ventas array and proper format
function migrateOpVenta(op) {
  if (!op.ventas) {
    op.ventas = [];
    // Auto-create one "vendido" venta from existing pVenta if applicable
    if (op.pVenta && op.pVenta > 0) {
      op.ventas.push({
        id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        fecha: op.fecha || localDateStr(),
        hora: '12:00',
        precio: op.pVenta,
        comprador: 'bm',
        estado: 'vendido',
        notas: 'Migrado automáticamente',
      });
    }
  }
  return op;
}

// Helpers for sale events (Option B)
function getOpActivityTime(op) {
  // Returns ISO-like string for sorting: latest venta (fecha+hora) or op fecha as fallback
  if (op.ventas && op.ventas.length > 0) {
    return op.ventas.reduce((latest, v) => {
      const t = `${v.fecha || ''}T${v.hora || '00:00'}`;
      return t > latest ? t : latest;
    }, '0000-00-00T00:00');
  }
  return `${op.fecha || '0000-00-00'}T12:00`;
}

function getOpStatus(op) {
  if (!op.ventas || op.ventas.length === 0) return 'crafteado';
  const hasSold = op.ventas.some(v => v.estado === 'vendido');
  if (hasSold) return 'vendido';
  const hasPending = op.ventas.some(v => v.estado === 'pendiente');
  if (hasPending) return 'pendiente';
  return 'fallido'; // all failed or none sold/pending
}

function getOpActualProfit(op) {
  // Profit = sum of sold venta prices - cost - tax
  const soldVentas = (op.ventas || []).filter(v => v.estado === 'vendido');
  if (soldVentas.length === 0) return 0;
  const totalSold = soldVentas.reduce((s, v) => s + (v.precio * (op.qty || 1)), 0);
  const tax = state.premium ? 0.04 : 0.08;
  const netRevenue = totalSold * (1 - tax);
  return netRevenue - (op.inversion || 0);
}

function addVenta(opId, ventaData) {
  const op = state.registro.find(r => r.id === opId);
  if (!op) return false;
  if (!op.ventas) op.ventas = [];
  op.ventas.push({
    id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    fecha: ventaData.fecha || localDateStr(),
    hora: ventaData.hora || new Date().toTimeString().slice(0, 5),
    precio: ventaData.precio || 0,
    comprador: ventaData.comprador || 'bm',
    estado: ventaData.estado || 'pendiente',
    notas: ventaData.notas || '',
  });
  saveState();
  return true;
}

function updateVenta(opId, ventaId, updates) {
  const op = state.registro.find(r => r.id === opId);
  if (!op || !op.ventas) return false;
  const venta = op.ventas.find(v => v.id === ventaId);
  if (!venta) return false;
  Object.assign(venta, updates);
  saveState();
  return true;
}

function deleteVenta(opId, ventaId) {
  const op = state.registro.find(r => r.id === opId);
  if (!op || !op.ventas) return false;
  op.ventas = op.ventas.filter(v => v.id !== ventaId);
  saveState();
  return true;
}

const COMPRADOR_LABELS = {
  bm: '🏛️ Mercado Negro',
  player: '👥 Mercado Jugadores',
  guild: '🏰 Gremio',
  direct: '🤝 Directo',
};

const ESTADO_VENTA_LABELS = {
  pendiente: '⏳ Pendiente',
  vendido: '✅ Vendido',
  fallido: '❌ Fallido',
};

function saveState() {
  try {
    state._updated = new Date().toISOString();
    const payload = {
      _updated: state._updated,
      precios: state.precios,
      sellos: state.sellos,
      registro: state.registro,
      theme: state.theme,
      premium: state.premium,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    // Auto-backup: keep last known good state with data
    if (state.registro.length > 0) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify({
          ...payload,
          _backupAt: new Date().toISOString(),
        }));
      } catch (e) { /* backup is best-effort */ }
    }
    // Schedule cloud sync if configured
    if (syncConfig && syncConfig.token && syncConfig.gistId) {
      scheduleSyncPush();
    }
  } catch (e) {
    console.error('Error guardando state:', e);
    showToast('Error guardando datos', 'error');
  }
}

// Restore from local backup (if main localStorage got wiped or sync wiped data)
function restoreFromBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.precios || !data.registro) return false;
    if (data.registro.length === 0) return false;
    state.precios = data.precios;
    if (data.sellos) state.sellos = data.sellos;
    state.registro = data.registro.map(op => migrateOpVenta(op));
    if (data.premium !== undefined) state.premium = data.premium;
    saveState();
    initPrecios();
    updateCalculadora();
    updateRegistro();
    updateDashboard();
    updateStorageInfo();
    return true;
  } catch (e) {
    console.error('Backup restore failed:', e);
    return false;
  }
}

// =====================================================
// GITHUB GIST SYNC
// =====================================================

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error cargando sync config:', e);
  }
  return null;
}

function saveSyncConfig(cfg) {
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
    syncConfig = cfg;
  } catch (e) {
    console.error('Error guardando sync config:', e);
  }
}

function clearSyncConfig() {
  localStorage.removeItem(SYNC_CONFIG_KEY);
  syncConfig = null;
}

function setSyncStatus(state, msg) {
  syncStatus.state = state;
  syncStatus.msg = msg;
  updateSyncUI();
}

function gistApi(path, method, body, token) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function testGistConnection(token, gistId) {
  if (!token) throw new Error('Falta el token');
  // Verify token by getting user
  const userRes = await gistApi('/user', 'GET', null, token);
  if (!userRes.ok) {
    if (userRes.status === 401) throw new Error('Token inválido o expirado');
    throw new Error(`Error de autenticación (${userRes.status})`);
  }
  const user = await userRes.json();
  // If gistId provided, verify access
  if (gistId) {
    const gistRes = await gistApi(`/gists/${gistId}`, 'GET', null, token);
    if (!gistRes.ok) {
      if (gistRes.status === 404) throw new Error('Gist no encontrado o sin acceso');
      throw new Error(`Error accediendo al gist (${gistRes.status})`);
    }
    return { user: user.login, gistId };
  }
  return { user: user.login, gistId: null };
}

async function createGist(token) {
  const body = {
    description: 'Caerleon Profit Calculator — datos sincronizados',
    public: false,
    files: {
      [SYNC_FILENAME]: {
        content: JSON.stringify({
          version: 1,
          created: new Date().toISOString(),
          precios: state.precios,
          registro: state.registro,
            sellos: state.sellos,
          premium: state.premium,
        }, null, 2),
      },
    },
  };
  const res = await gistApi('/gists', 'POST', body, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Error creando gist (${res.status})`);
  }
  const data = await res.json();
  return data.id;
}

async function pushToGist() {
  if (!syncConfig || !syncConfig.token || !syncConfig.gistId) return false;

  // SAFETY: ALWAYS check remote before pushing to avoid overwriting more data
  if (state.registro.length === 0) {
    // Local empty → pull if remote has anything
    try {
      const checkRes = await gistApi(`/gists/${syncConfig.gistId}?_=${Date.now()}`, 'GET', null, syncConfig.token);
      if (checkRes.ok) {
        const remoteData = await checkRes.json();
        const remoteFile = remoteData.files[SYNC_FILENAME] || Object.values(remoteData.files)[0];
        if (remoteFile) {
          const remote = JSON.parse(remoteFile.content);
          const remoteCount = remote.registro?.length || 0;
          if (remoteCount > 0) {
            console.warn('[Push Safety] Local empty, remote has', remoteCount, 'ops — switching to pull');
            setSyncStatus('warn', `⚠️ Local vacío · Trayendo ${remoteCount} ops de la nube…`);
            return await pullFromGist();
          }
        }
      }
    } catch (e) {
      console.warn('[Push Safety] Pre-check failed, proceeding with push:', e.message);
    }
  } else {
    // Local has data → CRITICAL: don't push if remote has MORE ops
    try {
      const checkRes = await gistApi(`/gists/${syncConfig.gistId}?_=${Date.now()}`, 'GET', null, syncConfig.token);
      if (checkRes.ok) {
        const remoteData = await checkRes.json();
        const remoteFile = remoteData.files[SYNC_FILENAME] || Object.values(remoteData.files)[0];
        if (remoteFile) {
          const remote = JSON.parse(remoteFile.content);
          const remoteCount = remote.registro?.length || 0;
          const localCount = state.registro.length;
          if (remoteCount > localCount) {
            console.warn(`[Push Safety] Local ${localCount} < Remote ${remoteCount} — pulling instead`);
            setSyncStatus('warn', `⚠️ Nube tiene ${remoteCount} ops (más que local) · mergeando…`);
            const merge = mergeRegistros(state.registro, remote.registro);
            state.registro = merge.merged.map(op => migrateOpVenta(op));
            state.precios = mergePrecios(state.precios, remote.precios);
            if (remote.sellos) state.sellos = { ...state.sellos, ...remote.sellos };
            if (remote._updated) state._updated = remote._updated;
            saveState();
            initPrecios();
            updateCalculadora();
            updateRegistro();
            updateDashboard();
            updateStorageInfo();
            syncStatus.lastSync = new Date();
            setSyncStatus('ok', `☁️ Merge · ${merge.keptUniqueLocal}+${merge.addedFromRemote} = ${merge.merged.length}`);
            showToast(`☁️ ${merge.addedFromRemote} ops nuevas (total: ${merge.merged.length})`, 'success');
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('[Push Safety] Pre-check failed, proceeding with push:', e.message);
    }
  }

  setSyncStatus('syncing', 'Subiendo a la nube…');

  const expectedContent = JSON.stringify({
    version: 1,
    updated: new Date().toISOString(),
    precios: state.precios,
    registro: state.registro,
    sellos: state.sellos,
    premium: state.premium,
  }, null, 2);

  const payload = {
    description: 'Caerleon Profit Calculator — datos sincronizados',
    files: {
      [SYNC_FILENAME]: {
        content: expectedContent,
      },
    },
  };

  // Retry up to 2 times
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await gistApi(`/gists/${syncConfig.gistId}?_t=${Date.now()}`, 'PATCH', payload, syncConfig.token);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error subiendo (${res.status})`);
      }

      // VERIFY the push actually went through (read back and compare)
      const verifyRes = await gistApi(`/gists/${syncConfig.gistId}?_t=${Date.now()}&v=${Math.random()}`, 'GET', null, syncConfig.token);
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        const verifyFile = verifyData.files[SYNC_FILENAME];
        const verifyContent = verifyFile?.content;
        if (verifyContent === expectedContent) {
          // Success! Verification passed
          if (verifyData.updated_at) syncStatus.remoteUpdated = verifyData.updated_at;
          syncStatus.lastSync = new Date();
          setSyncStatus('ok', `✅ Sincronizado ${syncStatus.lastSync.toLocaleTimeString()} (${state.registro.length} ops)`);
          showToast(`☁️ Push verificado · ${state.registro.length} ops en la nube`, 'success');
          return true;
        } else {
          // Verification failed — content mismatch
          console.warn(`[Push] Attempt ${attempt}: content mismatch after PATCH. Expected length ${expectedContent.length}, got ${verifyContent?.length}`);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 500)); // wait 500ms before retry
            continue;
          }
          throw new Error('Verificación falló: el contenido no coincide después de 2 intentos. Intenta manualmente.');
        }
      } else {
        // Verification GET failed, but PATCH succeeded — assume it worked
        console.warn('[Push] Verification GET failed, trusting PATCH response');
        syncStatus.lastSync = new Date();
        setSyncStatus('ok', `✅ Sincronizado (sin verificación)`);
        showToast(`☁️ Push completo · ${state.registro.length} ops`, 'success');
        return true;
      }
    } catch (e) {
      console.error(`[Push] Attempt ${attempt} failed:`, e.message);
      if (attempt === 2) {
        setSyncStatus('error', `❌ ${e.message}`);
        showToast(`Error push: ${e.message}`, 'error');
        return false;
      }
      await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
    }
  }
  return false;
}

async function pullFromGist() {
  if (!syncConfig || !syncConfig.token || !syncConfig.gistId) {
    showToast('Configura la sincronización primero', 'warn');
    return false;
  }
  setSyncStatus('syncing', 'Descargando de la nube…');
  try {
    // Cache-bust to avoid stale API responses
    const res = await gistApi(`/gists/${syncConfig.gistId}?_=${Date.now()}`, 'GET', null, syncConfig.token);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error descargando (${res.status})`);
    }
    const data = await res.json();
    const file = data.files[SYNC_FILENAME] || Object.values(data.files)[0];
    if (!file) throw new Error('Gist sin archivo de datos');
    const remote = JSON.parse(file.content);
    if (data.updated_at) syncStatus.remoteUpdated = data.updated_at;
    console.log('[Sync Pull] Recibido:', {
      hasPrecios: !!remote.precios,
      hasRegistro: !!remote.registro,
      registroCount: remote.registro?.length || 0,
      updated: remote.updated,
    });
    if (!remote.precios || !remote.registro) throw new Error('Formato de datos inválido');

    const remoteCount = remote.registro.length;
    const localCount = state.registro.length;
    const updatedRemote = remote.updated ? ` (subido ${new Date(remote.updated).toLocaleString()})` : '';
    const msg = `La nube tiene ${remoteCount} operaciones${updatedRemote}, tú tienes ${localCount} aquí.`;
    let apply = false;
    if (remoteCount === 0 && localCount === 0) {
      apply = true; // both empty
    } else if (remoteCount === 0) {
      apply = confirm(`${msg}\n\nLa nube está vacía. ¿Reemplazar con datos vacíos?\n(Cancela para conservar tus datos locales)`);
    } else if (localCount === 0) {
      apply = true; // local empty, take remote
    } else {
      apply = confirm(`${msg}\n\n¿Reemplazar tus datos locales con los de la nube?\n(Cancela para conservar lo que tienes aquí)`);
    }
    if (!apply) {
      setSyncStatus('idle', 'Sincronización cancelada — datos locales intactos');
      return false;
    }

    // SMART MERGE for manual pull too (in case local has unique items)
    const merge = mergeRegistros(state.registro, remote.registro);
    state.registro = merge.merged.map(op => migrateOpVenta(op));
    state.precios = mergePrecios(state.precios, remote.precios);
    if (remote.sellos) state.sellos = { ...state.sellos, ...remote.sellos };
    if (remote.premium !== undefined) state.premium = remote.premium;
    saveState();
    initPrecios();
    updateCalculadora();
    updateRegistro();
    updateDashboard();
    updateStorageInfo();

    syncStatus.lastSync = new Date();
    if (merge.addedFromRemote > 0 && merge.keptUniqueLocal > 0) {
      setSyncStatus('ok', `⬇️ Merge · ${merge.keptUniqueLocal} locales + ${merge.addedFromRemote} remotas = ${merge.merged.length}`);
      showToast(`☁️ Sincronización: ${merge.merged.length} operaciones totales`, 'success');
    } else {
      setSyncStatus('ok', `⬇️ ${remoteCount} operaciones traídas${updatedRemote}`);
      showToast(`☁️ ${remoteCount} operaciones sincronizadas`, 'success');
    }
    // Push merged state up so gist has all items
    scheduleSyncPush();
    return true;
  } catch (e) {
    console.error('Sync pull error:', e);
    setSyncStatus('error', `❌ ${e.message}`);
    showToast(`Error: ${e.message}`, 'error');
    return false;
  }
}

function scheduleSyncPush() {
  if (syncTimer) clearTimeout(syncTimer);
  setSyncStatus('warn', '⏱ Sync programado en 3s…');
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    // SAFETY: if local has 0 ops, do a quick pull-check before pushing
    if (state.registro.length === 0) {
      try {
        const checkRes = await gistApi(`/gists/${syncConfig.gistId}?_=${Date.now()}`, 'GET', null, syncConfig.token);
        if (checkRes.ok) {
          const remoteData = await checkRes.json();
          const remoteFile = remoteData.files[SYNC_FILENAME] || Object.values(remoteData.files)[0];
          if (remoteFile) {
            const remote = JSON.parse(remoteFile.content);
            const remoteCount = remote.registro?.length || 0;
            if (remoteCount > 0) {
              console.warn('[Sync Safety] Local empty but remote has', remoteCount, 'ops — pulling instead of pushing');
              setSyncStatus('warn', `⚠️ Local vacío · trayendo ${remoteCount} ops de la nube…`);
              await pullFromGist();
              return;
            }
          }
        }
      } catch (e) {
        console.warn('[Sync Safety] Pre-check failed:', e.message);
      }
    }
    pushToGist();
  }, 3000);
}

// =====================================================
// SMART MERGE (combine local + remote to avoid data loss)
// =====================================================

function mergeRegistros(localReg, remoteReg) {
  // Build a Set of existing IDs to dedupe
  const localIds = new Set(localReg.map(r => r.id));
  // Items unique to remote (not in local) → add them
  const newFromRemote = remoteReg.filter(r => !localIds.has(r.id));
  // Combine: keep ALL local items + add new from remote (never lose local data)
  return {
    merged: [...localReg, ...newFromRemote],
    addedFromRemote: newFromRemote.length,
    keptUniqueLocal: localReg.length,
  };
}

function mergePrecios(localP, remoteP) {
  // For each tier+material, use the most recent non-zero value
  const result = structuredClone(localP);
  for (const tier of Object.keys(remoteP)) {
    if (!result[tier]) result[tier] = { runa: 0, alma: 0, relic: 0 };
    for (const mat of ['runa', 'alma', 'relic']) {
      const rv = remoteP[tier]?.[mat] || 0;
      const lv = result[tier][mat] || 0;
      // Take remote if local is 0/default, otherwise keep local
      result[tier][mat] = lv > 0 ? lv : rv;
    }
  }
  return result;
}

// =====================================================
// AUTO-SYNC (background polling for true cross-device sync)
// =====================================================

async function checkRemoteChanges({ silent = true } = {}) {
  if (!syncConfig || !syncConfig.token || !syncConfig.gistId) return false;
  if (syncInFlight) return false;
  syncInFlight = true;
  try {
    const res = await gistApi(`/gists/${syncConfig.gistId}?_=${Date.now()}`, 'GET', null, syncConfig.token);
    if (!res.ok) return false;
    const data = await res.json();
    const file = data.files[SYNC_FILENAME] || Object.values(data.files)[0];
    if (!file) return false;
    const remote = JSON.parse(file.content);
    const remoteUpdated = remote._updated || data.updated_at || '';
    const localUpdated = state._updated || '';

    // Update in-memory tracking
    syncStatus.remoteUpdated = remoteUpdated;

    // Compare timestamps — newer wins
    if (remoteUpdated === localUpdated) {
      // Already in sync (timestamps match exactly)
      setSyncStatus('ok', `☁️ Sincronizado · ${remote.registro?.length || 0} ops`);
      return false;
    }

    const localCount = state.registro.length;
    const remoteCount = remote.registro?.length || 0;

    console.log('[AutoSync] Compare:', { localUpdated, remoteUpdated, localCount, remoteCount });

    // SAFETY: NEVER push if local has fewer ops than remote (could wipe data)
    if (localCount > 0 && remoteCount > localCount) {
      console.warn('[AutoSync] SAFETY: Local has fewer ops than remote — switching to pull instead of push');
      setSyncStatus('warn', `⚠️ Local tiene ${localCount} ops · nube tiene ${remoteCount} · trayendo…`);
      if (localCount === 0) {
        await applyRemoteData(remote, silent);
      } else {
        const merge = mergeRegistros(state.registro, remote.registro);
        if (merge.addedFromRemote > 0) {
          state.registro = merge.merged.map(op => migrateOpVenta(op));
          state.precios = mergePrecios(state.precios, remote.precios);
          if (remote.sellos) state.sellos = { ...state.sellos, ...remote.sellos };
          state._updated = remoteUpdated;
          saveState();
          initPrecios();
          updateCalculadora();
          updateRegistro();
          updateDashboard();
          updateStorageInfo();
          syncStatus.lastSync = new Date();
          setSyncStatus('ok', `☁️ Merge · ${merge.keptUniqueLocal} locales + ${merge.addedFromRemote} remotas = ${merge.merged.length}`);
          if (!silent) showToast(`☁️ ${merge.addedFromRemote} ops nuevas de la nube (total: ${merge.merged.length})`, 'success');
        }
      }
      return true;
    }

    // Determine which is newer (only when counts are equal or local has more)
    const remoteIsNewer = !localUpdated || remoteUpdated > localUpdated;

    if (remoteIsNewer) {
      // Remote is newer (or local is empty) → pull
      if (localCount === 0) {
        // Local empty, just take remote
        await applyRemoteData(remote, silent);
        state._updated = remoteUpdated;
        if (!silent) showToast(`☁️ ${remoteCount} operaciones descargadas de la nube`, 'success');
      } else {
        // Both have data → smart merge
        const merge = mergeRegistros(state.registro, remote.registro);
        console.log('[AutoSync] Smart merge:', merge);
        if (merge.addedFromRemote > 0) {
          state.registro = merge.merged.map(op => migrateOpVenta(op));
          state.precios = mergePrecios(state.precios, remote.precios);
          if (remote.sellos) state.sellos = { ...state.sellos, ...remote.sellos };
          state._updated = remoteUpdated;
          saveState();
          initPrecios();
          updateCalculadora();
          updateRegistro();
          updateDashboard();
          updateStorageInfo();
          syncStatus.lastSync = new Date();
          setSyncStatus('ok', `☁️ Merge · ${merge.keptUniqueLocal} locales + ${merge.addedFromRemote} remotas = ${merge.merged.length}`);
          if (!silent) showToast(`☁️ ${merge.addedFromRemote} ops nuevas de la nube (total: ${merge.merged.length})`, 'success');
        } else {
          // No new items, just update timestamps
          state._updated = remoteUpdated;
          saveState();
          setSyncStatus('ok', `☁️ Sincronizado · ${merge.merged.length} ops`);
        }
      }
    } else {
      // Local is newer → push (with safety check inside pushToGist)
      console.log('[AutoSync] Local newer, pushing');
      await pushToGist();
    }
    return true;
  } catch (e) {
    console.warn('[AutoSync] Check failed:', e.message);
    return false;
  } finally {
    syncInFlight = false;
  }
}

async function applyRemoteData(remote, silent) {
  state.precios = remote.precios;
  if (remote.sellos) state.sellos = { ...state.sellos, ...remote.sellos };
  state.registro = (remote.registro || []).map(op => migrateOpVenta(op));
  if (remote.premium !== undefined) state.premium = remote.premium;
  saveState();
  initPrecios();
  updateCalculadora();
  updateRegistro();
  updateDashboard();
  updateStorageInfo();
  syncStatus.lastSync = new Date();
  setSyncStatus('ok', `☁️ Auto-sync · ${remote.registro.length} ops`);
  console.log('[AutoSync] Applied remote data:', remote.registro.length, 'ops');
}

function startAutoSync() {
  if (syncInterval) return; // Already running
  // Poll every 30s when tab is visible
  syncInterval = setInterval(() => {
    if (!document.hidden && document.visibilityState === 'visible') {
      checkRemoteChanges({ silent: false });
    }
  }, 30000);
  // Also check immediately when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkRemoteChanges({ silent: false });
    }
  });
  // And when window gets focus
  window.addEventListener('focus', () => checkRemoteChanges({ silent: false }));
  console.log('[AutoSync] Started · polling every 30s when visible');
}

function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function updateSyncUI() {
  const statusEl = document.getElementById('syncStatus');
  const tokenInput = document.getElementById('ghToken');
  const gistInput = document.getElementById('ghGistId');
  const connectedView = document.getElementById('syncConnectedView');
  const setupView = document.getElementById('syncSetupView');
  const connectedInfo = document.getElementById('syncConnectedInfo');

  if (!statusEl) return;

  const connected = syncConfig && syncConfig.token && syncConfig.gistId;

  // Toggle between connected (minimal) and setup views
  if (connectedView) connectedView.classList.toggle('hidden', !connected);
  if (setupView) setupView.classList.toggle('hidden', connected);

  // Fill inputs if not focused (only when setup view is shown)
  if (!connected) {
    if (tokenInput && document.activeElement !== tokenInput) {
      tokenInput.value = syncConfig?.token || '';
    }
    if (gistInput && document.activeElement !== gistInput) {
      gistInput.value = syncConfig?.gistId || '';
    }
  }

  // Connected view info
  if (connected && connectedInfo) {
    const lastSyncText = syncStatus.lastSync
      ? `Última actualización: ${syncStatus.lastSync.toLocaleTimeString()}`
      : 'Sincronizando…';
    const userText = syncConfig?.user ? ` · @${syncConfig.user}` : '';
    const opCount = state.registro.length;
    connectedInfo.innerHTML = `
      ${opCount} operación${opCount !== 1 ? 'es' : ''} sincronizada${opCount !== 1 ? 's' : ''} en la nube${userText}
      <br><small class="hint">${lastSyncText}</small>
    `;
  }
}

async function handleSyncSave() {
  const token = document.getElementById('ghToken').value.trim();
  const gistIdIn = document.getElementById('ghGistId').value.trim();
  if (!token) {
    showToast('Pega tu GitHub Token primero', 'warn');
    return;
  }
  setSyncStatus('syncing', 'Probando conexión…');
  try {
    const { user } = await testGistConnection(token, gistIdIn || null);
    let gistId = gistIdIn;
    const isNewGist = !gistId;
    if (isNewGist) {
      // Warn user before creating a NEW gist (likely accidental)
      const existingNote = syncConfig ? `\n\nDetecté que ya tienes otro Gist configurado (${syncConfig.gistId?.slice(0,8)}…). ¿Seguro que quieres crear uno NUEVO y dejar el anterior aislado?` : '';
      if (!confirm(`No ingresaste Gist ID, así que voy a CREAR uno nuevo vacío.${existingNote}\n\nSi quieres conectar con un Gist existente, cancélalo y pega el Gist ID primero.\n\n¿Crear nuevo Gist?`)) {
        setSyncStatus('idle', 'Cancelado. Pega un Gist ID existente para conectar.');
        return;
      }
      setSyncStatus('syncing', 'Creando Gist privado…');
      gistId = await createGist(token);
    }
    saveSyncConfig({ token, gistId, user });
    setSyncStatus('ok', `✅ Conectado como @${user}`);

    if (isNewGist) {
      // New gist → safe to push current local state (both should be empty)
      showToast(`☁️ Sincronización activa · Gist nuevo creado`, 'success');
      setTimeout(pushToGist, 300);
    } else {
      // Existing gist → DON'T auto-push (could overwrite remote data with empty local)
      // Instead, trigger an auto-check immediately to pull any remote data
      showToast(`☁️ Conectado · Sincronizando automáticamente…`, 'success');
      setSyncStatus('idle', `☁️ Conectado como @${user} · buscando cambios…`);
      setTimeout(() => checkRemoteChanges({ silent: false }), 500);
    }
    // Start background auto-sync polling
    startAutoSync();
  } catch (e) {
    setSyncStatus('error', `❌ ${e.message}`);
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function handleSyncTest() {
  // Use saved config token if connected, otherwise read from input
  const token = (syncConfig && syncConfig.token) || document.getElementById('ghToken').value.trim();
  const gistId = (syncConfig && syncConfig.gistId) || document.getElementById('ghGistId').value.trim();
  if (!token) {
    showToast('Pega tu GitHub Token primero', 'warn');
    return;
  }
  setSyncStatus('syncing', 'Probando…');
  try {
    const { user } = await testGistConnection(token, gistId || null);
    setSyncStatus('ok', `✅ Token válido (@${user})${gistId ? ` · Gist accesible` : ''}`);
    showToast(`Token OK como @${user}`, 'success');
  } catch (e) {
    setSyncStatus('error', `❌ ${e.message}`);
    showToast(`Error: ${e.message}`, 'error');
  }
}

function handleSyncDisconnect() {
  if (!confirm('¿Desconectar la sincronización?\nTu data local y la del Gist NO se borran, solo se deja de sincronizar.')) return;
  clearSyncConfig();
  stopAutoSync();
  syncStatus.remoteUpdated = null;
  setSyncStatus('idle', 'Desconectado. Datos solo en este dispositivo.');
  showToast('🔌 Sincronización desconectada', 'info');
}

function handleRestoreBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) {
      showToast('❌ No hay backup disponible', 'error');
      return;
    }
    const data = JSON.parse(raw);
    if (!data.registro || data.registro.length === 0) {
      showToast('❌ Backup está vacío', 'error');
      return;
    }
    const age = data._backupAt ? new Date(data._backupAt).toLocaleString() : '?';
    if (!confirm(`¿Restaurar ${data.registro.length} operaciones del backup local?\n(Backup de ${age})\n\nEsto REEMPLAZARÁ tus datos actuales.`)) return;
    if (restoreFromBackup()) {
      showToast(`♻️ ${data.registro.length} operaciones restauradas`, 'success');
    }
  } catch (e) {
    showToast('❌ Error: ' + e.message, 'error');
  }
}

// Period date range computation
function getPeriodRange(period = dashFilters.period) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (period) {
    case 'week': {
      const from = new Date(startOfToday);
      from.setDate(startOfToday.getDate() - 6);
      return { from, to: endOfToday, label: 'Última semana' };
    }
    case 'month': {
      const m = dashFilters.month || { year: now.getFullYear(), month: now.getMonth() };
      const from = new Date(m.year, m.month, 1);
      const lastDay = new Date(m.year, m.month + 1, 0);
      const lastDayEnd = new Date(m.year, m.month + 1, 0, 23, 59, 59);
      // If it's current month, cap to today
      const isCurrent = m.year === now.getFullYear() && m.month === now.getMonth();
      const to = isCurrent ? endOfToday : lastDayEnd;
      const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      return { from, to, label: `${monthNames[m.month]} ${m.year}` };
    }
    case 'custom': {
      const from = dashFilters.customFrom ? new Date(dashFilters.customFrom + 'T00:00:00') : startOfToday;
      const to = dashFilters.customTo ? new Date(dashFilters.customTo + 'T23:59:59') : endOfToday;
      return { from, to, label: 'Período custom' };
    }
    default:
      return null;
  }
}

// Previous period (same length, immediately before)
function getPreviousPeriodRange(period = dashFilters.period) {
  const cur = getPeriodRange(period);
  if (!cur) return null;
  const days = Math.round((cur.to - cur.from) / (1000 * 60 * 60 * 24)) + 1;
  const prevTo = new Date(cur.from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevTo.getDate() - days + 1);
  return { from: prevFrom, to: prevTo, label: 'Período anterior' };
}

function inRange(fecha, from, to) {
  if (!fecha) return false;
  const d = new Date(fecha + 'T12:00:00');
  return d >= from && d <= to;
}

function filterByRange(from, to) {
  return state.registro.filter(r => inRange(r.fecha, from, to));
}

// Filter registro by current dashboard period
function getFilteredRegistro() {
  const range = getPeriodRange();
  if (!range) return state.registro;
  return filterByRange(range.from, range.to);
}

function getPreviousFilteredRegistro() {
  const prev = getPreviousPeriodRange();
  if (!prev) return [];
  return filterByRange(prev.from, prev.to);
}

// Compute goal progress
function getGoalProgress() {
  const filtered = getFilteredRegistro();
  const totalProfit = filtered.reduce((s, r) => s + r.profit, 0);
  const goal = dashFilters.goalAmount;
  const pct = goal > 0 ? Math.max(0, Math.min(1.5, totalProfit / goal)) : 0;
  const remaining = Math.max(0, goal - totalProfit);
  return { profit: totalProfit, goal, pct, remaining };
}

// =====================================================
// CÁLCULOS (misma lógica que el Excel)
// =====================================================

function getMatPorPaso(tipo) {
  const t = TIPOS_OBJETO.find(x => x.nombre === tipo);
  return t ? t.matPorPaso : 0;
}

function calcMateriales(enchIni, enchFin, tipo, qty) {
  const matPorPaso = getMatPorPaso(tipo);
  return {
    runa:  (enchFin >= 1 && enchIni < 1) ? matPorPaso * qty : 0,
    alma:  (enchFin >= 2 && enchIni < 2) ? matPorPaso * qty : 0,
    relic: (enchFin >= 3 && enchIni < 3) ? matPorPaso * qty : 0,
  };
}

function calcOperacion(op) {
  // op: { tipo, tier, enchIni, enchFin, calidad, qty, pCompra, pVenta, pDir }
  const tier = parseInt(op.tier);
  const enchIni = parseInt(op.enchIni);
  const enchFin = parseInt(op.enchFin);
  const qty = Math.max(1, parseInt(op.qty) || 1);
  const pCompra = Math.max(0, parseFloat(op.pCompra) || 0);
  const pVenta = Math.max(0, parseFloat(op.pVenta) || 0);
  const pDir = Math.max(0, parseFloat(op.pDir) || 0);
  const taxRate = state.premium ? 0.04 : 0.08;

  const mats = calcMateriales(enchIni, enchFin, op.tipo, qty);
  const prec = state.precios[tier] || { runa: 0, alma: 0, relic: 0 };

  const matCosto = {
    runa:  mats.runa  * prec.runa,
    alma:  mats.alma  * prec.alma,
    relic: mats.relic * prec.relic,
  };
  const matCostoTotal = matCosto.runa + matCosto.alma + matCosto.relic;
  const matQtyTotal = mats.runa + mats.alma + mats.relic;

  const inversion = qty * (pCompra + (qty > 0 ? matCostoTotal / qty : 0));
  const revBruto = qty * pVenta;
  const tax = revBruto * taxRate;
  const revNeto = revBruto * (1 - taxRate);
  const profit = revNeto - inversion;
  const profitUnit = qty > 0 ? profit / qty : 0;
  const margen = revNeto > 0 ? profit / revNeto : 0;
  const roi = inversion > 0 ? profit / inversion : 0;
  const ip = IP_BASE[tier] + enchFin * 100;
  const breakeven = (1 - taxRate) > 0 ? (pCompra + (qty > 0 ? matCostoTotal / qty : 0)) / (1 - taxRate) : 0;
  const eficiencia = revNeto > 0 ? matCostoTotal / revNeto : 0;
  const profitPorIP = ip > 0 ? profitUnit / (ip / 100) : 0;

  return {
    mats, matCosto, matCostoTotal, matQtyTotal,
    inversion, revBruto, tax, revNeto,
    profit, profitUnit, margen, roi, ip, breakeven,
    eficiencia, profitPorIP,
    taxRate, pDir,
  };
}

function calcEstado(profit, roi, profitUnit, registro) {
  if (registro.length === 0) return { label: 'Sin histórico', cls: 'neutral' };
  const rois = registro.map(r => r.roi).filter(x => !isNaN(x));
  const pus = registro.map(r => r.profitUnit).filter(x => !isNaN(x));
  const profits = registro.map(r => r.profit).filter(x => !isNaN(x));
  if (rois.length === 0) return { label: 'Sin histórico', cls: 'neutral' };

  if (roi <= 0) return { label: '🔴 Pérdida', cls: 'perdida' };

  const p75ROI = percentile(rois, 0.75);
  const p75PU = percentile(pus, 0.75);
  const p50ROI = percentile(rois, 0.5);
  const avgProfit = profits.reduce((a,b)=>a+b,0) / profits.length;

  if (roi >= p75ROI && profitUnit >= p75PU)
    return { label: '🟢 Excelente', cls: 'excelente' };
  if (roi >= p50ROI)
    return { label: '🟡 Buena', cls: 'buena' };
  if (profit >= 2 * avgProfit)
    return { label: '🔵 Bulk Win', cls: 'bulk' };
  return { label: '🟠 Marginal', cls: 'marginal' };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = p * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

// =====================================================
// FORMATTERS
// =====================================================

const fmtSilver = n => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('es-ES');
};
const fmtSilver2 = n => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtPct = n => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n * 100).toFixed(2) + '%';
};

// =====================================================
// UI - CALCULADORA
// =====================================================

function initCalculadora() {
  document.getElementById('cfgPremium').checked = state.premium;
  updateTaxHint();

  // Populate Tipo dropdown with icons
  const tipoSelect = document.getElementById('inTipo');
  tipoSelect.innerHTML = TIPOS_OBJETO.map(t =>
    `<option value="${t.nombre}">${t.nombre}</option>`
  ).join('');

  // Inputs
  ['inTipo','inTier','inEnchIni','inEnchFin','inCalidad','inQty','inPCompra','inPVenta','inPDir']
    .forEach(id => document.getElementById(id).addEventListener('input', updateCalculadora));

  document.getElementById('cfgPremium').addEventListener('change', e => {
    state.premium = e.target.checked;
    saveState();
    updateTaxHint();
    updateCalculadora();
  });

  document.getElementById('btnGuardar').addEventListener('click', guardarOperacion);

  updateCalculadora();
}

function updateTaxHint() {
  document.getElementById('cfgTaxHint').textContent = `Tax: ${state.premium ? '4%' : '8%'}`;
}

function updateCalculadora() {
  const op = getCurrentInputs();
  const tier = parseInt(op.tier);
  const r = calcOperacion(op);

  // DEBUG: mostrar valores reales
  const debugEl = document.getElementById('debugTax');
  if (debugEl) debugEl.textContent = `state.premium=${state.premium} | taxRate=${r.taxRate} | revNeto calc=100000*${1-r.taxRate}=${Math.round(100000*(1-r.taxRate))}`;

  // Update material icons to match current tier (T4-T8)
  const matIcons = document.querySelectorAll('.mat-table img.mat-icon');
  const matTypes = ['runa', 'alma', 'relic'];
  matIcons.forEach((img, i) => {
    const mat = matTypes[i];
    img.src = imgUrl(tierMatId(MATERIAL_BASE[mat], tier));
  });

  // Materiales
  document.getElementById('matRunaQty').textContent = fmtSilver(r.mats.runa);
  document.getElementById('matAlmaQty').textContent = fmtSilver(r.mats.alma);
  document.getElementById('matRelicQty').textContent = fmtSilver(r.mats.relic);
  document.getElementById('matTotalQty').textContent = fmtSilver(r.matQtyTotal);

  const prec = state.precios[tier] || { runa: 0, alma: 0, relic: 0 };
  document.getElementById('matRunaPrecio').textContent = fmtSilver(prec.runa);
  document.getElementById('matAlmaPrecio').textContent = fmtSilver(prec.alma);
  document.getElementById('matRelicPrecio').textContent = fmtSilver(prec.relic);

  document.getElementById('matRunaCosto').textContent = fmtSilver(r.matCosto.runa);
  document.getElementById('matAlmaCosto').textContent = fmtSilver(r.matCosto.alma);
  document.getElementById('matRelicCosto').textContent = fmtSilver(r.matCosto.relic);
  document.getElementById('matTotalCosto').textContent = fmtSilver(r.matCostoTotal);

  // Resultados principales
  document.getElementById('rInversion').textContent = fmtSilver(r.inversion);
  document.getElementById('rRevNeto').textContent = fmtSilver(r.revNeto);
  document.getElementById('rProfit').textContent = fmtSilver(r.profit);
  document.getElementById('rProfitUnit').textContent = fmtSilver(r.profitUnit);
  document.getElementById('rMargen').textContent = fmtPct(r.margen);
  document.getElementById('rROI').textContent = fmtPct(r.roi);
  document.getElementById('rBreakeven').textContent = fmtSilver(r.breakeven);
  document.getElementById('rEficiencia').textContent = fmtPct(r.eficiencia);

  // Meta line (información secundaria)
  document.getElementById('rIP').textContent = fmtSilver(r.ip);
  document.getElementById('rMatUnit').textContent = fmtSilver(r.matCostoTotal / Math.max(1, parseInt(op.qty)));
  document.getElementById('rCostBase').textContent = fmtSilver(parseFloat(op.pCompra));

  // Color profit
  const profitEl = document.getElementById('rProfit');
  profitEl.style.color = r.profit > 0 ? 'var(--success)' : r.profit < 0 ? 'var(--danger)' : 'var(--text-primary)';

  // Costo de oportunidad
  document.getElementById('oppEnchLabel').textContent = `.${op.enchFin}`;
  const pDir = parseFloat(op.pDir) || 0;
  if (pDir > 0) {
    const qty = parseInt(op.qty) || 1;
    const costoDirecto = qty * pDir;
    document.getElementById('oppTuCosto').textContent = fmtSilver(r.inversion);
    document.getElementById('oppDirecto').textContent = fmtSilver(costoDirecto);
    document.getElementById('oppAhorro').textContent = fmtSilver(costoDirecto - r.inversion);
    document.getElementById('oppGananciaAlt').textContent = fmtSilver(r.revNeto - costoDirecto);
    if (r.profit > (r.revNeto - costoDirecto)) {
      document.getElementById('oppVeredicto').innerHTML = '<span style="color:var(--success); font-weight:600;">✅ TU RUTA GANA</span>';
    } else {
      document.getElementById('oppVeredicto').innerHTML = '<span style="color:var(--danger); font-weight:600;">❌ COMPRAR DIRECTO ES MEJOR</span>';
    }
  } else {
    document.getElementById('oppTuCosto').textContent = fmtSilver(r.inversion);
    document.getElementById('oppDirecto').textContent = '—';
    document.getElementById('oppAhorro').textContent = '—';
    document.getElementById('oppGananciaAlt').textContent = fmtSilver(r.profit);
    document.getElementById('oppVeredicto').textContent = 'Llena precio del item final para comparar';
  }

  // Estado
  const estado = calcEstado(r.profit, r.roi, r.profitUnit, state.registro);
  const badge = document.getElementById('estadoBadge');
  badge.textContent = estado.label;
  badge.className = 'estado-badge ' + estado.cls;

  // Label dinámico
  document.getElementById('inPDirLabel').textContent = `Precio .${op.enchFin} en mercado (opcional)`;

  // Item preview image (uses current tier)
  const tipo = TIPOS_OBJETO.find(t => t.nombre === op.tipo);
  if (tipo) {
    const preview = document.getElementById('itemPreview');
    preview.innerHTML = `<img src="${imgUrl(tierItemId(tipo.baseId, op.tier))}" alt="${op.tipo}"><div><strong>${op.tipo} T${op.tier}.${op.enchFin}</strong><br><small>${fmtSilver(r.ip)} IP</small></div>`;
  }
}

function getCurrentInputs() {
  return {
    tipo: document.getElementById('inTipo').value,
    tier: document.getElementById('inTier').value,
    enchIni: document.getElementById('inEnchIni').value,
    enchFin: document.getElementById('inEnchFin').value,
    calidad: document.getElementById('inCalidad').value,
    qty: document.getElementById('inQty').value,
    pCompra: document.getElementById('inPCompra').value,
    pVenta: document.getElementById('inPVenta').value,
    pDir: document.getElementById('inPDir').value,
  };
}

function guardarOperacion() {
  const op = getCurrentInputs();
  const pCompra = parseFloat(op.pCompra) || 0;
  const pVenta = parseFloat(op.pVenta) || 0;
  if (pCompra <= 0 || pVenta <= 0) {
    showToast('Llena precio de compra y venta primero', 'error');
    return;
  }
  const r = calcOperacion(op);
  const estado = calcEstado(r.profit, r.roi, r.profitUnit, state.registro);

  const reg = {
    fecha: localDateStr(),
    tipo: op.tipo,
    tier: parseInt(op.tier),
    enchIni: parseInt(op.enchIni),
    enchFin: parseInt(op.enchFin),
    calidad: op.calidad,
    qty: parseInt(op.qty) || 1,
    pCompra: pCompra,
    pVenta: pVenta,
    matUnit: r.matCostoTotal / Math.max(1, parseInt(op.qty)),
    inversion: r.inversion,
    revNeto: r.revNeto,
    profit: r.profit,
    roi: r.roi,
    profitUnit: r.profitUnit,
    estado: estado.label,
    notas: '',
  };
  state.registro.push(reg);
  saveState();
  showToast('✅ Operación guardada', 'success');
  updateRegistro();
  updateDashboard();
  updateCalculadora();
}

// =====================================================
// UI - SELLOS REALES (Royal Sigil Crafting)
// =====================================================

// Custom Select component (replaces native <select> for full styling control)
function initCustomSelects(root = document) {
  root.querySelectorAll('.cselect:not([data-cs-init])').forEach(el => {
    const trigger = el.querySelector('.cselect-trigger');
    const label = el.querySelector('.cselect-label');
    const menu = el.querySelector('.cselect-menu');
    const options = el.querySelectorAll('.cselect-option');
    if (!trigger || !menu) return;

    // Initial value from active option
    const active = menu.querySelector('.cselect-option.active') || options[0];
    if (active) {
      el.dataset.value = active.dataset.value;
      label.textContent = active.textContent;
    }

    el.dataset.csInit = '1';
    let openMenu = null;

    function open() {
      // Close any other open
      document.querySelectorAll('.cselect.open').forEach(o => {
        if (o !== el) o.classList.remove('open');
      });
      el.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      // Position the menu
      openMenu = menu;
      menu.classList.add('show');
      // Scroll active into view
      const a = menu.querySelector('.cselect-option.active');
      if (a) a.scrollIntoView({ block: 'nearest' });
    }
    function close() {
      el.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      menu.classList.remove('show');
    }

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      if (el.classList.contains('open')) close(); else open();
    });
    trigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.classList.contains('open') ? close() : open(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (!el.classList.contains('open')) open(); focusNext(1); }
      else if (e.key === 'Escape') close();
    });

    options.forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        options.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        el.dataset.value = opt.dataset.value;
        label.textContent = opt.textContent;
        close();
        el.dispatchEvent(new CustomEvent('cselect:change', { detail: { value: opt.dataset.value } }));
      });
    });

    function focusNext(dir) {
      const opts = Array.from(options);
      const cur = opts.findIndex(o => o.classList.contains('active'));
      const next = opts[(cur + dir + opts.length) % opts.length];
      if (next) { next.click(); }
    }
  });
}

// Close all custom selects when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.cselect.open').forEach(o => o.classList.remove('open'));
  document.querySelectorAll('.cselect-menu.show').forEach(m => m.classList.remove('show'));
});

function initRoyal() {
  // Initialize custom selects and bind change events
  ['royalSlot', 'royalTier', 'royalMaterial'].forEach(name => {
    const cs = document.querySelector(`.cselect[data-cs="${name}"]`);
    if (cs) {
      cs.addEventListener('cselect:change', () => {
        if (name === 'royalSlot') syncMaterialVisibility();
        if (name === 'royalTier') updateRoyalSigilPrice(); // auto-fill from Precios tab
        updateRoyalCalc();
      });
    }
  });

  // Premium toggle syncs with main one
  const premEl = document.getElementById('royalPremium');
  premEl.checked = state.premium;
  premEl.addEventListener('change', () => {
    state.premium = premEl.checked;
    saveState();
    document.getElementById('cfgPremium').checked = premEl.checked;
    updateRoyalDebug();
    updateRoyalCalc();
  });

  const qtyEl  = document.getElementById('royalQty');
  const baseEl = document.getElementById('royalBasePrice');
  const feeEl  = document.getElementById('royalCraftFee');
  const sellEl = document.getElementById('royalSellPrice');

  [qtyEl, baseEl, feeEl, sellEl].forEach(el => {
    el.addEventListener('input', updateRoyalCalc);
    el.addEventListener('change', updateRoyalCalc);
  });

  function syncMaterialVisibility() {
    document.getElementById('royalMaterialWrap').classList.add('hidden');
  }
  syncMaterialVisibility();

  document.getElementById('royalRegister').addEventListener('click', registerRoyalOperation);
  document.getElementById('royalReset').addEventListener('click', () => {
    baseEl.value = 0; sellEl.value = 0; qtyEl.value = 1;
    updateRoyalCalc();
  });

  updateRoyalDebug();
  updateRoyalCalc();
}

function updateRoyalDebug() {
  const prem = state.premium;
  const tax = prem ? 0.04 : 0.08;
  const el = document.getElementById('royalDebugTax');
  if (el) el.textContent = `premium=${prem} | impuesto=${(tax*100).toFixed(0)}% | cálculo: 100000 × ${(1-tax).toFixed(2)} = ${Math.round(100000*(1-tax))}`;
  const taxHint = document.getElementById('royalTaxHint');
  if (taxHint) taxHint.textContent = `Impuesto: ${(tax*100).toFixed(0)}% ${prem ? 'con Premium' : 'sin Premium'}.`;
}

function getRoyalInputs() {
  const getCs = name => document.querySelector(`.cselect[data-cs="${name}"]`)?.dataset.value;
  const tier = parseInt(getCs('royalTier') || '4');
  // Sigil price comes from state.sellos (set in Precios tab) — read-only here
  const sigilPrice = (state.sellos && state.sellos[tier]) || 0;
  return {
    slot: getCs('royalSlot') || 'helmet',
    tier,
    material: getCs('royalMaterial') || 'cloth',
    qty: Math.max(1, parseInt(document.getElementById('royalQty').value) || 1),
    basePrice: Math.max(0, parseFloat(document.getElementById('royalBasePrice').value) || 0),
    sigilPrice,
    craftFee: Math.max(0, parseFloat(document.getElementById('royalCraftFee').value) || 0),
    sellPrice: Math.max(0, parseFloat(document.getElementById('royalSellPrice').value) || 0),
  };
}

function calcRoyal(inp) {
  const slot = ROYAL_SLOTS[inp.slot];
  const sigilsPerCraft = slot.sigilsPerCraft[inp.tier] || slot.sigilsPerCraft[4];
  const totalSigils = sigilsPerCraft * inp.qty;
  const baseCost = inp.basePrice * inp.qty;
  const sigilCost = inp.sigilPrice * totalSigils;
  const craftCost = inp.craftFee; // craft fee is per BATCH (not per unit), keep as single
  const totalCost = baseCost + sigilCost + craftCost;

  const gross = inp.sellPrice * inp.qty;
  const taxRate = state.premium ? 0.04 : 0.08;
  const taxAmount = gross * taxRate;
  const netRevenue = gross - taxAmount;
  const profit = netRevenue - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const margin = gross > 0 ? (profit / gross) * 100 : 0;
  const profitUnit = inp.qty > 0 ? profit / inp.qty : 0;
  const breakeven = taxRate < 1 ? totalCost / (1 - taxRate) : Infinity;

  return {
    sigilsPerCraft,
    totalSigils,
    baseCost,
    sigilCost,
    craftCost,
    totalCost,
    gross,
    taxRate,
    taxAmount,
    netRevenue,
    profit,
    roi,
    margin,
    profitUnit,
    breakeven,
  };
}

function localDateStr(d) {
  // Returns local date as YYYY-MM-DD (uses user's timezone, not UTC)
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt(n) {
  if (!isFinite(n)) return '∞';
  return Math.round(n).toLocaleString('es-ES');
}

function updateRoyalCalc() {
  const inp = getRoyalInputs();
  const r = calcRoyal(inp);
  const slot = ROYAL_SLOTS[inp.slot];
  const tierName = ROYAL_TIER_NAMES[inp.tier];

  // Item icon & name
  const iconEl = document.getElementById('royalItemIcon');
  const nameEl = document.getElementById('royalItemName');
  const metaEl = document.getElementById('royalItemMeta');

  // Build Royal item ID: T{tier}_{SLOT}_{MATERIAL}_ROYAL@0  (English IDs required by CDN)
  const itemId = `T${inp.tier}_${slot.slot}_${ROYAL_MATERIAL_NAMES[inp.material]}_ROYAL@0`;
  const displayName = `${slot.name} T${inp.tier} (${ROYAL_MATERIAL_DISPLAY[inp.material]})`;
  iconEl.src = imgUrl(itemId);
  iconEl.alt = displayName;
  iconEl.onerror = () => {
    const fallback = `T${inp.tier}_${slot.slot}_${ROYAL_MATERIAL_NAMES[inp.material]}_ROYAL`;
    if (iconEl.src !== imgUrl(fallback)) {
      iconEl.src = imgUrl(fallback);
      iconEl.onerror = () => {
        iconEl.onerror = null;
        iconEl.src = 'img/T5_HEAD_CLOTH_SET1.png';
        iconEl.style.opacity = '0.4';
      };
    }
  };
  nameEl.textContent = displayName;
  metaEl.textContent = `T${inp.tier} · ${ROYAL_MATERIAL_DISPLAY[inp.material]} · Cantidad: ${inp.qty}`;

  // Costs
  document.getElementById('royalBaseCount').textContent = inp.qty;
  document.getElementById('royalSigilCount').textContent = r.sigilsPerCraft;
  document.getElementById('royalSigilTierLbl').textContent = `T${inp.tier}`;
  document.getElementById('royalQtyLbl').textContent = inp.qty;
  // Sigil name & price display (from Precios tab)
  document.getElementById('royalSigilName').textContent = tierName;
  document.getElementById('royalSigilValue').textContent = inp.sigilPrice.toLocaleString('es-ES');
  const sigIcon = document.getElementById('royalSigilIcon');
  if (sigIcon) {
    sigIcon.src = imgUrl(ROYAL_SIGIL_IMG[inp.tier]);
    sigIcon.onerror = () => { sigIcon.onerror = null; sigIcon.style.opacity = '0.25'; };
  }
  document.getElementById('royalBaseCost').textContent = fmt(r.baseCost);
  document.getElementById('royalSigilCost').textContent = fmt(r.sigilCost);
  document.getElementById('royalCraftCost').textContent = fmt(r.craftCost);
  document.getElementById('royalTotalCost').textContent = fmt(r.totalCost);

  // Revenue
  document.getElementById('royalSellQtyLbl').textContent = inp.qty;
  document.getElementById('royalTaxPctLbl').textContent = (r.taxRate * 100).toFixed(0);
  document.getElementById('royalGrossRevenue').textContent = fmt(r.gross);
  document.getElementById('royalTaxAmount').textContent = '−' + fmt(r.taxAmount);
  document.getElementById('royalNetRevenue').textContent = fmt(r.netRevenue);
  document.getElementById('royalProfit').textContent = (r.profit >= 0 ? '' : '−') + fmt(Math.abs(r.profit));
  document.getElementById('royalProfit').style.color = r.profit >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)';

  // Metrics
  document.getElementById('royalROI').textContent = fmt(r.roi) + '%';
  document.getElementById('royalMargin').textContent = fmt(r.margin) + '%';
  document.getElementById('royalProfitUnit').textContent = fmt(r.profitUnit);
}

function registerRoyalOperation() {
  const inp = getRoyalInputs();
  if (inp.basePrice <= 0 && inp.sigilPrice <= 0) {
    showToast('❌ Ingresa al menos un precio para registrar', 'error');
    return;
  }
  const r = calcRoyal(inp);
  const slot = ROYAL_SLOTS[inp.slot];
  const itemId = `T${inp.tier}_${slot.slot}_${ROYAL_MATERIAL_NAMES[inp.material]}_ROYAL@0`;
  const displayName = `${slot.name} T${inp.tier} (${ROYAL_MATERIAL_DISPLAY[inp.material]})`;

  const reg = {
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    fecha: localDateStr(),
    tipo: 'Sellos Reales',
    tier: inp.tier,
    enchIni: 0,
    enchFin: 0,
    calidad: 'Normal',
    qty: inp.qty,
    pCompra: inp.basePrice,
    pVenta: inp.sellPrice,
    pDir: 0,
    icon: itemId,
    royalSlot: inp.slot,
    royalMaterial: inp.material,
    sigilPrice: inp.sigilPrice,
    sigilCount: r.totalSigils,
    craftFee: inp.craftFee,
    sigilCost: r.sigilCost,
    profit: r.profit,
    revNeto: r.netRevenue,
    profitUnit: r.profitUnit,
    roi: r.roi / 100,
    inversion: r.totalCost,
    notas: `${r.sigilsPerCraft}× ${ROYAL_TIER_NAMES[inp.tier]} · ${ROYAL_MATERIAL_DISPLAY[inp.material]}`,
  };
  state.registro.push(reg);
  saveState();
  updateRegistro();
  showToast(`✅ Crafteo real registrado: ${fmt(r.profit)} de ganancia`, 'success');
}

// =====================================================
// UI - PRECIOS MATERIALES
// =====================================================

function initPrecios() {
  const tbody = document.getElementById('preciosBody');
  tbody.innerHTML = '';
  [4,5,6,7,8].forEach(tier => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>T${tier}</strong></td>
      <td><div class="mat-cell-inline"><img class="mat-icon-sm" src="${imgUrl(tierMatId('RUNE', tier))}" alt="Runa"><input type="number" data-tier="${tier}" data-mat="runa" value="${state.precios[tier].runa}" min="0"></div></td>
      <td><div class="mat-cell-inline"><img class="mat-icon-sm" src="${imgUrl(tierMatId('SOUL', tier))}" alt="Alma"><input type="number" data-tier="${tier}" data-mat="alma" value="${state.precios[tier].alma}" min="0"></div></td>
      <td><div class="mat-cell-inline"><img class="mat-icon-sm" src="${imgUrl(tierMatId('RELIC', tier))}" alt="Reliquia"><input type="number" data-tier="${tier}" data-mat="relic" value="${state.precios[tier].relic}" min="0"></div></td>
    `;
    tbody.appendChild(tr);
  });

  // Royal Sigils prices (T4-T6) - one row per tier, matches materials layout
  const sellosTbody = document.getElementById('sellosBody');
  if (sellosTbody) {
    sellosTbody.innerHTML = '';
    [4,5,6].forEach(tier => {
      const tr = document.createElement('tr');
      const sigilId = ROYAL_SIGIL_IMG[tier];
      tr.innerHTML = `
        <td><strong>T${tier}</strong></td>
        <td><div class="mat-cell-inline">
          <img class="mat-icon-sm sigil-img" src="${imgUrl(sigilId)}" alt="Sello T${tier}" onerror="this.onerror=null;this.style.opacity='0.25';">
          <input type="number" data-sigil="${tier}" value="${state.sellos[tier] || 0}" min="0" step="100">
        </div></td>
      `;
      sellosTbody.appendChild(tr);
    });
  }

  // Auto-save on every price change (debounced → triggers saveState() → sync push)
  let precioSaveTimer = null;
  function autoSavePrecio() {
    document.querySelectorAll('#preciosBody input').forEach(inp => {
      const tier = parseInt(inp.dataset.tier);
      const mat = inp.dataset.mat;
      const val = Math.max(0, parseFloat(inp.value) || 0);
      if (!state.precios[tier]) state.precios[tier] = { runa: 0, alma: 0, relic: 0 };
      state.precios[tier][mat] = val;
    });
    document.querySelectorAll('#sellosBody input').forEach(inp => {
      const tier = parseInt(inp.dataset.sigil);
      const val = Math.max(0, parseFloat(inp.value) || 0);
      if (!state.sellos) state.sellos = structuredClone(DEFAULT_SELLOS);
      state.sellos[tier] = val;
    });
    if (precioSaveTimer) clearTimeout(precioSaveTimer);
    precioSaveTimer = setTimeout(() => {
      saveState();
      updateCalculadora();
      updateRoyalSigilPrice();
    }, 800);
  }
  document.querySelectorAll('#preciosBody input, #sellosBody input').forEach(inp => {
    inp.addEventListener('input', autoSavePrecio);
  });
}

// Auto-fill sigil price in Royal tab when tier changes
function updateRoyalSigilPrice() {
  // No-op now — sigil price is read directly from state.sellos in getRoyalInputs()
  // Kept for backward compatibility (called from autoSavePrecio)
}

// =====================================================
// UI - REGISTRO
// =====================================================

function initRegistro() {
  // Populate tipo filter
  const filterTipo = document.getElementById('regFilterTipo');
  TIPOS_OBJETO.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.nombre;
    opt.textContent = t.nombre;
    filterTipo.appendChild(opt);
  });

  document.getElementById('regSearch').addEventListener('input', updateRegistro);
  document.getElementById('regFilterTipo').addEventListener('change', updateRegistro);
  document.getElementById('regFilterEstado').addEventListener('change', updateRegistro);
  document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
    document.getElementById('regSearch').value = '';
    document.getElementById('regFilterTipo').value = '';
    document.getElementById('regFilterEstado').value = '';
    updateRegistro();
  });

  // Event delegation for expand/collapse rows (prevents scroll-to-top from button focus)
  const tbody = document.getElementById('registroBody');
  if (tbody && !tbody.dataset.boundToggle) {
    tbody.addEventListener('click', (e) => {
      const expandBtn = e.target.closest('.expand-btn');
      const opRow = e.target.closest('tr.op-row');
      if (expandBtn && opRow) {
        e.preventDefault();
        e.stopPropagation();
        toggleOpDetail(opRow.dataset.opId);
      } else if (opRow && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('select')) {
        // Click anywhere in the row (except form elements) also toggles
        e.preventDefault();
        toggleOpDetail(opRow.dataset.opId);
      }
    });
    tbody.dataset.boundToggle = '1';
  }

  updateRegistro();
}

function updateRegistro() {
  const search = document.getElementById('regSearch').value.toLowerCase();
  const filterTipo = document.getElementById('regFilterTipo').value;
  const filterEstado = document.getElementById('regFilterEstado').value;

  let items = [...state.registro];
  if (search) items = items.filter(r =>
    r.tipo.toLowerCase().includes(search) ||
    `t${r.tier}`.includes(search) ||
    (r.notas || '').toLowerCase().includes(search));
  if (filterTipo) items = items.filter(r => r.tipo === filterTipo);
  if (filterEstado) items = items.filter(r => getOpStatus(r) === filterEstado);

  // Newest first by latest activity (fecha + hora of latest venta, or op fecha)
  items.sort((a, b) => getOpActivityTime(b).localeCompare(getOpActivityTime(a)));

  const tbody = document.getElementById('registroBody');
  const empty = document.getElementById('regEmpty');
  document.getElementById('registroCount').textContent = state.registro.length;
  document.getElementById('regCountHeader').textContent = `${state.registro.length} operaciones`;

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = items.map((r, idx) => {
    const realIdx = state.registro.indexOf(r);
    const opStatus = getOpStatus(r);
    const ventas = r.ventas || [];
    const actualProfit = getOpActualProfit(r);
    const statusBadge = {
      crafteado: '⚪ Crafteado',
      vendido: '✅ Vendido',
      pendiente: '⏳ Pendiente',
      fallido: '❌ Fallido',
    }[opStatus];

    return `
      <tr class="op-row" data-op-id="${r.id}">
        <td><button class="expand-btn" type="button">▶</button></td>
        <td>${r.fecha || '—'}</td>
        <td><img class="mat-icon-sm" src="${imgUrl(getItemId(r.tipo, r.tier))}" alt=""> ${r.tipo}</td>
        <td>T${r.tier}</td>
        <td>.${r.enchIni}→.${r.enchFin}</td>
        <td>${r.qty}</td>
        <td>${fmtSilver(r.inversion)}</td>
        <td>${fmtSilver(r.pVenta)}</td>
        <td style="color: ${actualProfit > 0 ? 'var(--success)' : actualProfit < 0 ? 'var(--danger)' : 'inherit'}; font-weight:600;">${fmtSilver(actualProfit)}</td>
        <td><span class="status-badge status-${opStatus}">${statusBadge}</span></td>
        <td><button class="delete-btn" onclick="event.stopPropagation();deleteRegistro(${realIdx})">🗑️</button></td>
      </tr>
      <tr class="op-detail-row hidden" id="detail-${r.id}">
        <td colspan="11">
          <div class="op-detail-content">
            <div class="ventas-header">
              <strong>📜 Intentos de venta (${ventas.length})</strong>
              <button class="btn btn-sm btn-primary" onclick="showAddVentaForm('${r.id}')">+ Agregar intento</button>
            </div>
            <div id="ventas-list-${r.id}">
              ${ventas.length === 0 ? '<p class="hint">Sin intentos de venta aún. Click "+ Agregar intento" cuando intentes vender.</p>' : ventas.map(v => renderVentaRow(r.id, v)).join('')}
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderVentaRow(opId, v) {
  return `
    <div class="venta-item venta-${v.estado}">
      <div class="venta-info">
        <span class="venta-fecha">${v.fecha} ${v.hora || ''}</span>
        <span class="venta-precio">${fmtSilver(v.precio)}</span>
        <span class="venta-comprador">${COMPRADOR_LABELS[v.comprador] || v.comprador}</span>
        <span class="venta-estado">${ESTADO_VENTA_LABELS[v.estado] || v.estado}</span>
        ${v.notas ? `<span class="venta-notas">${v.notas}</span>` : ''}
      </div>
      <div class="venta-actions">
        <button class="btn-tiny" onclick="showEditVentaForm('${opId}','${v.id}')">✏️</button>
        <button class="btn-tiny danger" onclick="deleteVentaConfirm('${opId}','${v.id}')">🗑️</button>
      </div>
    </div>
  `;
}

function toggleOpDetail(opId) {
  const detailRow = document.getElementById(`detail-${opId}`);
  if (!detailRow) return;
  detailRow.classList.toggle('hidden');
  // Update expand button arrow
  const opRow = document.querySelector(`tr.op-row[data-op-id="${opId}"] .expand-btn`);
  if (opRow) opRow.textContent = detailRow.classList.contains('hidden') ? '▶' : '▼';
}

function showAddVentaForm(opId, existingVentaId = null) {
  const op = state.registro.find(r => r.id === opId);
  if (!op) return;
  const existing = existingVentaId ? (op.ventas || []).find(v => v.id === existingVentaId) : null;
  const isEdit = !!existing;

  // Build modal HTML
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()">
      <h3>${isEdit ? '✏️ Editar intento de venta' : '➕ Nuevo intento de venta'}</h3>
      <p class="hint">Item: <strong>${op.tipo} T${op.tier}.${op.enchFin}</strong> · Costo: ${fmtSilver(op.inversion)}</p>
      <form id="ventaForm">
        <div class="form-grid">
          <div>
            <label class="label">Fecha</label>
            <input type="date" id="vFecha" class="input" value="${existing?.fecha || localDateStr()}">
          </div>
          <div>
            <label class="label">Hora</label>
            <input type="time" id="vHora" class="input" value="${existing?.hora || new Date().toTimeString().slice(0,5)}">
          </div>
          <div>
            <label class="label">Precio</label>
            <input type="number" id="vPrecio" class="input" value="${existing?.precio || op.pVenta || 0}" min="0" step="1">
          </div>
          <div>
            <label class="label">Comprador</label>
            <select id="vComprador" class="input">
              <option value="bm" ${existing?.comprador === 'bm' ? 'selected' : ''}>🏛️ Mercado Negro</option>
              <option value="player" ${existing?.comprador === 'player' ? 'selected' : ''}>👥 Mercado Jugadores</option>
              <option value="guild" ${existing?.comprador === 'guild' ? 'selected' : ''}>🏰 Gremio</option>
              <option value="direct" ${existing?.comprador === 'direct' ? 'selected' : ''}>🤝 Directo</option>
            </select>
          </div>
          <div>
            <label class="label">Estado</label>
            <select id="vEstado" class="input">
              <option value="vendido" ${existing?.estado === 'vendido' ? 'selected' : ''}>✅ Vendido</option>
              <option value="pendiente" ${existing?.estado === 'pendiente' ? 'selected' : ''}>⏳ Pendiente (listado)</option>
              <option value="fallido" ${existing?.estado === 'fallido' ? 'selected' : ''}>❌ Fallido (perdiste slot)</option>
            </select>
          </div>
        </div>
        <div style="margin-top: 1rem;">
          <label class="label">Notas</label>
          <textarea id="vNotas" class="input" rows="2" placeholder="Ej: Slot tomado por otro jugador, listé en player market...">${existing?.notas || ''}</textarea>
        </div>
        <div class="row gap-2" style="margin-top: 1rem; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" onclick="closeVentaModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Agregar intento'}</button>
        </div>
      </form>
    </div>
  `;
  modal.addEventListener('click', closeVentaModal);
  document.body.appendChild(modal);

  document.getElementById('ventaForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      fecha: document.getElementById('vFecha').value,
      hora: document.getElementById('vHora').value,
      precio: Math.max(0, parseFloat(document.getElementById('vPrecio').value) || 0),
      comprador: document.getElementById('vComprador').value,
      estado: document.getElementById('vEstado').value,
      notas: document.getElementById('vNotas').value.trim(),
    };
    if (isEdit) {
      updateVenta(opId, existingVentaId, data);
      showToast('✅ Intento actualizado', 'success');
    } else {
      addVenta(opId, data);
      showToast(`✅ Intento agregado (${data.estado})`, 'success');
    }
    closeVentaModal();
    updateRegistro();
    updateDashboard();
    // Auto-expand the row to show the new venta
    const detail = document.getElementById(`detail-${opId}`);
    if (detail && detail.classList.contains('hidden')) toggleOpDetail(opId);
  });
}

function showEditVentaForm(opId, ventaId) {
  showAddVentaForm(opId, ventaId);
}

function deleteVentaConfirm(opId, ventaId) {
  if (!confirm('¿Borrar este intento de venta?')) return;
  deleteVenta(opId, ventaId);
  updateRegistro();
  updateDashboard();
  showToast('Intento borrado', 'info');
}

function closeVentaModal() {
  const modal = document.querySelector('.modal-backdrop');
  if (modal) modal.remove();
}

function getItemId(tipo, tier) {
  const t = TIPOS_OBJETO.find(x => x.nombre === tipo);
  return t ? tierItemId(t.baseId, tier) : `T${tier || 5}_RUNE`;
}

function deleteRegistro(idx) {
  if (!confirm('¿Borrar esta operación?')) return;
  state.registro.splice(idx, 1);
  saveState();
  updateRegistro();
  updateDashboard();
  updateCalculadora();
  showToast('Operación borrada', 'info');
}

// =====================================================
// UI - DASHBOARD
// =====================================================

let charts = {};
const CHART_IDS = ['chartCompare', 'chartStatus', 'chartTipo', 'chartTier', 'chartGauge'];

function initDashboard() {
  updateDashboard();
}

// Animate a number from current to target value
function animateNumber(el, from, to, duration = 600, fmt) {
  const start = performance.now();
  // Infer format from el content if not given
  if (!fmt) {
    if (String(el.textContent).includes('%')) fmt = 'pct';
    else if (String(el.textContent).match(/[\d,]+/) && !String(el.textContent).match(/^\d+$/)) fmt = 'money';
    else fmt = 'int';
  }

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = from + (to - from) * eased;
    el.textContent = formatKpi(current, fmt);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function updateDashboard() {
  const dashboardActive = document.getElementById('tab-dashboard').classList.contains('active');
  const reg = getFilteredRegistro();
  const totalOps = reg.length;

  // NEW: classify ops by status derived from ventas
  const opsSold = reg.filter(r => getOpStatus(r) === 'vendido');
  const opsPending = reg.filter(r => getOpStatus(r) === 'pendiente');
  const opsFailed = reg.filter(r => getOpStatus(r) === 'fallido');
  const opsCrafted = reg.filter(r => getOpStatus(r) === 'crafteado');

  // NEW: calculate profits using ventas (Option B)
  const realizedProfit = opsSold.reduce((s, r) => s + getOpActualProfit(r), 0);
  const inventoryValue = opsPending.reduce((s, r) => {
    // Expected value = cost (what you paid to make) + expected profit
    return s + (r.inversion || 0);
  }, 0);
  const inventoryCount = opsPending.length;
  const losses = opsFailed.reduce((s, r) => s + (r.inversion || 0), 0);
  const craftedCost = opsCrafted.reduce((s, r) => s + (r.inversion || 0), 0);

  // Legacy metrics (kept for backward compat)
  const profits = reg.map(r => r.profit);
  const rois = reg.map(r => r.roi);
  const pus = reg.map(r => r.profitUnit);
  const positivos = profits.filter(p => p > 0).length;
  const totalProfit = profits.reduce((a,b)=>a+b,0);
  const avgProfit = totalOps > 0 ? totalProfit / totalOps : 0;
  const medianProfit = totalOps > 0 ? percentile(profits, 0.5) : 0;
  const avgROI = totalOps > 0 ? rois.reduce((a,b)=>a+b,0) / totalOps : 0;
  const avgPU = totalOps > 0 ? pus.reduce((a,b)=>a+b,0) / totalOps : 0;
  const best = profits.length > 0 ? Math.max(...profits) : 0;
  const worst = profits.length > 0 ? Math.min(...profits) : 0;
  const totalInvertido = reg.reduce((s,r)=>s+r.inversion,0);
  const totalRevenue = reg.reduce((s,r)=>s+r.revNeto,0);
  const pctExito = totalOps > 0 ? positivos / totalOps : 0;

  const kpis = [
    { id: 'kpi-realized',    label: '💰 Profit Realizado', raw: realizedProfit, fmt: 'money', cls: realizedProfit > 0 ? 'success' : 'neutral' },
    { id: 'kpi-inventory',   label: '📦 En Inventario', raw: inventoryValue, fmt: 'money', sub: `${inventoryCount} items`, cls: inventoryCount > 0 ? 'info' : 'neutral' },
    { id: 'kpi-failed',      label: '❌ Pérdidas', raw: losses, fmt: 'money', sub: `${opsFailed.length} fallidos`, cls: losses > 0 ? 'danger' : 'neutral' },
    { id: 'kpi-sold-count',   label: '✅ Vendidos', raw: opsSold.length, fmt: 'int', sub: `de ${totalOps}`, cls: 'success' },
  ];

  const grid = document.getElementById('kpiGrid');
  const existing = grid.children.length > 0;
  if (!existing) {
    grid.innerHTML = kpis.map(k => `
      <div class="kpi-card ${k.cls}">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-value" id="${k.id}">${formatKpi(k.raw, k.fmt)}</span>
      </div>
    `).join('');
  } else {
    kpis.forEach(k => {
      const el = document.getElementById(k.id);
      if (!el) return;
      const currentText = el.textContent;
      const currentNum = k.fmt === 'pct' ? parseFloat(currentText) / 100
                       : k.fmt === 'money' ? parseFloat(currentText.replace(/,/g, ''))
                       : parseInt(currentText);
      if (!isNaN(currentNum)) {
        animateNumber(el, currentNum, k.raw, 600, k.fmt);
      } else {
        el.textContent = formatKpi(k.raw, k.fmt);
      }
      const card = el.closest('.kpi-card');
      if (card) card.className = `kpi-card ${k.cls}`;
    });
  }

  // Goal gauge
  const goal = getGoalProgress();
  const gaugeValue = document.getElementById('gaugeValue');
  if (gaugeValue) gaugeValue.textContent = (goal.pct * 100).toFixed(1) + '%';
  const goalInfo = document.getElementById('goalMetaInfo');
  if (goalInfo) {
    if (goal.pct >= 1) {
      goalInfo.className = 'goal-meta-info over';
      goalInfo.innerHTML = `🎉 <strong>Superaste la meta</strong> por ${fmtSilver(goal.profit - goal.goal)}`;
    } else if (goal.remaining > 0) {
      goalInfo.className = 'goal-meta-info';
      goalInfo.innerHTML = `<span>${fmtSilver(goal.remaining)} restantes</span>`;
    } else {
      goalInfo.className = 'goal-meta-info met';
      goalInfo.innerHTML = `<span>¡Meta alcanzada!</span>`;
    }
  }

  const donutCenter = document.getElementById('donutCenterValue');
  if (donutCenter) donutCenter.textContent = String(totalOps);

  // Charts
  if (dashboardActive) {
    renderCompareChart();
    renderChartStatus();
    renderChartGauge();
    renderChartTier();
    renderChartTipo();
    renderTopPerformers();
  }
}

function formatKpi(v, fmt) {
  if (fmt === 'pct') return (v * 100).toFixed(1) + '%';
  if (fmt === 'money') return Math.round(v).toLocaleString('es-ES');
  return String(Math.round(v));
}

function ensureCanvas(id) {
  if (document.getElementById(id)) return;
  const card = document.querySelector(`#${id}`)?.closest('.card-body');
  if (card) card.innerHTML = `<canvas id="${id}"></canvas>`;
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    delete charts[name];
  }
}

function getChartColors() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4a548';
}

// Chart.js animation config — matches emil-design tokens
const CHART_ANIM = {
  duration: 600,
  easing: 'easeOutQuart',  // similar to cubic-bezier(0.23, 1, 0.32, 1)
  delay: ctx => ctx.type === 'data' ? 80 : 0,
};

function renderChartTime() {
  destroyChart('time');
  ensureCanvas('chartTime');
  const reg = [...getFilteredRegistro()].sort((a,b) => (a.fecha || '').localeCompare(b.fecha || ''));
  const ctx = document.getElementById('chartTime');
  if (!ctx || reg.length === 0) return;
  const accent = getChartColors();
  charts.time = new Chart(ctx, {
    type: 'line',
    data: {
      labels: reg.map(r => r.fecha),
      datasets: [{
        label: 'Profit',
        data: reg.map(r => r.profit),
        borderColor: accent,
        backgroundColor: ctx => {
          const c = ctx.chart.ctx;
          const gradient = c.createLinearGradient(0, 0, 0, 280);
          gradient.addColorStop(0, hexToRgba(accent, 0.35));
          gradient.addColorStop(1, hexToRgba(accent, 0));
          return gradient;
        },
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: accent,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: getCss('--chart-text'), font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: getCss('--chart-text'), font: { size: 10 } }, grid: { color: getCss('--chart-grid') }, border: { display: false } },
      },
    },
  });
}

function hexToRgba(hex, alpha) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

// Sparkline removed

function renderChartStatus() {
  destroyChart('status');
  ensureCanvas('chartStatus');
  const ctx = document.getElementById('chartStatus');
  if (!ctx) return;
  const counts = {};
  getFilteredRegistro().forEach(r => {
    counts[r.estado] = (counts[r.estado] || 0) + 1;
  });
  const keys = Object.keys(counts);
  if (keys.length === 0) return;

  const statusColors = {
    '🟢 Excelente': getCss('--excelente'),
    '🟡 Buena':      getCss('--buena'),
    '🔵 Bulk Win':  getCss('--bulk'),
    '🟠 Marginal':   getCss('--marginal'),
    '🔴 Pérdida':    getCss('--perdida'),
  };
  const colors = keys.map(k => statusColors[k] || getCss('--accent'));

  charts.status = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: keys,
      datasets: [{
        data: Object.values(counts),
        backgroundColor: colors,
        borderColor: getCss('--bg-card'),
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: CHART_ANIM,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  });

  const legend = document.getElementById('donutLegend');
  if (legend) {
    legend.innerHTML = keys.map((k, i) => {
      const v = counts[k];
      return `<div class="donut-legend-item">
        <div class="label"><span class="dot" style="background:${colors[i]}"></span>${k}</div>
        <div class="value">${v}</div>
      </div>`;
    }).join('');
  }
}

// Gauge (semicircle) for goal progress
function renderChartGauge() {
  destroyChart('gauge');
  ensureCanvas('chartGauge');
  const ctx = document.getElementById('chartGauge');
  if (!ctx) return;
  const goal = getGoalProgress();
  const pct = Math.min(goal.pct, 1);
  const rest = 1 - pct;
  const reached = goal.pct >= 1;
  const accent = reached ? getCss('--success') : getCss('--accent');
  const empty = getCss('--border');

  charts.gauge = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Alcanzado', 'Restante'],
      datasets: [{
        data: [pct, rest],
        backgroundColor: [accent, empty],
        borderColor: 'transparent',
        borderWidth: 0,
        circumference: 180,
        rotation: 270,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '78%',
      animation: CHART_ANIM,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

// Top performers list (filtered by period)
function renderTopPerformers() {
  const list = document.getElementById('performerList');
  if (!list) return;
  const sorted = [...getFilteredRegistro()].sort((a, b) => b.profit - a.profit).slice(0, 5);
  if (sorted.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-secondary);">Sin operaciones en este período</div>';
    return;
  }
  list.innerHTML = sorted.map((r, i) => {
    const isPositive = r.profit >= 0;
    const baseId = getBaseItemId(r.tipo);
    return `
      <div class="performer-item">
        <div class="performer-rank">${i + 1}</div>
        <img class="performer-icon" src="${imgUrl(tierItemId(baseId, r.tier))}" alt="">
        <div class="performer-info">
          <div class="performer-name">${r.tipo} T${r.tier}.${r.enchFin}</div>
          <div class="performer-meta">${r.qty}× · ${r.fecha}</div>
        </div>
        <div class="performer-value ${isPositive ? 'positive' : 'negative'}">
          ${isPositive ? '+' : ''}${fmtSilver(r.profit)}
        </div>
      </div>
    `;
  }).join('');
}

function getBaseItemId(tipo) {
  const t = TIPOS_OBJETO.find(x => x.nombre === tipo);
  return t ? t.baseId : 'RUNE';
}

// Comparative chart: current period vs previous period, daily breakdown
function renderCompareChart() {
  destroyChart('compare');
  ensureCanvas('chartCompare');
  const ctx = document.getElementById('chartCompare');
  if (!ctx) return;

  const cur = getPeriodRange();
  const prev = getPreviousPeriodRange();
  if (!cur || !prev) return;

  const days = Math.round((cur.to - cur.from) / (1000 * 60 * 60 * 24)) + 1;
  const labels = [];
  const curData = [];
  const prevData = [];

  for (let i = 0; i < days; i++) {
    const curDate = new Date(cur.from);
    curDate.setDate(cur.from.getDate() + i);
    const prevDate = new Date(prev.from);
    prevDate.setDate(prev.from.getDate() + i);

    labels.push(`${curDate.getDate()}/${curDate.getMonth() + 1}`);

    const curDayProfit = state.registro
      .filter(r => r.fecha === formatDate(curDate))
      .reduce((s, r) => s + r.profit, 0);
    const prevDayProfit = state.registro
      .filter(r => r.fecha === formatDate(prevDate))
      .reduce((s, r) => s + r.profit, 0);

    curData.push(curDayProfit);
    prevData.push(prevDayProfit);
  }

  const curTotal = curData.reduce((a, b) => a + b, 0);
  const prevTotal = prevData.reduce((a, b) => a + b, 0);
  const trendPct = prevTotal !== 0 ? ((curTotal - prevTotal) / Math.abs(prevTotal)) * 100 : null;
  const trendEl = document.getElementById('compareTrend');
  if (trendEl) {
    if (trendPct === null) {
      trendEl.textContent = 'Sin datos anteriores';
      trendEl.className = 'chart-trend-pill neutral';
    } else {
      const arrow = trendPct > 0 ? '↑' : (trendPct < 0 ? '↓' : '·');
      trendEl.textContent = `${arrow} ${Math.abs(trendPct).toFixed(1)}% vs período anterior`;
      trendEl.className = trendPct > 0 ? 'chart-trend-pill up' : (trendPct < 0 ? 'chart-trend-pill down' : 'chart-trend-pill neutral');
    }
  }

  const accent = getCss('--success');
  const muted = getCss('--text-muted');

  charts.compare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Período actual',
          data: curData,
          backgroundColor: accent,
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'Período anterior',
          data: prevData,
          backgroundColor: hexToRgba(muted, 0.3),
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          ticks: { color: getCss('--chart-text'), font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          ticks: { color: getCss('--chart-text'), font: { size: 10 } },
          grid: { color: getCss('--chart-grid') },
          border: { display: false },
        },
      },
    },
  });
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderChartTipo() {
  destroyChart('tipo');
  ensureCanvas('chartTipo');
  const ctx = document.getElementById('chartTipo');
  if (!ctx) return;
  const sums = {};
  getFilteredRegistro().forEach(r => {
    sums[r.tipo] = (sums[r.tipo] || 0) + r.profit;
  });
  const tipos = Object.keys(sums);
  if (tipos.length === 0) return;
  charts.tipo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tipos,
      datasets: [{
        label: 'Profit',
        data: tipos.map(t => sums[t]),
        backgroundColor: tipos.map(t => sums[t] >= 0 ? getCss('--success') : getCss('--danger')),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      animation: CHART_ANIM,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: getCss('--chart-text'), font: { size: 10 } }, grid: { color: getCss('--chart-grid') }, border: { display: false } },
        y: { ticks: { color: getCss('--chart-text'), font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderChartTier() {
  destroyChart('tier');
  ensureCanvas('chartTier');
  const ctx = document.getElementById('chartTier');
  if (!ctx) return;
  const sums = {};
  getFilteredRegistro().forEach(r => {
    sums[r.tier] = (sums[r.tier] || 0) + r.profit;
  });
  const tiers = Object.keys(sums).sort();
  if (tiers.length === 0) return;
  charts.tier = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tiers.map(t => `T${t}`),
      datasets: [{
        label: 'Profit',
        data: tiers.map(t => sums[t]),
        backgroundColor: tiers.map(t => sums[t] >= 0 ? getCss('--success') : getCss('--danger')),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: getCss('--chart-text'), font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: getCss('--chart-text'), font: { size: 10 } }, grid: { color: getCss('--chart-grid') }, border: { display: false } },
      },
    },
  });
}

// renderChartEnch removed — replaced by gauge chart

// =====================================================
// UI - SETTINGS
// =====================================================

function initSettings() {
  document.getElementById('btnExport').addEventListener('click', exportarJSON);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
  document.getElementById('fileImport').addEventListener('change', importarJSON);
  document.getElementById('btnClear').addEventListener('click', borrarTodo);

  // GitHub Gist sync
  document.getElementById('btnSyncSave').addEventListener('click', handleSyncSave);
  document.getElementById('btnSyncTest').addEventListener('click', handleSyncTest);
  document.getElementById('btnSyncNow').addEventListener('click', pushToGist);
  document.getElementById('btnSyncPull').addEventListener('click', pullFromGist);
  document.getElementById('btnSyncDisconnect').addEventListener('click', handleSyncDisconnect);
  const btnRestore = document.getElementById('btnRestoreBackup');
  if (btnRestore) btnRestore.addEventListener('click', handleRestoreBackup);

  // Dashboard period/goal controls
  populateMonthSelect();
  setupDashboardControls();
  updateStorageInfo();
  updateSyncUI();
}

function setupDashboardControls() {
  document.getElementById('dashPeriod').addEventListener('change', e => {
    dashFilters.period = e.target.value;
    togglePeriodExtras();
    updateDashboard();
  });
  document.getElementById('dashMonthSelect').addEventListener('change', e => {
    const [y, m] = e.target.value.split('-').map(Number);
    dashFilters.month = { year: y, month: m - 1 };
    updateDashboard();
  });
  document.getElementById('dashDateFrom').addEventListener('change', e => {
    dashFilters.customFrom = e.target.value;
    updateDashboard();
  });
  document.getElementById('dashDateTo').addEventListener('change', e => {
    dashFilters.customTo = e.target.value;
    updateDashboard();
  });
  document.getElementById('dashGoalAmount').addEventListener('input', e => {
    dashFilters.goalAmount = parseFloat(e.target.value) || 0;
    updateDashboard();
  });
  document.getElementById('dashGoalPeriod').addEventListener('change', e => {
    dashFilters.goalPeriod = e.target.value;
    const defaults = { day: 100000, week: 500000, month: 1000000 };
    const el = document.getElementById('dashGoalAmount');
    if (el && (el.value === '' || parseFloat(el.value) === 0)) {
      el.value = defaults[e.target.value];
      dashFilters.goalAmount = defaults[e.target.value];
    }
    updateDashboard();
  });
  togglePeriodExtras();
}

function togglePeriodExtras() {
  const period = dashFilters.period;
  const customBox = document.getElementById('periodCustom');
  const monthSel = document.getElementById('dashMonthSelect');
  customBox.classList.toggle('hidden', period !== 'custom');
  monthSel.classList.toggle('hidden', period !== 'month');
}

function populateMonthSelect() {
  const sel = document.getElementById('dashMonthSelect');
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const now = new Date();
  // Show last 12 months
  sel.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const opt = document.createElement('option');
    opt.value = `${d.getFullYear()}-${d.getMonth() + 1}`;
    opt.textContent = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  }
  // Default to current month
  dashFilters.month = { year: now.getFullYear(), month: now.getMonth() };
}

function updateStorageInfo() {
  const size = (JSON.stringify(state).length / 1024).toFixed(1);
  let backupInfo = '';
  let hasBackup = false;
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (raw) {
      const b = JSON.parse(raw);
      const age = b._backupAt ? new Date(b._backupAt).toLocaleString() : '?';
      hasBackup = b.registro && b.registro.length > 0;
      backupInfo = `<br><small class="hint">♻️ Respaldo: ${b.registro?.length || 0} ops guardado${hasBackup ? ` (${age})` : ''}</small>`;
    }
  } catch (e) {}
  document.getElementById('storageInfo').innerHTML =
    `<strong>Datos guardados:</strong> ${state.registro.length} operaciones, ${size} KB${backupInfo}`;

  // Show restore button ONLY if local is empty and backup has data
  const restoreArea = document.getElementById('backupRestoreArea');
  if (restoreArea) {
    const showRestore = state.registro.length === 0 && hasBackup;
    restoreArea.classList.toggle('hidden', !showRestore);
  }
}

function exportarJSON() {
  const data = {
    version: 1,
    exportDate: new Date().toISOString(),
    precios: state.precios,
    registro: state.registro,
            sellos: state.sellos,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `caerleon-profit-${data.exportDate.slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📤 JSON exportado', 'success');
}

function importarJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.precios || !data.registro) throw new Error('Formato inválido');
      if (!confirm(`¿Importar ${data.registro.length} operaciones? Esto REEMPLAZARÁ tus datos actuales.`)) return;
      state.precios = data.precios;
      if (data.sellos) state.sellos = data.sellos;
      state.registro = data.registro.map(op => migrateOpVenta(op));
      saveState();
      initPrecios();
      updateCalculadora();
      updateRegistro();
      updateDashboard();
      updateStorageInfo();
      showToast('📥 Datos importados', 'success');
    } catch (err) {
      showToast('❌ Error: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function borrarTodo() {
  if (!confirm('⚠️ ¿BORRAR TODO? Esta acción no se puede deshacer.')) return;
  if (!confirm('¿Seguro? Tus operaciones y precios se perderán.')) return;
  state = {
    precios: structuredClone(DEFAULT_PRECIOS),
    sellos: structuredClone(DEFAULT_SELLOS),
    registro: [],
    theme: state.theme,
  };
  saveState();
  initPrecios();
  updateCalculadora();
  updateRegistro();
  updateDashboard();
  updateStorageInfo();
  showToast('🗑️ Todo borrado', 'info');
}

// =====================================================
// UI - TABS, THEME, TOAST
// =====================================================

function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('tab-' + tab).classList.add('active');
      // Redraw charts when entering dashboard (after layout settles)
      if (tab === 'dashboard') {
        requestAnimationFrame(() => updateDashboard());
      }
    });
  });
}

function initTheme() {
  document.documentElement.dataset.theme = state.theme;
  updateThemeIcon();
  document.getElementById('themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    updateThemeIcon();
    saveState();
    setTimeout(updateDashboard, 100);
  });
}

function updateThemeIcon() {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = state.theme === 'dark' ? '☀️' : '🌙';
}

let toastTimer;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// =====================================================
// INIT
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Update all hardcoded icon paths to match current IMG_BASE
  // (so if user changes IMG_BASE, all icons update automatically)
  // Material icons default to T5 (will be updated when user changes tier in calculator)
  document.querySelectorAll('img[data-mat]').forEach(img => {
    const mat = img.dataset.mat;
    if (MATERIAL_BASE[mat]) {
      img.src = imgUrl(tierMatId(MATERIAL_BASE[mat], 5));
    }
  });

  initTheme();
  initTabs();
  initCustomSelects();
  initCalculadora();
  initRoyal();
  initPrecios();
  initRegistro();
  initDashboard();
  initSettings();

  // SAFETY CHECK: If local is empty BUT we have a backup, offer to restore
  if (state.registro.length === 0) {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (raw) {
        const backup = JSON.parse(raw);
        if (backup.registro && backup.registro.length > 0) {
          const age = backup._backupAt ? new Date(backup._backupAt).toLocaleString() : '?';
          if (confirm(`⚠️ Detecté que tu local está vacío pero hay un backup con ${backup.registro.length} operaciones (de ${age}).\n\n¿Restaurar desde backup?\n(Cancela si quieres descargar de la nube)`)) {
            if (restoreFromBackup()) {
              showToast(`♻️ ${backup.registro.length} operaciones restauradas del backup`, 'success');
              console.log('[Safety] Restored from local backup');
            }
          }
        }
      }
    } catch (e) { /* best effort */ }
  }

  // Auto-pull from cloud on init if configured AND local is empty
  if (syncConfig && syncConfig.token && syncConfig.gistId) {
    // Start background auto-sync (polls every 30s when tab is visible)
    startAutoSync();
    if (state.registro.length === 0) {
      setTimeout(() => {
        checkRemoteChanges({ silent: false });
      }, 500);
    } else {
      setSyncStatus('idle', `☁️ Conectado como @${syncConfig.user || '?'} · auto-sync activo`);
    }
  }
});

// Expose delete function globally for onclick
window.deleteRegistro = deleteRegistro;
