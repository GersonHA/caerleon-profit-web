/* =====================================================
   Caerleon Profit - dashboard-core.js
   Los números del dashboard: períodos, KPIs, meta, inventario y series.

   No toca el DOM ni Chart.js: se usa igual en el navegador
   (window.CaerleonDash) y en los tests de Node (require).

   Cómo lee las operaciones:
     - `status(op)`   -> 'crafteado' | 'pendiente' | 'vendido' | 'fallido'
     - `realized(op)` -> ganancia YA cobrada (0 si todavía no se vendió)
   Ambas se inyectan desde app.js para no duplicar reglas.
   ===================================================== */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaerleonDash = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIA_MS = 24 * 60 * 60 * 1000;

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
    'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  /** 'YYYY-MM-DD' en hora local (no UTC: evita que el día se corra). */
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function endOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  function addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  /** Lunes de la semana de `d` (en España la semana empieza el lunes). */
  function startOfWeek(d) {
    const day = (d.getDay() + 6) % 7;
    return addDays(startOfDay(d), -day);
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / DIA_MS) + 1;
  }

  // =====================================================
  // Períodos
  // =====================================================

  /**
   * Rango del período elegido en el dashboard.
   *
   * @param period 'today' | 'week' | 'month' | 'custom' | 'all'
   * @param opts   { now, month:{year,month}, customFrom, customTo, fechas }
   */
  function periodRange(period, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();
    const hoy = startOfDay(now);

    switch (period) {
      case 'today':
        return { from: hoy, to: endOfDay(now), label: 'Hoy' };

      case 'week': {
        const from = addDays(hoy, -6);
        return { from, to: endOfDay(now), label: 'Últimos 7 días' };
      }

      case 'month': {
        const m = opts.month || { year: now.getFullYear(), month: now.getMonth() };
        const from = new Date(m.year, m.month, 1);
        const esActual = m.year === now.getFullYear() && m.month === now.getMonth();
        const to = esActual ? endOfDay(now) : endOfDay(new Date(m.year, m.month + 1, 0));
        return { from, to, label: `${MESES[m.month]} ${m.year}` };
      }

      case 'custom': {
        const from = opts.customFrom ? startOfDay(new Date(opts.customFrom + 'T00:00:00')) : hoy;
        const to = opts.customTo ? endOfDay(new Date(opts.customTo + 'T00:00:00')) : endOfDay(now);
        return { from, to, label: 'Personalizado' };
      }

      case 'all': {
        const fechas = (opts.fechas || []).filter(Boolean).sort();
        const from = fechas.length ? startOfDay(new Date(fechas[0] + 'T00:00:00')) : hoy;
        return { from, to: endOfDay(now), label: 'Todo' };
      }

      default:
        return { from: hoy, to: endOfDay(now), label: 'Hoy' };
    }
  }

  /** Mismo número de días, justo antes del rango dado. */
  function previousRange(range) {
    const dias = daysBetween(range.from, range.to);
    const to = endOfDay(addDays(range.from, -1));
    const from = startOfDay(addDays(to, -(dias - 1)));
    return { from, to, label: 'Período anterior', dias };
  }

  /** Rango propio de la meta: el día, la semana o el mes en curso. */
  function goalRange(goalPeriod, now = new Date()) {
    const hoy = startOfDay(now);
    if (goalPeriod === 'day') {
      return { from: hoy, to: endOfDay(now), label: 'hoy', dias: 1 };
    }
    if (goalPeriod === 'week') {
      const from = startOfWeek(now);
      return { from, to: endOfDay(addDays(from, 6)), label: 'esta semana', dias: 7 };
    }
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const ultimo = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from, to: endOfDay(ultimo), label: 'este mes', dias: ultimo.getDate() };
  }

  function inRange(fecha, range) {
    if (!fecha) return false;
    return fecha >= dateKey(range.from) && fecha <= dateKey(range.to);
  }

  function filterByRange(ops, range) {
    return (ops || []).filter((op) => inRange(op.fecha, range));
  }

  // =====================================================
  // Resumen del período
  // =====================================================

  function sum(list, fn) {
    return list.reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);
  }

  /**
   * Ganancia que todavía NO está cobrada: lo que esperas sacar si vendes al
   * precio que anotaste, menos lo que te costó.
   */
  function potentialProfit(op, taxRate) {
    const bruto = (Number(op.pVenta) || 0) * Math.max(1, Number(op.qty) || 1);
    return bruto * (1 - taxRate) - (Number(op.inversion) || 0);
  }

  /**
   * Todos los números de un período.
   *
   * Definiciones (las mismas que muestra la interfaz):
   *   realizado  = ganancia de las operaciones con venta cerrada
   *   inventario = operaciones crafteadas o con venta pendiente (aún tuyas)
   *   perdidas   = inversión de las operaciones cuyos intentos fallaron
   */
  function summarize(ops, { status, realized, taxRate = 0.04 }) {
    const lista = ops || [];
    const porEstado = { crafteado: [], pendiente: [], vendido: [], fallido: [] };
    lista.forEach((op) => {
      const e = status(op);
      (porEstado[e] || (porEstado[e] = [])).push(op);
    });

    const vendidas = porEstado.vendido;
    const enInventario = [...porEstado.crafteado, ...porEstado.pendiente];
    const fallidas = porEstado.fallido;

    const realizado = sum(vendidas, realized);
    const inversionVendidas = sum(vendidas, (o) => o.inversion);
    const conGanancia = vendidas.filter((o) => realized(o) > 0);

    return {
      total: lista.length,
      porEstado,

      realizado,
      operacionesVendidas: vendidas.length,
      roiRealizado: inversionVendidas > 0 ? realizado / inversionVendidas : 0,
      profitPorOperacion: vendidas.length ? realizado / vendidas.length : 0,
      tasaExito: vendidas.length ? conGanancia.length / vendidas.length : 0,

      inventarioCantidad: enInventario.length,
      inventarioCosto: sum(enInventario, (o) => o.inversion),
      inventarioPotencial: sum(enInventario, (o) => potentialProfit(o, taxRate)),
      inventarioUnidades: sum(enInventario, (o) => Math.max(1, Number(o.qty) || 1)),

      perdidas: sum(fallidas, (o) => o.inversion),
      operacionesFallidas: fallidas.length,

      inversionTotal: sum(lista, (o) => o.inversion),
      mejor: vendidas.length ? Math.max(...vendidas.map(realized)) : 0,
      peor: vendidas.length ? Math.min(...vendidas.map(realized)) : 0,
    };
  }

  /** Variación porcentual contra el período anterior (null si no hay con qué comparar). */
  function delta(actual, anterior) {
    if (!anterior) return null;
    return (actual - anterior) / Math.abs(anterior);
  }

  // =====================================================
  // Meta
  // =====================================================

  /**
   * Progreso de la meta en SU PROPIO período (día, semana o mes en curso),
   * sin importar qué período se esté viendo en el dashboard.
   *
   * `pct` NO se topa: si llevas el triple de la meta, dice 3.
   */
  function goalProgress(ops, { goal, goalPeriod, status, realized, now = new Date() }) {
    const range = goalRange(goalPeriod, now);
    const delPeriodo = filterByRange(ops, range).filter((op) => status(op) === 'vendido');
    const logrado = sum(delPeriodo, realized);

    const diasTotales = range.dias;
    const transcurridos = Math.min(diasTotales, daysBetween(range.from, now));
    const restantes = Math.max(0, diasTotales - transcurridos);
    const falta = Math.max(0, goal - logrado);

    return {
      range,
      logrado,
      goal,
      pct: goal > 0 ? logrado / goal : 0,
      falta,
      cumplida: goal > 0 && logrado >= goal,
      diasTotales,
      diasTranscurridos: transcurridos,
      diasRestantes: restantes,
      // Cuánto tendrías que hacer por día para llegar, contando el día de hoy
      ritmoNecesario: falta > 0 ? falta / (restantes + 1) : 0,
      // A este ritmo, cómo terminaría el período
      proyeccion: transcurridos > 0 ? (logrado / transcurridos) * diasTotales : 0,
      operaciones: delPeriodo.length,
    };
  }

  // =====================================================
  // Formato de números
  // =====================================================

  const UNIDADES = [
    { limite: 1e9, sufijo: ' B' },
    { limite: 1e6, sufijo: ' M' },
    { limite: 1e3, sufijo: ' k' },
  ];

  /**
   * Silver en formato corto: 12.852.615 -> "13 M" (entero) o "12,9 M" (1 decimal).
   *
   * @param modo 'entero' | 'compacto' | 'completo'
   */
  function formatSilver(n, modo = 'entero') {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';

    if (modo === 'completo') return Math.round(v).toLocaleString('es-ES');

    const abs = Math.abs(v);
    const decimales = modo === 'compacto' ? 1 : 0;

    for (let i = 0; i < UNIDADES.length; i++) {
      const { limite, sufijo } = UNIDADES[i];
      if (abs < limite) continue;

      let texto = (v / limite).toFixed(decimales);
      // 999.999 redondearía a "1000 k": mejor decir "1 M"
      if (Math.abs(parseFloat(texto)) >= 1000 && i > 0) {
        const mayor = UNIDADES[i - 1];
        return (v / mayor.limite).toFixed(decimales).replace('.', ',') + mayor.sufijo;
      }
      return texto.replace('.', ',') + sufijo;
    }

    return Math.round(v).toLocaleString('es-ES');
  }

  /** Porcentaje sin decimales, salvo valores pequeños donde harían falta. */
  function formatPercent(fraccion, modo = 'entero') {
    if (fraccion === null || fraccion === undefined || Number.isNaN(Number(fraccion))) return '—';
    const pct = Number(fraccion) * 100;
    if (modo === 'completo') return pct.toFixed(2).replace('.', ',') + '%';
    const decimales = Math.abs(pct) < 10 && pct !== 0 ? 1 : 0;
    return pct.toFixed(decimales).replace('.', ',') + '%';
  }

  // =====================================================
  // Series para los gráficos
  // =====================================================

  /** Ganancia realizada por día, con la misma cantidad de días que el período anterior. */
  function dailySeries(ops, range, prev, { status, realized }) {
    const dias = daysBetween(range.from, range.to);
    const porDia = new Map();
    (ops || []).forEach((op) => {
      if (status(op) !== 'vendido') return;
      porDia.set(op.fecha, (porDia.get(op.fecha) || 0) + realized(op));
    });

    const labels = [];
    const actual = [];
    const anterior = [];
    for (let i = 0; i < dias; i++) {
      const d = addDays(range.from, i);
      const p = addDays(prev.from, i);
      labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
      actual.push(porDia.get(dateKey(d)) || 0);
      anterior.push(porDia.get(dateKey(p)) || 0);
    }
    return { labels, actual, anterior, dias };
  }

  /** Lo que paga el Mercado Negro por una operación ya vendida (sin descontar impuesto). */
  function grossRevenue(op) {
    const qty = Math.max(1, Number(op.qty) || 1);
    return (op.ventas || [])
      .filter((v) => v.estado === 'vendido')
      .reduce((s, v) => s + (Number(v.precio) || 0) * qty, 0);
  }

  /**
   * Tres líneas por día: lo que invertiste, lo que pagó el Mercado Negro y lo
   * que te quedó. La diferencia entre venta y ganancia es tu costo más el
   * impuesto del Mercado Negro.
   */
  function flowSeries(ops, range, { status, realized }) {
    const dias = daysBetween(range.from, range.to);
    const porDia = new Map();

    (ops || []).forEach((op) => {
      if (status(op) !== 'vendido') return;
      const d = porDia.get(op.fecha) || { inversion: 0, venta: 0, ganancia: 0 };
      d.inversion += Number(op.inversion) || 0;
      d.venta += grossRevenue(op);
      d.ganancia += realized(op);
      porDia.set(op.fecha, d);
    });

    const labels = [];
    const inversion = [];
    const venta = [];
    const ganancia = [];
    for (let i = 0; i < dias; i++) {
      const d = addDays(range.from, i);
      const v = porDia.get(dateKey(d)) || { inversion: 0, venta: 0, ganancia: 0 };
      labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
      inversion.push(v.inversion);
      venta.push(v.venta);
      ganancia.push(v.ganancia);
    }
    return { labels, inversion, venta, ganancia, dias };
  }

  /**
   * Ganancia por hora del día, usando la hora de cada venta.
   *
   * Ojo: las ventas que vinieron de la importación quedaron todas a las 12:00,
   * así que `migradas` cuenta cuántas son para poder avisarlo.
   */
  function hourSeries(ops, { realized }) {
    const horas = Array.from({ length: 24 }, () => ({ profit: 0, ventas: 0 }));
    let migradas = 0;
    let conHora = 0;

    (ops || []).forEach((op) => {
      const vendidas = (op.ventas || []).filter((v) => v.estado === 'vendido');
      if (!vendidas.length) return;
      // La ganancia de la operación se reparte entre sus ventas cerradas
      const porVenta = realized(op) / vendidas.length;
      vendidas.forEach((v) => {
        const h = Math.min(23, Math.max(0, parseInt(String(v.hora || '').slice(0, 2), 10) || 0));
        horas[h].profit += porVenta;
        horas[h].ventas++;
        conHora++;
        if ((v.notas || '').startsWith('Migrado')) migradas++;
      });
    });

    return {
      labels: horas.map((_, h) => `${String(h).padStart(2, '0')}:00`),
      profit: horas.map((h) => h.profit),
      ventas: horas.map((h) => h.ventas),
      migradas,
      total: conHora,
    };
  }

  /** Acumulado del período, día a día. */
  function cumulativeSeries(daily) {
    let acc = 0;
    return daily.actual.map((v) => (acc += v));
  }

  /**
   * Agrupa por una dimensión (tier, tipo, ...) y devuelve las filas ordenadas
   * por ganancia. Sirve tanto para gráficos como para la tabla de rentabilidad.
   */
  function groupBy(ops, keyOf, { status, realized }) {
    const grupos = new Map();
    (ops || []).forEach((op) => {
      const key = String(keyOf(op));
      if (!grupos.has(key)) {
        grupos.set(key, { key, operaciones: 0, vendidas: 0, profit: 0, inversion: 0, unidades: 0 });
      }
      const g = grupos.get(key);
      g.operaciones++;
      g.unidades += Math.max(1, Number(op.qty) || 1);
      g.inversion += Number(op.inversion) || 0;
      if (status(op) === 'vendido') {
        g.vendidas++;
        g.profit += realized(op);
      }
    });

    return [...grupos.values()]
      .map((g) => ({ ...g, roi: g.inversion > 0 ? g.profit / g.inversion : 0 }))
      .sort((a, b) => b.profit - a.profit);
  }

  /** Lo que tienes sin vender, de lo más antiguo a lo más nuevo. */
  function inventory(ops, { status, taxRate = 0.04, now = new Date() }) {
    return (ops || [])
      .filter((op) => status(op) === 'crafteado' || status(op) === 'pendiente')
      .map((op) => ({
        op,
        estado: status(op),
        costo: Number(op.inversion) || 0,
        potencial: potentialProfit(op, taxRate),
        dias: op.fecha ? Math.max(0, daysBetween(new Date(op.fecha + 'T00:00:00'), now) - 1) : 0,
      }))
      .sort((a, b) => b.dias - a.dias || b.costo - a.costo);
  }

  /** Las mejores operaciones cerradas del período. */
  function topOperations(ops, { status, realized }, limite = 5) {
    return (ops || [])
      .filter((op) => status(op) === 'vendido')
      .map((op) => ({ op, profit: realized(op) }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, limite);
  }

  return {
    DIA_MS,
    MESES,
    dateKey,
    startOfDay,
    endOfDay,
    startOfWeek,
    addDays,
    daysBetween,
    periodRange,
    previousRange,
    goalRange,
    inRange,
    filterByRange,
    potentialProfit,
    summarize,
    delta,
    goalProgress,
    dailySeries,
    flowSeries,
    hourSeries,
    grossRevenue,
    formatSilver,
    formatPercent,
    cumulativeSeries,
    groupBy,
    inventory,
    topOperations,
  };
});
