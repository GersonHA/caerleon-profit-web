/* =====================================================
   Caerleon Profit - cloud-core.js
   Traducción entre el estado de la app y las tablas de Supabase,
   y sincronización por diferencias.

   No toca el DOM: se usa igual en el navegador (window.CaerleonCloud)
   y en los tests de Node (require).
   ===================================================== */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaerleonCloud = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // =====================================================
  // IDs
  // =====================================================

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isUuid(v) {
    return typeof v === 'string' && UUID_RE.test(v);
  }

  function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    // Respaldo para contextos donde randomUUID no existe (p. ej. file://)
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // =====================================================
  // Mapeo de campos: clave en la app  ->  columna en Supabase
  // =====================================================

  const OP_FIELDS = [
    ['fecha', 'fecha'],
    ['tipo', 'tipo'],
    ['tier', 'tier'],
    ['enchIni', 'ench_ini'],
    ['enchFin', 'ench_fin'],
    ['calidad', 'calidad'],
    ['qty', 'qty'],
    ['pCompra', 'p_compra'],
    ['pVenta', 'p_venta'],
    ['pDir', 'p_dir'],
    ['matUnit', 'mat_unit'],
    ['inversion', 'inversion'],
    ['revNeto', 'rev_neto'],
    ['profit', 'profit'],
    ['roi', 'roi'],
    ['profitUnit', 'profit_unit'],
    ['estado', 'estado'],
    ['notas', 'notas'],
    ['icon', 'icon'],
    ['royalSlot', 'royal_slot'],
    ['royalMaterial', 'royal_material'],
    ['sigilPrice', 'sigil_price'],
    ['sigilCount', 'sigil_count'],
    ['craftFee', 'craft_fee'],
    ['sigilCost', 'sigil_cost'],
    ['legacyId', 'legacy_id'],
  ];

  const VENTA_FIELDS = [
    ['fecha', 'fecha'],
    ['hora', 'hora'],
    ['precio', 'precio'],
    ['comprador', 'comprador'],
    ['estado', 'estado'],
    ['notas', 'notas'],
    ['legacyId', 'legacy_id'],
  ];

  const OP_KEYS = new Set(['id', 'ventas', ...OP_FIELDS.map((f) => f[0])]);
  const VENTA_KEYS = new Set(['id', ...VENTA_FIELDS.map((f) => f[0])]);

  const TIERS = [4, 5, 6, 7, 8];
  const SIGIL_TIERS = [4, 5, 6];
  const MATS = ['runa', 'alma', 'relic'];

  /** JSON no admite NaN/Infinity; Postgres tampoco los recibiría bien. */
  function clean(v) {
    if (v === undefined) return null;
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    return v;
  }

  /** Campos que la app tiene pero no tienen columna: se guardan en `extra`. */
  function extraOf(obj, knownKeys) {
    const extra = {};
    let any = false;
    for (const k of Object.keys(obj)) {
      if (!knownKeys.has(k) && obj[k] !== undefined) {
        extra[k] = obj[k];
        any = true;
      }
    }
    return any ? extra : null;
  }

  function opToRow(op, userId, orden) {
    const row = { id: op.id, user_id: userId, orden };
    for (const [key, col] of OP_FIELDS) row[col] = clean(op[key]);
    row.extra = extraOf(op, OP_KEYS);
    return row;
  }

  function ventaToRow(v, opId, userId, orden) {
    const row = { id: v.id, operation_id: opId, user_id: userId, orden };
    for (const [key, col] of VENTA_FIELDS) row[col] = clean(v[key]);
    row.extra = extraOf(v, VENTA_KEYS);
    return row;
  }

  /**
   * Fila -> objeto de la app. Las columnas en null se omiten para que el
   * objeto quede con la misma forma que tenía antes de guardarse.
   */
  function rowToOp(row, ventaRows) {
    const op = { id: row.id };
    for (const [key, col] of OP_FIELDS) {
      if (row[col] !== null && row[col] !== undefined) op[key] = row[col];
    }
    if (row.extra) Object.assign(op, row.extra);
    op.ventas = (ventaRows || [])
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map(rowToVenta);
    return op;
  }

  function rowToVenta(row) {
    const v = { id: row.id };
    for (const [key, col] of VENTA_FIELDS) {
      if (row[col] !== null && row[col] !== undefined) v[key] = row[col];
    }
    if (row.extra) Object.assign(v, row.extra);
    return v;
  }

  // =====================================================
  // Normalización del formato viejo
  // =====================================================

  /**
   * Deja el registro listo para guardarse en la nube:
   *  - toda operación y toda venta con UUID (las de la Calculadora no tenían
   *    `id`, y las Reales/ventas usaban ids tipo "r_1789..." / "v_1789...").
   *    El id viejo se conserva en `legacyId`.
   *  - `ventas` siempre como array.
   *  - operaciones sin `estado` se clasifican con `classify` (la función
   *    calcEstado de la app), contra el historial anterior a cada una.
   *
   * No modifica el array recibido.
   */
  function normalizeRegistro(registro, { classify, today } = {}) {
    const report = { opIds: 0, ventaIds: 0, estados: 0, fechas: 0 };
    const historial = [];

    const out = (registro || []).map((original) => {
      const op = { ...original };

      if (!isUuid(op.id)) {
        if (op.id !== undefined && op.id !== null && op.id !== '') op.legacyId = String(op.id);
        op.id = newId();
        report.opIds++;
      }

      if (!op.fecha) {
        op.fecha = today || new Date().toISOString().slice(0, 10);
        report.fechas++;
      }

      op.ventas = (Array.isArray(op.ventas) ? op.ventas : []).map((vOriginal) => {
        const v = { ...vOriginal };
        if (!isUuid(v.id)) {
          if (v.id !== undefined && v.id !== null && v.id !== '') v.legacyId = String(v.id);
          v.id = newId();
          report.ventaIds++;
        }
        if (!v.fecha) v.fecha = op.fecha;
        return v;
      });

      if ((op.estado === undefined || op.estado === null || op.estado === '') && classify) {
        op.estado = classify(op.profit, op.roi, op.profitUnit, historial.slice()).label;
        report.estados++;
      }

      historial.push(op);
      return op;
    });

    return { registro: out, report };
  }

  // =====================================================
  // Snapshot y diferencias
  // =====================================================

  /**
   * Foto serializada de todo lo que se guarda en la nube.
   * Cada tabla es un Map clave -> JSON de la fila completa, así comparar dos
   * fotos es comparar strings.
   */
  function snapshot(appState, userId, ordenOf, opts = {}) {
    const ops = new Map();
    const sales = new Map();

    (appState.registro || []).forEach((op) => {
      ops.set(op.id, JSON.stringify(opToRow(op, userId, ordenOf(op.id))));
      (op.ventas || []).forEach((v, i) => {
        sales.set(v.id, JSON.stringify(ventaToRow(v, op.id, userId, i)));
      });
    });

    const prices = new Map();
    for (const tier of TIERS) {
      const p = (appState.precios || {})[tier] || {};
      const row = { user_id: userId, tier };
      for (const m of MATS) row[m] = Number(p[m]) || 0;
      prices.set(String(tier), JSON.stringify(row));
    }

    const sigils = new Map();
    for (const tier of SIGIL_TIERS) {
      const price = Number((appState.sellos || {})[tier]) || 0;
      sigils.set(String(tier), JSON.stringify({ user_id: userId, tier, price }));
    }

    const profile = new Map([
      ['me', JSON.stringify({
        user_id: userId,
        premium: appState.premium !== false,
        theme: appState.theme === 'dark' ? 'dark' : 'light',
        ...(opts.withDashboard === false ? {} : { dashboard: appState.dashboard ?? null }),
      })],
    ]);

    return { ops, sales, prices, sigils, profile };
  }

  function diffMap(prev, next) {
    const upserts = [];
    const deletes = [];
    for (const [key, json] of next) {
      if (prev.get(key) !== json) upserts.push(JSON.parse(json));
    }
    for (const key of prev.keys()) {
      if (!next.has(key)) deletes.push(key);
    }
    return { upserts, deletes };
  }

  function diffSnapshots(prev, next) {
    return {
      ops: diffMap(prev.ops, next.ops),
      sales: diffMap(prev.sales, next.sales),
      prices: diffMap(prev.prices, next.prices),
      sigils: diffMap(prev.sigils, next.sigils),
      profile: diffMap(prev.profile, next.profile),
    };
  }

  function isEmptyDiff(d) {
    return Object.values(d).every((t) => t.upserts.length === 0 && t.deletes.length === 0);
  }

  function snapshotsEqual(a, b) {
    return isEmptyDiff(diffSnapshots(a, b));
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // =====================================================
  // CloudStore: carga, guardado por diferencias y tiempo real
  // =====================================================

  const PAGE = 1000; // límite por defecto de filas por consulta en Supabase

  class CloudStore {
    /**
     * @param client  cliente de supabase-js ya autenticado
     * @param userId  id del usuario (auth.users.id)
     */
    constructor(client, userId) {
      this.client = client;
      this.userId = userId;
      this.orden = new Map();      // id de operación -> orden de inserción
      this.nextOrden = 1;
      this.baseline = null;        // lo que sabemos que está en la nube
      // ¿La tabla profiles tiene la columna del panel? (migración de v7)
      // Si falta, la app funciona igual pero el panel no se sincroniza.
      this.soportaDashboard = true;
      this.queue = Promise.resolve(); // guardados encadenados
      this.channel = null;
    }

    ordenOf(id) {
      if (!this.orden.has(id)) this.orden.set(id, this.nextOrden++);
      return this.orden.get(id);
    }

    get ready() {
      return this.baseline !== null;
    }

    async fetchAll(table, orderCol) {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        let q = this.client.from(table).select('*').eq('user_id', this.userId);
        if (orderCol) q = q.order(orderCol, { ascending: true });
        const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...data);
        if (data.length < PAGE) return rows;
      }
    }

    async fetchKeyed(table) {
      const { data, error } = await this.client.from(table).select('*').eq('user_id', this.userId);
      if (error) throw new Error(`${table}: ${error.message}`);
      return data;
    }

    /**
     * Trae todo de la nube y lo devuelve con la forma del state de la app.
     * No cambia la línea base: eso lo decide quien llama (acceptRemote).
     */
    async loadAll() {
      const [opRows, saleRows, priceRows, sigilRows, profileRows] = await Promise.all([
        this.fetchAll('operations', 'orden'),
        this.fetchAll('sales', 'orden'),
        this.fetchKeyed('material_prices'),
        this.fetchKeyed('sigil_prices'),
        this.fetchKeyed('profiles'),
      ]);

      const salesByOp = new Map();
      for (const s of saleRows) {
        if (!salesByOp.has(s.operation_id)) salesByOp.set(s.operation_id, []);
        salesByOp.get(s.operation_id).push(s);
      }

      const ordenes = new Map(opRows.map((r) => [r.id, r.orden]));
      const registro = opRows.map((r) => rowToOp(r, salesByOp.get(r.id)));

      const precios = {};
      for (const r of priceRows) precios[r.tier] = { runa: r.runa, alma: r.alma, relic: r.relic };

      const sellos = {};
      for (const r of sigilRows) sellos[r.tier] = r.price;

      const profile = profileRows[0] || null;
      if (profile) this.soportaDashboard = Object.prototype.hasOwnProperty.call(profile, 'dashboard');

      return {
        registro,
        precios,
        sellos,
        premium: profile ? profile.premium : undefined,
        theme: profile ? profile.theme : undefined,
        dashboard: profile ? (profile.dashboard ?? null) : null,
        hasProfile: !!profile,
        ordenes,
      };
    }

    /**
     * Foto de lo que REALMENTE hay en la nube. Lo que falta allá (un perfil
     * que no existe, un tier sin precio) queda fuera de la foto, para que el
     * próximo guardado lo cree.
     */
    remoteSnapshot(remote, ordenes) {
      const ord = new Map(ordenes || remote.ordenes);
      const s = snapshot(remote, this.userId, (id) => ord.get(id), { withDashboard: this.soportaDashboard });
      for (const key of [...s.prices.keys()]) {
        if (!(key in remote.precios)) s.prices.delete(key);
      }
      for (const key of [...s.sigils.keys()]) {
        if (!(key in remote.sellos)) s.sigils.delete(key);
      }
      if (!remote.hasProfile) s.profile.clear();
      return s;
    }

    /** Adopta lo que vino de la nube como la verdad conocida. */
    acceptRemote(remote) {
      this.orden = new Map(remote.ordenes);
      this.nextOrden = Math.floor(Math.max(0, ...this.orden.values())) + 1;
      this.baseline = this.remoteSnapshot(remote);
    }

    currentSnapshot(appState) {
      return snapshot(appState, this.userId, (id) => this.ordenOf(id), { withDashboard: this.soportaDashboard });
    }

    hasPending(appState) {
      if (!this.ready) return false;
      return !snapshotsEqual(this.baseline, this.currentSnapshot(appState));
    }

    /** ¿Lo que llegó de la nube es igual a lo que ya teníamos? */
    matchesBaseline(remote) {
      if (!this.ready) return false;
      return snapshotsEqual(this.baseline, this.remoteSnapshot(remote));
    }

    /**
     * Guarda en la nube SOLO lo que cambió desde la última vez.
     * Los guardados se encadenan: nunca corren dos a la vez.
     * Devuelve un resumen de lo enviado.
     */
    push(appState) {
      const run = async () => {
        if (!this.ready) throw new Error('No hay datos de la nube cargados todavía');
        const next = this.currentSnapshot(appState);
        const d = diffSnapshots(this.baseline, next);
        if (isEmptyDiff(d)) return { changed: false };

        const db = this.client;
        const check = ({ error }, what) => {
          if (error) throw new Error(`${what}: ${error.message}`);
        };

        if (d.profile.upserts.length) {
          check(await db.from('profiles').upsert(d.profile.upserts), 'perfil');
        }
        if (d.prices.upserts.length) {
          check(await db.from('material_prices').upsert(d.prices.upserts), 'precios');
        }
        if (d.sigils.upserts.length) {
          check(await db.from('sigil_prices').upsert(d.sigils.upserts), 'sellos');
        }
        for (const rows of chunk(d.ops.upserts, 500)) {
          check(await db.from('operations').upsert(rows), 'operaciones');
        }
        for (const rows of chunk(d.sales.upserts, 500)) {
          check(await db.from('sales').upsert(rows), 'ventas');
        }
        for (const ids of chunk(d.sales.deletes, 100)) {
          check(await db.from('sales').delete().in('id', ids), 'borrar ventas');
        }
        for (const ids of chunk(d.ops.deletes, 100)) {
          check(await db.from('operations').delete().in('id', ids), 'borrar operaciones');
        }
        for (const id of d.ops.deletes) this.orden.delete(id);

        this.baseline = next;
        return {
          changed: true,
          ops: d.ops.upserts.length,
          opsDeleted: d.ops.deletes.length,
          sales: d.sales.upserts.length,
          salesDeleted: d.sales.deletes.length,
          prices: d.prices.upserts.length + d.sigils.upserts.length,
          profile: d.profile.upserts.length,
        };
      };

      // Cola: cada guardado espera al anterior, aunque el anterior haya fallado.
      const task = this.queue.catch(() => {}).then(run);
      this.queue = task;
      return task;
    }

    /**
     * Avisa (con `onChange`) cuando algo cambia en la nube, por ejemplo desde
     * otro dispositivo. `onStatus` recibe el estado de la conexión:
     * los de supabase-js (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED) y
     * READY, cuando el servidor ya está escuchando la base de datos.
     *
     * Ojo: Supabase limita los avisos por segundo. Tras un cambio masivo
     * (importar miles de filas) algunos avisos se pierden, por eso quien use
     * esto debe ponerse al día en READY y de vez en cuando.
     */
    subscribe(onChange, onStatus) {
      this.unsubscribe();
      let timer = null;
      const fire = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, 400);
      };
      let ch = this.client.channel(`caerleon-${this.userId}`);
      ch = ch.on('system', {}, (msg) => {
        if (msg && msg.extension === 'postgres_changes' && msg.status === 'ok' && onStatus) {
          onStatus('READY');
        }
      });
      for (const table of ['operations', 'sales', 'material_prices', 'sigil_prices', 'profiles']) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
      }
      this.channel = ch.subscribe((status) => {
        if (onStatus) onStatus(status);
      });
      return this.channel;
    }

    unsubscribe() {
      if (this.channel) {
        this.client.removeChannel(this.channel);
        this.channel = null;
      }
    }
  }

  return {
    isUuid,
    newId,
    opToRow,
    ventaToRow,
    rowToOp,
    rowToVenta,
    normalizeRegistro,
    snapshot,
    diffSnapshots,
    isEmptyDiff,
    snapshotsEqual,
    CloudStore,
    OP_FIELDS,
    VENTA_FIELDS,
  };
});
