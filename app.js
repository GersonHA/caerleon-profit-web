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
const APP_VERSION = 'v7.0-dashboard';
const BACKUP_KEY = 'caerleon_profit_backup_v1';

// =====================================================
// STATE (carga desde localStorage o inicializa)
// =====================================================

let state = loadState();

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
        dashboard: parsed.dashboard || null,
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
    dashboard: null,
  };
}

// Migration helper: ensure op has ventas array and proper format
function migrateOpVenta(op) {
  if (!op.ventas) {
    op.ventas = [];
    // Auto-create one "vendido" venta from existing pVenta if applicable
    if (op.pVenta && op.pVenta > 0) {
      op.ventas.push({
        id: CaerleonCloud.newId(),
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
    id: CaerleonCloud.newId(),
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
      dashboard: state.dashboard || null,
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
    // Guardar en Supabase (con una pequeña espera para agrupar cambios)
    if (window.CloudSync) CloudSync.schedulePush();
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
    state.registro = normalizeForCloud(data.registro.map(op => migrateOpVenta(op)));
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
// NUBE (Supabase) — ver js/cloud-core.js y js/cloud-ui.js
// =====================================================

// Deja el registro listo para la nube: UUID en operaciones y ventas, y
// estado calculado para las operaciones que no lo tenían (las Reales).
function normalizeForCloud(registro) {
  return CaerleonCloud.normalizeRegistro(registro, {
    classify: calcEstado,
    today: localDateStr(),
  }).registro;
}

// Vuelve a pintar todo con el state actual (tras cargar datos de la nube).
function refreshAllViews() {
  document.documentElement.dataset.theme = state.theme;
  updateThemeIcon();
  const premCalc = document.getElementById('cfgPremium');
  if (premCalc) premCalc.checked = state.premium;
  const premRoyal = document.getElementById('royalPremium');
  if (premRoyal) premRoyal.checked = state.premium;
  updateTaxHint();
  updateRoyalDebug();
  initPrecios();
  updateCalculadora();
  updateRoyalCalc();
  updateRegistro();
  updateDashboard();
  updateStorageInfo();
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
// Texto escrito por el usuario (notas, etc.) -> seguro para insertar en HTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  // Las tarjetas de ganancia eran siempre verdes, incluso con pérdida
  ['rProfit', 'rProfitUnit'].forEach(id => {
    const card = document.getElementById(id).closest('.result-item');
    card.classList.toggle('success', r.profit >= 0);
    card.classList.toggle('danger', r.profit < 0);
  });

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
    id: CaerleonCloud.newId(),
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
    ventas: [],
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
  document.getElementById('royalTaxAmount').textContent = (Math.round(r.taxAmount) > 0 ? '−' : '') + fmt(r.taxAmount);
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
  // calcRoyal devuelve el ROI en porcentaje; el historial lo guarda como fracción
  const estado = calcEstado(r.profit, r.roi / 100, r.profitUnit, state.registro);
  const slot = ROYAL_SLOTS[inp.slot];
  const itemId = `T${inp.tier}_${slot.slot}_${ROYAL_MATERIAL_NAMES[inp.material]}_ROYAL@0`;
  const displayName = `${slot.name} T${inp.tier} (${ROYAL_MATERIAL_DISPLAY[inp.material]})`;

  const reg = {
    id: CaerleonCloud.newId(),
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
    estado: estado.label,
    ventas: [],
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
  [...TIPOS_OBJETO.map(t => t.nombre), 'Sellos Reales'].forEach(nombre => {
    const opt = document.createElement('option');
    opt.value = nombre;
    opt.textContent = nombre;
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

  // Global delegation fallback for data-add-venta (safety net if direct listeners fail)
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add-venta]');
    if (addBtn) {
      // If event already handled by direct listener (which calls stopPropagation),
      // it won't reach here. Otherwise, handle it.
      e.preventDefault();
      const opId = addBtn.getAttribute('data-add-venta');
      console.log('[delegation] add-venta fired for:', opId);
      showAddVentaForm(opId);
      return;
    }
    const editBtn = e.target.closest('[data-edit-venta]');
    if (editBtn) {
      e.preventDefault();
      const [opId, ventaId] = editBtn.getAttribute('data-edit-venta').split('|');
      console.log('[delegation] edit-venta fired for:', opId, ventaId);
      showAddVentaForm(opId, ventaId);
      return;
    }
    const delBtn = e.target.closest('[data-delete-venta]');
    if (delBtn) {
      e.preventDefault();
      const [opId, ventaId] = delBtn.getAttribute('data-delete-venta').split('|');
      console.log('[delegation] delete-venta fired for:', opId, ventaId);
      deleteVenta(opId, ventaId);
      return;
    }
    const toggleBtn = e.target.closest('.expand-btn[data-toggle-id]');
    if (toggleBtn) {
      e.preventDefault();
      const opId = toggleBtn.getAttribute('data-toggle-id');
      toggleOpDetail(opId);
      return;
    }
  }); // Bubble phase: fires AFTER direct listeners (which call stopPropagation)

  updateRegistro();
}

function updateRegistro() {
  const search = document.getElementById('regSearch').value.toLowerCase();
  const filterTipo = document.getElementById('regFilterTipo').value;
  // Validate filterEstado: must be one of the known status values
  const validEstados = ['vendido', 'pendiente', 'fallido', 'crafteado'];
  let filterEstado = document.getElementById('regFilterEstado').value;
  if (filterEstado && !validEstados.includes(filterEstado)) {
    // Legacy/invalid value — clear it
    document.getElementById('regFilterEstado').value = '';
    filterEstado = '';
  }

  let items = [...state.registro];
  if (search) items = items.filter(r =>
    r.tipo.toLowerCase().includes(search) ||
    `t${r.tier}`.includes(search) ||
    (r.notas || '').toLowerCase().includes(search));
  if (filterTipo) items = items.filter(r => r.tipo === filterTipo);
  if (filterEstado) items = items.filter(r => getOpStatus(r) === filterEstado);

  // Orden: de la última operación registrada a la primera.
  // state.registro está en orden de registro (cada nueva se agrega al final),
  // así que basta con invertirlo. Para ver solo las pendientes o crafteadas
  // está el filtro de estado.
  const position = new Map(state.registro.map((op, i) => [op, i]));
  items.sort((a, b) => position.get(b) - position.get(a));

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
    const safeId = (r.id || 'op_' + Math.random().toString(36).slice(2, 8)).replace(/'/g, "&#39;").replace(/"/g, "&quot;");

    return `
      <tr class="op-row" data-op-id="${safeId}">
        <td class="c-expand"><button class="expand-btn" type="button" data-toggle-id="${safeId}" aria-label="Ver intentos de venta">▶</button></td>
        <td class="c-fecha" data-label="Fecha">${escapeHtml(r.fecha || '—')}</td>
        <td class="c-tipo" data-label="Tipo"><img class="mat-icon-sm" src="${imgUrl(r.icon || getItemId(r.tipo, r.tier))}" alt=""> ${escapeHtml(opDisplayName(r))}</td>
        <td class="c-tier" data-label="Nivel">T${r.tier}</td>
        <td class="c-ench" data-label="Enc.">${r.royalSlot ? '—' : `.${r.enchIni}→.${r.enchFin}`}</td>
        <td class="c-qty" data-label="Cant.">${r.qty}</td>
        <td class="c-inv" data-label="Inversión">${fmtSilver(r.inversion)}</td>
        <td class="c-venta" data-label="P. venta">${fmtSilver(r.pVenta)}</td>
        <td class="c-profit" data-label="Ganancia" style="color: ${actualProfit > 0 ? 'var(--success)' : actualProfit < 0 ? 'var(--danger)' : 'inherit'}; font-weight:600;">${fmtSilver(actualProfit)}</td>
        <td class="c-estado"><span class="status-badge status-${opStatus}">${statusBadge}</span></td>
        <td class="c-del"><button class="delete-btn" onclick="event.stopPropagation();deleteRegistro(${realIdx})" aria-label="Borrar operación">🗑️</button></td>
      </tr>
      <tr class="op-detail-row hidden" id="detail-${safeId}">
        <td colspan="11">
          <div class="op-detail-content">
            <div class="ventas-header">
              <strong>📜 Intentos de venta (${ventas.length})</strong>
              <button type="button" class="btn btn-sm btn-primary" data-add-venta="${safeId}">+ Agregar intento</button>
            </div>
            <div class="ventas-list" data-ventas-list="${safeId}">
              ${ventas.length === 0 ? '<p class="hint">Sin intentos de venta aún. Click "+ Agregar intento" cuando intentes vender.</p>' : ventas.map(v => renderVentaRow(safeId, v)).join('')}
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach direct event listeners to each expand button (avoids event delegation issues)
  tbody.querySelectorAll('.expand-btn[data-toggle-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const opId = btn.getAttribute('data-toggle-id');
      toggleOpDetail(opId);
    });
  });
  // Attach direct event listeners to "+ Agregar intento" buttons
  const addVentaBtns = tbody.querySelectorAll('[data-add-venta]');
  console.log('[updateRegistro] add-venta buttons found:', addVentaBtns.length);
  addVentaBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const opId = btn.getAttribute('data-add-venta');
      console.log('[add-venta] click, opId:', opId);
      showAddVentaForm(opId);
    });
  });
  // Attach listeners to venta edit/delete buttons
  tbody.querySelectorAll('.venta-actions [data-edit-venta]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [opId, ventaId] = btn.getAttribute('data-edit-venta').split('|');
      showEditVentaForm(opId, ventaId);
    });
  });
  tbody.querySelectorAll('.venta-actions [data-delete-venta]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [opId, ventaId] = btn.getAttribute('data-delete-venta').split('|');
      deleteVentaConfirm(opId, ventaId);
    });
  });
}

function renderVentaRow(opId, v) {
  return `
    <div class="venta-item venta-${v.estado}">
      <div class="venta-info">
        <span class="venta-fecha">${escapeHtml(v.fecha)} ${escapeHtml(v.hora || '')}</span>
        <span class="venta-precio">${fmtSilver(v.precio)}</span>
        <span class="venta-comprador">${COMPRADOR_LABELS[v.comprador] || escapeHtml(v.comprador)}</span>
        <span class="venta-estado">${ESTADO_VENTA_LABELS[v.estado] || escapeHtml(v.estado)}</span>
        ${v.notas ? `<span class="venta-notas">${escapeHtml(v.notas)}</span>` : ''}
      </div>
      <div class="venta-actions">
        <button type="button" class="btn-tiny" data-edit-venta="${opId}|${v.id}">✏️</button>
        <button type="button" class="btn-tiny danger" data-delete-venta="${opId}|${v.id}">🗑️</button>
      </div>
    </div>
  `;
}

function toggleOpDetail(opId) {
  console.log('[toggleOpDetail] called with opId:', opId);
  const detailRow = document.getElementById(`detail-${opId}`);
  if (!detailRow) {
    console.warn('[toggleOpDetail] no detail row found for', opId);
    return;
  }
  const wasHidden = detailRow.classList.contains('hidden');
  detailRow.classList.toggle('hidden');
  console.log('[toggleOpDetail] toggled', opId, 'wasHidden:', wasHidden);
  // Update expand button arrow
  const btn = document.querySelector(`tr.op-row[data-op-id="${opId}"] .expand-btn`);
  if (btn) btn.textContent = detailRow.classList.contains('hidden') ? '▶' : '▼';
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
            <input type="date" id="vFecha" class="input" value="${escapeHtml(existing?.fecha || localDateStr())}">
          </div>
          <div>
            <label class="label">Hora</label>
            <input type="time" id="vHora" class="input" value="${escapeHtml(existing?.hora || new Date().toTimeString().slice(0,5))}">
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
          <textarea id="vNotas" class="input" rows="2" placeholder="Ej: Slot tomado por otro jugador, listé en player market...">${escapeHtml(existing?.notas || '')}</textarea>
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

// "Casco Real (Tela)" para las operaciones Reales; el tipo para las demás
function opDisplayName(op) {
  const slot = op.royalSlot && ROYAL_SLOTS[op.royalSlot];
  if (!slot) return op.tipo;
  const material = ROYAL_MATERIAL_DISPLAY[op.royalMaterial];
  return material ? `${slot.name} (${material})` : slot.name;
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

const CHART_ANIM = { duration: 600, easing: 'easeOutQuart' };

// Cómo se lee una operación (lo mismo que usa el Registro)
const DASH_HELPERS = {
  status: (op) => getOpStatus(op),
  realized: (op) => getOpActualProfit(op),
};

// Silver y porcentajes con el formato elegido en "Personalizar".
// Los tooltips pasan 'completo' para ver la cifra exacta al pasar el mouse.
function dashSilver(n, modo) {
  return CaerleonDash.formatSilver(n, modo || dashCfg().numberFormat);
}

function dashPct(n, modo) {
  return CaerleonDash.formatPercent(n, modo || dashCfg().numberFormat);
}

function dashTaxRate() {
  return state.premium ? 0.04 : 0.08;
}

// -----------------------------------------------------
// Configuración del panel (se guarda en tu cuenta)
// -----------------------------------------------------

const DASH_DEFAULT = {
  period: 'month',
  month: null,          // { year, month } cuando period = 'month'
  from: null,           // 'YYYY-MM-DD' cuando period = 'custom'
  to: null,
  goalAmount: 1000000,
  goalPeriod: 'month',  // day | week | month
  numberFormat: 'entero', // entero (13 M) | compacto (12,9 M) | completo (12.852.615)
  kpis: ['realizado', 'inventario', 'roi', 'vendidos'],
  panels: ['dia', 'flujo', 'meta', 'estado', 'inventario', 'tier', 'tipo', 'rentabilidad', 'top'],
};

function dashCfg() {
  const saved = (state.dashboard && typeof state.dashboard === 'object') ? state.dashboard : {};
  const cfg = { ...DASH_DEFAULT, ...saved };
  // Solo ids conocidos, y sin repetidos
  cfg.kpis = [...new Set(cfg.kpis)].filter(id => DASH_KPIS.some(k => k.id === id));
  cfg.panels = [...new Set(cfg.panels)].filter(id => DASH_PANELS.some(p => p.id === id));
  if (!cfg.kpis.length) cfg.kpis = [...DASH_DEFAULT.kpis];
  return cfg;
}

function setDashCfg(patch, { rerender = true } = {}) {
  state.dashboard = { ...dashCfg(), ...patch };
  saveState();
  if (rerender) updateDashboard();
}

// -----------------------------------------------------
// KPIs disponibles
// -----------------------------------------------------

const DASH_KPIS = [
  {
    id: 'realizado',
    label: '💰 Profit realizado',
    ayuda: 'Ganancia de las operaciones que ya vendiste, con el impuesto descontado.',
    valor: d => d.hoy.realizado,
    anterior: d => d.antes.realizado,
    fmt: 'money',
    sub: d => `${d.hoy.operacionesVendidas} vendidas`,
    cls: d => d.hoy.realizado >= 0 ? 'success' : 'danger',
  },
  {
    id: 'inventario',
    label: '📦 En inventario',
    ayuda: 'Lo que te costó lo que todavía no has vendido (crafteado o en venta).',
    valor: d => d.hoy.inventarioCosto,
    fmt: 'money',
    sub: d => d.hoy.inventarioCantidad === 0
      ? 'nada sin vender'
      : `${d.hoy.inventarioCantidad} ${d.hoy.inventarioCantidad === 1 ? 'operación' : 'operaciones'} · ${dashSilver(d.hoy.inventarioPotencial)} por cobrar`,
    cls: d => d.hoy.inventarioCantidad > 0 ? 'info' : 'neutral',
  },
  {
    id: 'roi',
    label: '📈 ROI realizado',
    ayuda: 'Ganancia dividida entre lo que invertiste en las operaciones vendidas.',
    valor: d => d.hoy.roiRealizado,
    anterior: d => d.antes.roiRealizado,
    fmt: 'pct',
    sub: d => `${dashSilver(d.hoy.inversionTotal)} invertidos`,
    cls: d => d.hoy.roiRealizado >= 0 ? 'success' : 'danger',
  },
  {
    id: 'vendidos',
    label: '✅ Vendidos',
    ayuda: 'Operaciones cerradas sobre el total del período.',
    valor: d => d.hoy.operacionesVendidas,
    fmt: 'int',
    sub: d => `de ${d.hoy.total} · ${dashPct(d.hoy.tasaExito)} con ganancia`,
    cls: () => 'success',
  },
  {
    id: 'perdidas',
    label: '❌ Pérdidas',
    ayuda: 'Inversión de las operaciones cuyos intentos de venta fallaron.',
    valor: d => d.hoy.perdidas,
    fmt: 'money',
    sub: d => `${d.hoy.operacionesFallidas} fallidas`,
    cls: d => d.hoy.perdidas > 0 ? 'danger' : 'neutral',
  },
  {
    id: 'profitop',
    label: '🎯 Profit por operación',
    ayuda: 'Ganancia media de cada operación vendida.',
    valor: d => d.hoy.profitPorOperacion,
    anterior: d => d.antes.profitPorOperacion,
    fmt: 'money',
    sub: d => `mejor ${dashSilver(d.hoy.mejor)}`,
    cls: d => d.hoy.profitPorOperacion >= 0 ? 'success' : 'danger',
  },
  {
    id: 'inversion',
    label: '🏦 Inversión del período',
    ayuda: 'Silver que pusiste en todas las operaciones del período.',
    valor: d => d.hoy.inversionTotal,
    anterior: d => d.antes.inversionTotal,
    fmt: 'money',
    sub: d => `${d.hoy.total} operaciones`,
    cls: () => 'neutral',
  },
  {
    id: 'meta',
    label: '🚩 Meta',
    ayuda: 'Cuánto llevas de tu meta, en su propio período.',
    valor: d => d.meta.pct,
    fmt: 'pct',
    sub: d => `${dashSilver(d.meta.logrado)} de ${dashSilver(d.meta.goal)} ${d.meta.range.label}`,
    cls: d => d.meta.cumplida ? 'success' : 'info',
  },
];

// -----------------------------------------------------
// Paneles disponibles
// -----------------------------------------------------

const DASH_PANELS = [
  {
    id: 'dia',
    titulo: 'Profit por día',
    subtitulo: 'Barras de color = este período · grises = el anterior',
    render: renderPanelDia,
  },
  {
    id: 'flujo',
    titulo: 'Inversión, venta y ganancia por día',
    subtitulo: 'Lo que pusiste, lo que pagó el Mercado Negro y lo que te quedó',
    render: renderPanelFlujo,
  },
  {
    id: 'horas',
    titulo: 'Ganancia por hora del día',
    subtitulo: 'A qué hora vendes mejor (según la hora de cada venta)',
    render: renderPanelHoras,
  },
  {
    id: 'acumulado',
    titulo: 'Acumulado del período',
    subtitulo: 'Cómo se suma tu ganancia día a día',
    render: renderPanelAcumulado,
  },
  {
    id: 'meta',
    titulo: 'Meta',
    subtitulo: 'Progreso y ritmo necesario',
    render: renderPanelMeta,
  },
  {
    id: 'estado',
    titulo: 'Distribución por estado',
    subtitulo: 'Cómo se reparten tus operaciones',
    render: renderPanelEstado,
  },
  {
    id: 'inventario',
    titulo: 'Inventario',
    subtitulo: 'Lo que tienes sin vender',
    render: renderPanelInventario,
  },
  {
    id: 'tier',
    titulo: 'Profit por tier',
    subtitulo: 'Cuál te deja más silver',
    render: renderPanelTier,
  },
  {
    id: 'tipo',
    titulo: 'Profit por tipo de objeto',
    subtitulo: 'Cuál item es tu fuerte',
    render: renderPanelTipo,
  },
  {
    id: 'rentabilidad',
    titulo: 'Rentabilidad',
    subtitulo: 'Cuánto deja cada combinación de item y tier',
    render: renderPanelRentabilidad,
  },
  {
    id: 'top',
    titulo: 'Top operaciones',
    subtitulo: 'Tus mejores ventas del período',
    render: renderPanelTop,
  },
];

// -----------------------------------------------------
// Datos del período
// -----------------------------------------------------

function dashData() {
  const cfg = dashCfg();
  const now = new Date();
  const range = CaerleonDash.periodRange(cfg.period, {
    now,
    month: cfg.month,
    customFrom: cfg.from,
    customTo: cfg.to,
    fechas: state.registro.map(o => o.fecha),
  });
  const prev = CaerleonDash.previousRange(range);
  const opts = { ...DASH_HELPERS, taxRate: dashTaxRate() };

  const ops = CaerleonDash.filterByRange(state.registro, range);
  const opsPrev = CaerleonDash.filterByRange(state.registro, prev);

  return {
    cfg,
    now,
    range,
    prev,
    ops,
    opsPrev,
    opts,
    hoy: CaerleonDash.summarize(ops, opts),
    antes: CaerleonDash.summarize(opsPrev, opts),
    meta: CaerleonDash.goalProgress(state.registro, {
      goal: cfg.goalAmount,
      goalPeriod: cfg.goalPeriod,
      now,
      ...DASH_HELPERS,
    }),
  };
}

// -----------------------------------------------------
// Render principal
// -----------------------------------------------------

let dashPendiente = false;

function initDashboard() {
  const tabBtn = document.querySelector('.tab[data-tab="dashboard"]');
  if (tabBtn) tabBtn.addEventListener('click', () => requestAnimationFrame(updateDashboard));
  void dashPendiente;
  bindDashControls();
  updateDashboard();
}

function updateDashboard() {
  if (!document.getElementById('dashPanels')) return;
  // Chart.js no puede medir un lienzo oculto: si el Dashboard no está a la
  // vista se deja pendiente y se dibuja al abrir la pestaña.
  if (!dashboardVisible()) { dashPendiente = true; return; }
  dashPendiente = false;
  const d = dashData();
  syncDashControls(d);
  renderKpis(d);
  renderPanels(d);
}

function dashboardVisible() {
  const tab = document.getElementById('tab-dashboard');
  return !!tab && tab.classList.contains('active');
}

// -----------------------------------------------------
// Controles: período, meta y modo edición
// -----------------------------------------------------

function bindDashControls() {
  document.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      const patch = { period };
      if (period === 'month' && !dashCfg().month) {
        const now = new Date();
        patch.month = { year: now.getFullYear(), month: now.getMonth() };
      }
      setDashCfg(patch);
    });
  });

  const mes = document.getElementById('dashMonth');
  if (mes) {
    const now = new Date();
    mes.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const opt = document.createElement('option');
      opt.value = `${d.getFullYear()}-${d.getMonth()}`;
      opt.textContent = `${CaerleonDash.MESES[d.getMonth()]} ${d.getFullYear()}`;
      mes.appendChild(opt);
    }
    mes.addEventListener('change', () => {
      const [year, month] = mes.value.split('-').map(Number);
      setDashCfg({ month: { year, month } });
    });
  }

  const desde = document.getElementById('dashFrom');
  const hasta = document.getElementById('dashTo');
  if (desde) desde.addEventListener('change', () => setDashCfg({ from: desde.value }));
  if (hasta) hasta.addEventListener('change', () => setDashCfg({ to: hasta.value }));

  const metaAmount = document.getElementById('dashGoalAmount');
  if (metaAmount) {
    let timer = null;
    metaAmount.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => setDashCfg({ goalAmount: Math.max(0, parseFloat(metaAmount.value) || 0) }), 500);
    });
  }
  const metaPeriod = document.getElementById('dashGoalPeriod');
  if (metaPeriod) metaPeriod.addEventListener('change', () => setDashCfg({ goalPeriod: metaPeriod.value }));

  const editar = document.getElementById('dashEdit');
  if (editar) {
    editar.addEventListener('click', () => {
      const activo = document.body.classList.toggle('dash-editing');
      editar.classList.toggle('active', activo);
      editar.textContent = activo ? '✓ Listo' : '⚙️ Personalizar';
      document.getElementById('dashEditor').classList.toggle('hidden', !activo);
      if (activo) renderDashEditor();
    });
  }

  const restaurar = document.getElementById('dashReset');
  if (restaurar) {
    restaurar.addEventListener('click', () => {
      if (!confirm('¿Volver al panel por defecto?')) return;
      state.dashboard = { ...DASH_DEFAULT };
      saveState();
      updateDashboard();
      renderDashEditor();
      showToast('Panel restaurado', 'info');
    });
  }

}

function syncDashControls(d) {
  document.querySelectorAll('[data-period]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === d.cfg.period);
  });
  document.getElementById('dashMonthWrap').classList.toggle('hidden', d.cfg.period !== 'month');
  document.getElementById('dashCustomWrap').classList.toggle('hidden', d.cfg.period !== 'custom');

  const mes = document.getElementById('dashMonth');
  if (mes && d.cfg.month) mes.value = `${d.cfg.month.year}-${d.cfg.month.month}`;

  const desde = document.getElementById('dashFrom');
  const hasta = document.getElementById('dashTo');
  if (desde && d.cfg.from) desde.value = d.cfg.from;
  if (hasta && d.cfg.to) hasta.value = d.cfg.to;

  const amount = document.getElementById('dashGoalAmount');
  if (amount && document.activeElement !== amount) amount.value = d.cfg.goalAmount;
  const period = document.getElementById('dashGoalPeriod');
  if (period) period.value = d.cfg.goalPeriod;

  const resumen = document.getElementById('dashRangeLabel');
  if (resumen) {
    resumen.textContent = `${d.range.label} · ${CaerleonDash.dateKey(d.range.from)} → ${CaerleonDash.dateKey(d.range.to)} · ${d.hoy.total} operaciones`;
  }
}

// -----------------------------------------------------
// KPIs
// -----------------------------------------------------

function renderKpis(d) {
  const grid = document.getElementById('kpiGrid');
  if (!grid) return;

  grid.innerHTML = d.cfg.kpis.map(id => {
    const kpi = DASH_KPIS.find(k => k.id === id);
    if (!kpi) return '';
    const valor = kpi.valor(d);
    const anterior = kpi.anterior ? kpi.anterior(d) : null;
    const variacion = kpi.anterior ? CaerleonDash.delta(valor, anterior) : null;

    return `
      <div class="kpi-card ${kpi.cls(d)}" title="${escapeHtml(kpi.ayuda)}">
        <span class="kpi-label">${kpi.label}</span>
        <span class="kpi-value" id="kpi-${kpi.id}">${formatKpi(valor, kpi.fmt)}</span>
        <span class="kpi-sub">${escapeHtml(kpi.sub ? kpi.sub(d) : '')}</span>
        ${variacion === null ? '' : `<span class="kpi-delta ${variacion >= 0 ? 'up' : 'down'}">${variacion >= 0 ? '↑' : '↓'} ${dashPct(Math.abs(variacion))} vs período anterior</span>`}
      </div>`;
  }).join('');
}

function formatKpi(v, fmt) {
  if (fmt === 'money') return dashSilver(v);
  if (fmt === 'pct') return dashPct(v);
  return String(Math.round(v));
}

// -----------------------------------------------------
// Paneles
// -----------------------------------------------------

function renderPanels(d) {
  const cont = document.getElementById('dashPanels');
  if (!cont) return;

  Object.keys(charts).forEach(destroyChart);
  cont.innerHTML = d.cfg.panels.map(id => {
    const panel = DASH_PANELS.find(p => p.id === id);
    if (!panel) return '';
    return `
      <div class="chart-card dash-panel" data-panel="${panel.id}">
        <div class="chart-header-row">
          <div>
            <div class="chart-title">${escapeHtml(panel.titulo)}</div>
            <div class="chart-subtitle">${escapeHtml(panel.subtitulo)}</div>
          </div>
          <div class="panel-tools">
            <button type="button" class="btn-tiny" data-move="${panel.id}|-1" title="Subir">↑</button>
            <button type="button" class="btn-tiny" data-move="${panel.id}|1" title="Bajar">↓</button>
            <button type="button" class="btn-tiny danger" data-hide="${panel.id}" title="Ocultar">✕</button>
          </div>
        </div>
        <div class="panel-body" data-body="${panel.id}"></div>
      </div>`;
  }).join('');

  d.cfg.panels.forEach(id => {
    const panel = DASH_PANELS.find(p => p.id === id);
    const body = cont.querySelector(`[data-body="${id}"]`);
    if (panel && body) panel.render(body, d);
  });

  cont.querySelectorAll('[data-move]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [id, dir] = btn.dataset.move.split('|');
      moverPanel(id, Number(dir));
    });
  });
  cont.querySelectorAll('[data-hide]').forEach(btn => {
    btn.addEventListener('click', () => togglePanel(btn.dataset.hide, false));
  });
}

function moverPanel(id, dir) {
  const panels = [...dashCfg().panels];
  const i = panels.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= panels.length) return;
  [panels[i], panels[j]] = [panels[j], panels[i]];
  setDashCfg({ panels });
  renderDashEditor();
}

function togglePanel(id, visible) {
  const cfg = dashCfg();
  const panels = visible
    ? [...cfg.panels, id]
    : cfg.panels.filter(p => p !== id);
  setDashCfg({ panels });
  renderDashEditor();
}

function toggleKpi(id, visible) {
  const cfg = dashCfg();
  const kpis = visible ? [...cfg.kpis, id] : cfg.kpis.filter(k => k !== id);
  if (!kpis.length) {
    showToast('Deja al menos un indicador', 'warn');
    renderDashEditor();
    return;
  }
  setDashCfg({ kpis });
  renderDashEditor();
}

function renderDashEditor() {
  const box = document.getElementById('dashEditor');
  if (!box || box.classList.contains('hidden')) return;
  const cfg = dashCfg();

  box.querySelector('[data-editor="kpis"]').innerHTML = DASH_KPIS.map(k => `
    <label class="dash-toggle">
      <input type="checkbox" data-kpi="${k.id}" ${cfg.kpis.includes(k.id) ? 'checked' : ''}>
      <span>${k.label}</span>
    </label>`).join('');

  box.querySelector('[data-editor="panels"]').innerHTML = DASH_PANELS.map(p => `
    <label class="dash-toggle">
      <input type="checkbox" data-panelcheck="${p.id}" ${cfg.panels.includes(p.id) ? 'checked' : ''}>
      <span>${escapeHtml(p.titulo)}</span>
    </label>`).join('');

  const formato = box.querySelector('[data-editor="formato"]');
  if (formato) {
    formato.value = cfg.numberFormat;
    formato.onchange = () => setDashCfg({ numberFormat: formato.value });
  }

  box.querySelectorAll('[data-kpi]').forEach(input => {
    input.addEventListener('change', () => toggleKpi(input.dataset.kpi, input.checked));
  });
  box.querySelectorAll('[data-panelcheck]').forEach(input => {
    input.addEventListener('change', () => togglePanel(input.dataset.panelcheck, input.checked));
  });
}

// -----------------------------------------------------
// Utilidades de gráficos
// -----------------------------------------------------

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    delete charts[name];
  }
}

function canvasEn(body, id, alto = 260) {
  body.innerHTML = `<div class="chart-box" style="height:${alto}px"><canvas id="${id}"></canvas></div>`;
  return document.getElementById(id);
}

function ejes({ moneda = true } = {}) {
  return {
    x: {
      ticks: { color: getCss('--chart-text'), font: { size: 10 } },
      grid: { display: false },
    },
    y: {
      ticks: {
        color: getCss('--chart-text'),
        font: { size: 10 },
        callback: v => moneda ? dashSilver(v) : v,
      },
      grid: { color: getCss('--chart-grid') },
      border: { display: false },
    },
  };
}

function tooltipMoneda(extra = {}) {
  return {
    backgroundColor: getCss('--bg-card'),
    titleColor: getCss('--text-primary'),
    bodyColor: getCss('--text-secondary'),
    borderColor: getCss('--border'),
    borderWidth: 1,
    padding: 10,
    displayColors: true,
    callbacks: {
      label: ctx => ` ${ctx.dataset.label}: ${dashSilver(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed, 'completo')}`,
      ...extra,
    },
  };
}

function sinDatos(body, texto) {
  body.innerHTML = `<p class="dash-empty">${escapeHtml(texto)}</p>`;
}

// -----------------------------------------------------
// Paneles: implementaciones
// -----------------------------------------------------

function renderPanelDia(body, d) {
  const serie = CaerleonDash.dailySeries(d.ops, d.range, d.prev, DASH_HELPERS);
  if (!serie.dias) return sinDatos(body, 'Sin días en este período.');

  const totalActual = serie.actual.reduce((a, b) => a + b, 0);
  const totalAnterior = serie.anterior.reduce((a, b) => a + b, 0);
  const variacion = CaerleonDash.delta(totalActual, totalAnterior);

  body.innerHTML = `
    <div class="panel-note">
      ${variacion === null
        ? 'Sin datos del período anterior para comparar.'
        : `<span class="chart-trend-pill ${variacion >= 0 ? 'up' : 'down'}">${variacion >= 0 ? '↑' : '↓'} ${dashPct(Math.abs(variacion))} vs período anterior</span>
           <span class="muted">${dashSilver(totalActual)} frente a ${dashSilver(totalAnterior)}</span>`}
    </div>
    <div class="chart-box" style="height:260px"><canvas id="chartDia"></canvas></div>`;

  const verde = getCss('--success');
  charts.dia = new Chart(document.getElementById('chartDia'), {
    type: 'bar',
    data: {
      labels: serie.labels,
      datasets: [
        {
          label: 'Período anterior',
          data: serie.anterior,
          backgroundColor: hexToRgba(getCss('--text-muted') || '#9ca3af', 0.35),
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'Este período',
          data: serie.actual,
          backgroundColor: serie.actual.map(v => v >= 0 ? verde : getCss('--danger')),
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: getCss('--chart-text'), boxWidth: 10, usePointStyle: true } },
        tooltip: tooltipMoneda(),
      },
      scales: ejes(),
    },
  });
}

function renderPanelAcumulado(body, d) {
  const serie = CaerleonDash.dailySeries(d.ops, d.range, d.prev, DASH_HELPERS);
  const acumulado = CaerleonDash.cumulativeSeries(serie);
  if (!acumulado.length) return sinDatos(body, 'Sin operaciones en este período.');

  const canvas = canvasEn(body, 'chartAcumulado', 260);
  const accent = getCss('--accent');
  const mismaMeta = d.cfg.goalPeriod === d.cfg.period;

  const datasets = [{
    label: 'Acumulado',
    data: acumulado,
    borderColor: accent,
    backgroundColor: hexToRgba(accent, 0.15),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    fill: true,
    tension: 0.25,
  }];

  if (mismaMeta && d.cfg.goalAmount > 0) {
    datasets.push({
      label: 'Meta',
      data: acumulado.map(() => d.cfg.goalAmount),
      borderColor: getCss('--warning'),
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
    });
  }

  charts.acumulado = new Chart(canvas, {
    type: 'line',
    data: { labels: serie.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom', labels: { color: getCss('--chart-text'), boxWidth: 10, usePointStyle: true } },
        tooltip: tooltipMoneda(),
      },
      scales: ejes(),
    },
  });
}

function renderPanelFlujo(body, d) {
  const s = CaerleonDash.flowSeries(d.ops, d.range, DASH_HELPERS);
  if (!s.dias) return sinDatos(body, 'Sin días en este período.');

  const totalInv = s.inversion.reduce((a, b) => a + b, 0);
  const totalVenta = s.venta.reduce((a, b) => a + b, 0);
  const totalGan = s.ganancia.reduce((a, b) => a + b, 0);
  if (totalVenta === 0) return sinDatos(body, 'Sin ventas cerradas en este período.');

  body.innerHTML = `
    <div class="panel-note">
      <span class="muted">Invertiste ${dashSilver(totalInv)} · el Mercado Negro pagó ${dashSilver(totalVenta)} ·
      te quedaron ${dashSilver(totalGan)} (la diferencia es tu costo más el ${(d.opts.taxRate * 100).toFixed(0)}% de impuesto)</span>
    </div>
    <div class="chart-box" style="height:280px"><canvas id="chartFlujo"></canvas></div>`;

  // Tres series distintas: colores validados para daltonismo, con leyenda
  const linea = (label, data, color) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    tension: 0.25,
    fill: false,
  });

  charts.flujo = new Chart(document.getElementById('chartFlujo'), {
    type: 'line',
    data: {
      labels: s.labels,
      datasets: [
        linea('Inversión', s.inversion, getCss('--warning')),
        linea('Venta (Mercado Negro)', s.venta, getCss('--info')),
        linea('Ganancia', s.ganancia, getCss('--success')),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: getCss('--chart-text'), boxWidth: 10, usePointStyle: true } },
        tooltip: tooltipMoneda(),
      },
      scales: ejes(),
    },
  });
}

function renderPanelHoras(body, d) {
  const s = CaerleonDash.hourSeries(d.ops, DASH_HELPERS);
  if (!s.total) return sinDatos(body, 'Sin ventas cerradas en este período.');

  const aviso = s.migradas > 0
    ? `<span class="muted">Ojo: ${s.migradas} de ${s.total} ventas vienen de la importación y quedaron todas a las 12:00.</span>`
    : `<span class="muted">${s.total} ventas con hora registrada.</span>`;

  body.innerHTML = `<div class="panel-note">${aviso}</div>
    <div class="chart-box" style="height:240px"><canvas id="chartHoras"></canvas></div>`;

  charts.horas = new Chart(document.getElementById('chartHoras'), {
    type: 'bar',
    data: {
      labels: s.labels,
      datasets: [{
        label: 'Ganancia',
        data: s.profit,
        backgroundColor: s.profit.map(v => v >= 0 ? getCss('--accent') : getCss('--danger')),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      plugins: {
        legend: { display: false },
        tooltip: tooltipMoneda({
          afterLabel: ctx => `  ${s.ventas[ctx.dataIndex]} venta${s.ventas[ctx.dataIndex] === 1 ? '' : 's'}`,
        }),
      },
      scales: ejes(),
    },
  });
}

function renderPanelMeta(body, d) {
  const m = d.meta;
  const pctTexto = dashPct(m.pct);
  const canvasId = 'chartMeta';

  body.innerHTML = `
    <div class="meta-layout">
      <div class="gauge-wrapper">
        <div class="chart-box" style="height:180px"><canvas id="${canvasId}"></canvas></div>
        <div class="gauge-center">
          <div class="gauge-value">${pctTexto}</div>
          <div class="gauge-label">de la meta ${escapeHtml(m.range.label)}</div>
        </div>
      </div>
      <div class="meta-datos">
        <div class="meta-row"><span>Llevas</span><strong>${dashSilver(m.logrado)}</strong></div>
        <div class="meta-row"><span>Meta</span><strong>${dashSilver(m.goal)}</strong></div>
        <div class="meta-row"><span>${m.cumplida ? 'De sobra' : 'Te falta'}</span>
          <strong class="${m.cumplida ? 'pos' : 'neg'}">${dashSilver(m.cumplida ? m.logrado - m.goal : m.falta)}</strong></div>
        <div class="meta-row"><span>Días restantes</span><strong>${m.diasRestantes}</strong></div>
        ${m.cumplida
          ? '<div class="meta-row destacado">🎉 Meta cumplida</div>'
          : `<div class="meta-row"><span>Ritmo necesario</span><strong>${dashSilver(m.ritmoNecesario)} / día</strong></div>`}
        <div class="meta-row"><span>A este ritmo terminas en</span><strong>${dashSilver(m.proyeccion)}</strong></div>
      </div>
    </div>`;

  const logrado = Math.max(0, Math.min(m.goal, m.logrado));
  const resto = Math.max(0, m.goal - m.logrado);
  const color = m.cumplida ? getCss('--success') : getCss('--accent');

  charts.meta = new Chart(document.getElementById(canvasId), {
    type: 'doughnut',
    data: {
      labels: ['Logrado', 'Falta'],
      datasets: [{
        data: m.goal > 0 ? [logrado, resto] : [0, 1],
        backgroundColor: [color, hexToRgba(getCss('--text-muted') || '#9ca3af', 0.2)],
        borderWidth: 0,
        circumference: 180,
        rotation: 270,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      animation: CHART_ANIM,
      plugins: { legend: { display: false }, tooltip: tooltipMoneda() },
    },
  });
}

function renderPanelEstado(body, d) {
  const counts = {};
  d.ops.forEach(r => {
    const clave = r.estado || 'Sin estado';
    counts[clave] = (counts[clave] || 0) + 1;
  });
  // Los estados son una escala: se muestran siempre en el mismo orden,
  // del mejor al peor, y lo desconocido al final.
  const ORDEN_ESTADOS = ['🟢 Excelente', '🟡 Buena', '🔵 Bulk Win', '🟠 Marginal', '🔴 Pérdida'];
  const keys = Object.keys(counts).sort((x, y) => {
    const ix = ORDEN_ESTADOS.indexOf(x), iy = ORDEN_ESTADOS.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  if (!keys.length) return sinDatos(body, 'Sin operaciones en este período.');

  // Cada estado tiene su color; "Sin histórico" va en gris (antes usaba el
  // mismo morado que "Bulk Win", así que no se distinguían)
  const colores = {
    '🟢 Excelente': getCss('--excelente'),
    '🟡 Buena': getCss('--buena'),
    '🔵 Bulk Win': getCss('--bulk'),
    '🟠 Marginal': getCss('--marginal'),
    '🔴 Pérdida': getCss('--perdida'),
  };
  const gris = getCss('--text-muted') || '#9ca3af';
  const colors = keys.map(k => colores[k] || gris);
  const total = keys.reduce((s, k) => s + counts[k], 0);

  body.innerHTML = `
    <div class="donut-wrapper">
      <div class="chart-box" style="height:200px"><canvas id="chartEstado"></canvas></div>
      <div class="donut-center">
        <div class="donut-center-value">${total}</div>
        <div class="donut-center-label">Operaciones</div>
      </div>
    </div>
    <div class="donut-legend">
      ${keys.map((k, i) => `
        <div class="donut-legend-item">
          <div class="label"><span class="dot" style="background:${colors[i]}"></span>${escapeHtml(String(k).replace(/^\p{Extended_Pictographic}\s*/u, ''))}</div>
          <div class="value">${counts[k]} <span class="muted">(${dashPct(counts[k] / total)})</span></div>
        </div>`).join('')}
    </div>`;

  charts.estado = new Chart(document.getElementById('chartEstado'), {
    type: 'doughnut',
    data: {
      labels: keys.map(k => String(k).replace(/^\p{Extended_Pictographic}\s*/u, '')),
      datasets: [{
        data: keys.map(k => counts[k]),
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
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: getCss('--bg-card'),
          titleColor: getCss('--text-primary'),
          bodyColor: getCss('--text-secondary'),
          borderColor: getCss('--border'),
          borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.parsed} operaciones (${dashPct(ctx.parsed / total)})` },
        },
      },
    },
  });
}

function renderPanelInventario(body, d) {
  const items = CaerleonDash.inventory(state.registro, { ...DASH_HELPERS, taxRate: dashTaxRate(), now: d.now });
  if (!items.length) {
    return sinDatos(body, 'No tienes operaciones sin vender. Cuando guardes una operación y todavía no la vendas, aparecerá aquí.');
  }

  const costo = items.reduce((s, i) => s + i.costo, 0);
  const potencial = items.reduce((s, i) => s + i.potencial, 0);

  body.innerHTML = `
    <div class="panel-note">
      <span class="muted">${items.length} sin vender · ${dashSilver(costo)} invertidos · ${dashSilver(potencial)} por cobrar si vendes al precio anotado</span>
    </div>
    <div class="table-scroll">
      <table class="data-table inventario-table">
        <thead>
          <tr><th>Item</th><th>Estado</th><th>Días</th><th>Costo</th><th>Por cobrar</th></tr>
        </thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td><img class="mat-icon-sm" src="${imgUrl(i.op.icon || getItemId(i.op.tipo, i.op.tier))}" alt="">
                  ${escapeHtml(opDisplayName(i.op))} <span class="muted">T${i.op.tier}${i.op.royalSlot ? '' : '.' + i.op.enchFin}</span></td>
              <td><span class="status-badge status-${i.estado}">${i.estado === 'pendiente' ? '⏳ En venta' : '⚪ Crafteado'}</span></td>
              <td>${i.dias}</td>
              <td>${dashSilver(i.costo)}</td>
              <td class="${i.potencial >= 0 ? 'pos' : 'neg'}">${dashSilver(i.potencial)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderPanelTier(body, d) {
  const filas = CaerleonDash.groupBy(d.ops, o => 'T' + o.tier, DASH_HELPERS)
    .sort((a, b) => a.key.localeCompare(b.key));
  if (!filas.length) return sinDatos(body, 'Sin operaciones en este período.');

  const canvas = canvasEn(body, 'chartTier', 240);
  const verde = getCss('--success');
  charts.tier = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: filas.map(f => f.key),
      datasets: [{
        label: 'Profit realizado',
        data: filas.map(f => f.profit),
        backgroundColor: filas.map(f => f.profit >= 0 ? verde : getCss('--danger')),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      plugins: { legend: { display: false }, tooltip: tooltipMoneda() },
      scales: ejes(),
    },
  });
}

function renderPanelTipo(body, d) {
  const filas = CaerleonDash.groupBy(d.ops, o => opDisplayName(o), DASH_HELPERS).slice(0, 8);
  if (!filas.length) return sinDatos(body, 'Sin operaciones en este período.');

  const canvas = canvasEn(body, 'chartTipo', Math.max(160, filas.length * 42));
  const verde = getCss('--success');
  charts.tipo = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: filas.map(f => f.key),
      datasets: [{
        label: 'Profit realizado',
        data: filas.map(f => f.profit),
        backgroundColor: filas.map(f => f.profit >= 0 ? verde : getCss('--danger')),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIM,
      plugins: { legend: { display: false }, tooltip: tooltipMoneda() },
      scales: {
        x: {
          ticks: { color: getCss('--chart-text'), font: { size: 10 }, callback: v => dashSilver(v) },
          grid: { color: getCss('--chart-grid') },
          border: { display: false },
        },
        y: { ticks: { color: getCss('--chart-text'), font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderPanelRentabilidad(body, d) {
  const filas = CaerleonDash.groupBy(d.ops, o => `${opDisplayName(o)}|T${o.tier}`, DASH_HELPERS);
  if (!filas.length) return sinDatos(body, 'Sin operaciones en este período.');

  body.innerHTML = `
    <div class="table-scroll">
      <table class="data-table rentabilidad-table">
        <thead>
          <tr><th>Item</th><th>Tier</th><th>Ops</th><th>Vendidas</th><th>Inversión</th><th>Profit</th><th>ROI</th></tr>
        </thead>
        <tbody>
          ${filas.map(f => {
            const [nombre, tier] = f.key.split('|');
            return `
            <tr>
              <td>${escapeHtml(nombre)}</td>
              <td>${escapeHtml(tier)}</td>
              <td>${f.operaciones}</td>
              <td>${f.vendidas}</td>
              <td>${dashSilver(f.inversion)}</td>
              <td class="${f.profit >= 0 ? 'pos' : 'neg'}">${dashSilver(f.profit)}</td>
              <td class="${f.roi >= 0 ? 'pos' : 'neg'}">${dashPct(f.roi)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderPanelTop(body, d) {
  const top = CaerleonDash.topOperations(d.ops, DASH_HELPERS, 5);
  if (!top.length) return sinDatos(body, 'Sin ventas en este período.');

  body.innerHTML = `
    <div class="performer-list">
      ${top.map((t, i) => `
        <div class="performer-item">
          <div class="performer-rank">${i + 1}</div>
          <img class="performer-icon" src="${imgUrl(t.op.icon || tierItemId(getBaseItemId(t.op.tipo), t.op.tier))}" alt="">
          <div class="performer-info">
            <div class="performer-name">${escapeHtml(opDisplayName(t.op))} T${t.op.tier}${t.op.royalSlot ? '' : '.' + t.op.enchFin}</div>
            <div class="performer-meta">${t.op.qty}× · ${escapeHtml(t.op.fecha || '')}</div>
          </div>
          <div class="performer-value ${t.profit >= 0 ? 'positive' : 'negative'}">${t.profit >= 0 ? '+' : ''}${dashSilver(t.profit)}</div>
        </div>`).join('')}
    </div>`;
}

function getBaseItemId(tipo) {
  const t = TIPOS_OBJETO.find(x => x.nombre === tipo);
  return t ? t.baseId : 'RUNE';
}

// =====================================================
// UI - SETTINGS
// =====================================================

function initSettings() {
  document.getElementById('btnExport').addEventListener('click', exportarJSON);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
  document.getElementById('fileImport').addEventListener('change', importarJSON);
  document.getElementById('btnClear').addEventListener('click', borrarTodo);

  const btnRestore = document.getElementById('btnRestoreBackup');
  if (btnRestore) btnRestore.addEventListener('click', handleRestoreBackup);

  updateStorageInfo();
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
      if (!confirm(`¿Importar ${data.registro.length} operaciones? Esto REEMPLAZARÁ tus datos actuales, también en la nube.`)) return;
      state.precios = data.precios;
      if (data.sellos) state.sellos = data.sellos;
      state.registro = normalizeForCloud(data.registro.map(op => migrateOpVenta(op)));
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
  if (!confirm('⚠️ ¿BORRAR TODO? Se borran tus operaciones y precios también de la nube. Esta acción no se puede deshacer.')) return;
  if (!confirm('¿Seguro? Tus operaciones y precios se perderán.')) return;
  state = {
    precios: structuredClone(DEFAULT_PRECIOS),
    sellos: structuredClone(DEFAULT_SELLOS),
    registro: [],
    theme: state.theme,
    premium: state.premium,
    dashboard: state.dashboard || null,
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
  // Show app version
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = APP_VERSION;
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
  // Login + carga de datos desde Supabase antes de pintar nada
  await CloudSync.boot();

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

  // Sincronización en tiempo real con los demás dispositivos
  CloudSync.start();
});

// Expose delete function globally for onclick
window.deleteRegistro = deleteRegistro;

// Puente con cloud-ui.js
window.CaerleonApp = {
  getState: () => state,
  setState: (next) => { state = next; },
  loadLocalState: loadState,
  saveLocal: saveState,
  refreshAllViews,
  normalize: normalizeForCloud,
  showToast,
  defaults: () => ({
    precios: structuredClone(DEFAULT_PRECIOS),
    sellos: structuredClone(DEFAULT_SELLOS),
  }),
};
