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

const DEFAULT_PRECIOS = {
  4: { runa: 10,   alma: 66,    relic: 405    },
  5: { runa: 500,  alma: 2500,  relic: 10000  },
  6: { runa: 2500, alma: 12000, relic: 50000  },
  7: { runa: 10000,alma: 50000, relic: 200000 },
  8: { runa: 40000,alma: 200000,relic: 800000 },
};

const STORAGE_KEY = 'caerleon_profit_data_v1';

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
      return {
        precios: parsed.precios || structuredClone(DEFAULT_PRECIOS),
        registro: parsed.registro || [],
        theme: parsed.theme || 'light',
        premium: parsed.premium !== undefined ? parsed.premium : true,
      };
    }
  } catch (e) {
    console.error('Error cargando state:', e);
  }
  return {
    precios: structuredClone(DEFAULT_PRECIOS),
    registro: [],
    theme: 'light',
    premium: true,
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      precios: state.precios,
      registro: state.registro,
      theme: state.theme,
      premium: state.premium,
    }));
  } catch (e) {
    console.error('Error guardando state:', e);
    showToast('Error guardando datos', 'error');
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
  return Math.round(n).toLocaleString('en-US');
};
const fmtSilver2 = n => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    fecha: new Date().toISOString().slice(0, 10),
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

  document.getElementById('btnGuardarPrecios').addEventListener('click', () => {
    document.querySelectorAll('#preciosBody input').forEach(inp => {
      const tier = parseInt(inp.dataset.tier);
      const mat = inp.dataset.mat;
      const val = Math.max(0, parseFloat(inp.value) || 0);
      if (!state.precios[tier]) state.precios[tier] = { runa: 0, alma: 0, relic: 0 };
      state.precios[tier][mat] = val;
    });
    saveState();
    showToast('✅ Precios guardados', 'success');
    updateCalculadora();
  });
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
  if (filterEstado) items = items.filter(r => r.estado === filterEstado);

  // Newest first
  items.sort((a,b) => (b.fecha || '').localeCompare(a.fecha || ''));

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
    return `
      <tr>
        <td>${r.fecha || '—'}</td>
        <td><img class="mat-icon-sm" src="${imgUrl(getItemId(r.tipo, r.tier))}" alt=""> ${r.tipo}</td>
        <td>T${r.tier}</td>
        <td>.${r.enchIni}→.${r.enchFin}</td>
        <td>${r.qty}</td>
        <td>${fmtSilver(r.pCompra)}</td>
        <td>${fmtSilver(r.pVenta)}</td>
        <td>${fmtSilver(r.inversion)}</td>
        <td>${fmtSilver(r.revNeto)}</td>
        <td style="color: ${r.profit > 0 ? 'var(--success)' : r.profit < 0 ? 'var(--danger)' : 'inherit'}; font-weight:600;">${fmtSilver(r.profit)}</td>
        <td>${fmtPct(r.roi)}</td>
        <td class="estado-cell">${r.estado}</td>
        <td>${r.notas || ''}</td>
        <td><button class="delete-btn" onclick="deleteRegistro(${realIdx})">🗑️</button></td>
      </tr>
    `;
  }).join('');
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
    { id: 'kpi-profit-total', label: 'Profit total', raw: totalProfit, fmt: 'money', cls: totalProfit > 0 ? 'success' : 'danger' },
    { id: 'kpi-profit-avg',   label: 'Profit promedio', raw: avgProfit, fmt: 'money', cls: avgProfit > 0 ? 'success' : 'danger' },
    { id: 'kpi-ops',          label: 'Operaciones', raw: totalOps, fmt: 'int', cls: 'info' },
    { id: 'kpi-exito',        label: '% Éxito', raw: pctExito, fmt: 'pct', cls: pctExito >= 0.5 ? 'success' : 'danger' },
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
  if (fmt === 'money') return Math.round(v).toLocaleString('en-US');
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

  // Dashboard period/goal controls
  populateMonthSelect();
  setupDashboardControls();
  updateStorageInfo();
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
  document.getElementById('storageInfo').innerHTML =
    `<strong>Datos guardados:</strong> ${state.registro.length} operaciones, ${size} KB usados del localStorage.`;
}

function exportarJSON() {
  const data = {
    version: 1,
    exportDate: new Date().toISOString(),
    precios: state.precios,
    registro: state.registro,
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
      state.registro = data.registro;
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

document.addEventListener('DOMContentLoaded', () => {
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
  initCalculadora();
  initPrecios();
  initRegistro();
  initDashboard();
  initSettings();
});

// Expose delete function globally for onclick
window.deleteRegistro = deleteRegistro;
