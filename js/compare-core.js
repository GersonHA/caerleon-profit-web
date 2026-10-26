/* =====================================================
   Caerleon Profit - compare-core.js
   Ganancia por material/sello y comparador de piezas reales.

   No calcula la operación: recibe el resultado de calcRoyal / calcOperacion
   (app.js) y saca de ahí los números "por unidad". Así la Calculadora, Sellos
   Reales y el comparador usan exactamente la misma cuenta.

   No toca el DOM: se usa igual en el navegador (window.CaerleonCompare) y en
   los tests de Node (require).
   ===================================================== */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaerleonCompare = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const div = (a, b) => (b > 0 ? a / b : 0);

  /**
   * Sellos Reales, a partir de calcRoyal(inp) y sus entradas.
   *   gananciaPorSello  -> cuánto ganas por cada sello que gastas
   *   maxPrecioSello    -> lo máximo que puedes pagar por sello sin perder
   *   maxPrecioBase     -> lo máximo que puedes pagar por el item base sin perder
   */
  function porSello(r, inp) {
    const qty = Math.max(1, inp.qty || 1);
    return {
      gananciaPorSello: div(r.profit, r.totalSigils),
      maxPrecioSello: div(r.netRevenue - r.baseCost - r.craftCost, r.totalSigils),
      maxPrecioBase: (r.netRevenue - r.sigilCost - r.craftCost) / qty,
    };
  }

  /**
   * Calculadora (runas/almas/reliquias), a partir de calcOperacion(op).
   *   gananciaPorMaterial -> ganancia por cada runa, alma o reliquia usada
   *   maxPrecioBase       -> lo máximo que puedes pagar por el item base sin perder
   */
  function porMaterial(r, op) {
    const qty = Math.max(1, parseInt(op.qty) || 1);
    return {
      gananciaPorMaterial: div(r.profit, r.matQtyTotal),
      maxPrecioBase: (r.revNeto - r.matCostoTotal) / qty,
    };
  }

  /**
   * Comparador: una fila por pieza, cada una con su calcRoyal (1 unidad).
   * piezas: [{ slot, nombre, inp, r }]
   * Las piezas sin precio de venta o sin precio de item base quedan fuera del
   * ranking (no se puede saber si conviene).
   */
  function comparar(piezas) {
    const filas = piezas.map(p => {
      const completa = p.inp.sellPrice > 0 && p.inp.basePrice > 0;
      return {
        slot: p.slot,
        nombre: p.nombre,
        completa,
        sellos: p.r.totalSigils,
        costoBase: p.r.baseCost,
        costoSellos: p.r.sigilCost,
        inversion: p.r.totalCost,
        ingresoNeto: p.r.netRevenue,
        ganancia: p.r.profit,
        roi: p.r.roi / 100,
        ...porSello(p.r, p.inp),
      };
    });

    const listas = filas.filter(f => f.completa);
    const mejorPor = campo => {
      if (listas.length === 0) return null;
      const top = listas.reduce((a, b) => (b[campo] > a[campo] ? b : a));
      return top[campo] > 0 ? top.slot : null;
    };

    return {
      filas,
      mejor: {
        ganancia: mejorPor('ganancia'),
        gananciaPorSello: mejorPor('gananciaPorSello'),
        roi: mejorPor('roi'),
      },
      completas: listas.length,
    };
  }

  return { porSello, porMaterial, comparar };
});
