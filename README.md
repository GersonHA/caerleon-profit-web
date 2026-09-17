# ⚔️ Caerleon Profit Calculator — versión con login y nube

La misma calculadora de siempre (mismas pantallas, cálculos y animaciones), con:

- 🔐 **Login**: solo entras tú.
- ☁️ **Datos en Supabase** en lugar de GitHub Gist: se guardan solos.
- ⚡ **Tiempo real**: lo que haces en el PC aparece en el celular al instante.
- 💾 Copia local en el navegador, como antes.

La página sigue alojada en **GitHub Pages** (gratis). Supabase solo guarda los
datos y controla el login.

```
Navegador (GitHub Pages) ──login + datos──> Supabase (Postgres + Auth + Realtime)
```

---

## Puesta en marcha (una sola vez)

### 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) → **Start your project** → inicia sesión con GitHub.
2. **New project**: nombre (ej. `caerleon-profit`), una contraseña de base de datos (guárdala), región cercana, plan **Free**.
3. Espera a que termine de crearse.

### 2. Crear las tablas

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Pega **todo** el contenido de [`supabase/migrations/20260916000000_schema.sql`](supabase/migrations/20260916000000_schema.sql).
3. **Run**. Debe terminar sin errores.
4. Repite con [`supabase/migrations/20260917000000_dashboard.sql`](supabase/migrations/20260917000000_dashboard.sql), que añade dónde se guarda tu panel del Dashboard.

### 3. Crear tu usuario y cerrar el registro

1. **Authentication → Users → Add user → Create new user**: tu email y una contraseña. Marca **Auto Confirm User**.
2. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**.

> ⚠️ Desactiva solo **"Allow new users to sign up"** (el registro general).
> **No** apagues el proveedor **Email**: eso también bloquea el login.
> Se verificó en las pruebas.

### 4. Conectar la página

1. **Project Settings → API**: copia la **Project URL** y la clave **anon** (o **publishable**).
2. Pégalas en [`config.js`](config.js), en `CAERLEON_PROD`.

Esas dos claves son públicas por diseño. **Nunca** pongas la `service_role` / `secret`.

### 5. Publicar en GitHub Pages

Sube estos archivos al repositorio de GitHub Pages:

```
index.html  app.js  styles.css  config.js  chart.umd.min.js
js/  vendor/  img/
```

(`tests/`, `supabase/` y `package.json` no hacen falta para que funcione.)

### 6. Pasar tus datos

Tienes dos formas:

- **Automática**: si abres la nueva versión en el mismo navegador y la misma
  dirección donde usabas la anterior, al iniciar sesión te pregunta
  *"Encontré N operaciones guardadas en este navegador… ¿Subirlas a tu cuenta?"*.
- **Con el JSON exportado**: **Configuración → Opciones avanzadas → Importar JSON**
  y eliges tu archivo (ej. `caerleon-profit-2026-09-16.json`).

Al importar, cada operación recibe un identificador nuevo (el viejo se conserva
como `legacyId`) y las operaciones de Sellos Reales que no tenían estado se
clasifican.

> ℹ️ En el plan gratuito, Supabase pausa los proyectos que pasan un tiempo sin
> actividad (hoy, una semana). Si pasa, se reactiva desde el panel de Supabase.

---

## Qué cambió respecto a la versión anterior

| | Antes | Ahora |
|---|---|---|
| Datos | `localStorage` + GitHub Gist (token personal) | Supabase, por usuario |
| Sincronización | cada 5 min, con límites de GitHub | tiempo real |
| Acceso | cualquiera con la URL veía una app vacía | login obligatorio |
| Operaciones de la Calculadora | se guardaban **sin id** → no se les podían agregar ventas | UUID siempre |
| Operaciones de Sellos Reales | quedaban **sin estado** | se clasifican |
| "Nuevo intento de venta" | los campos **Comprador** y **Estado** no se veían (CSS) → toda venta quedaba *Vendido / Mercado Negro* | visibles |
| "Borrar todo" | perdía la preferencia Premium | la conserva |
| Orden del Registro | agrupado por estado y por hora de la última venta (las ventas migradas tenían todas "12:00") | de la última operación registrada a la primera |
| Filtro de tipo | no tenía "Sellos Reales" | lo tiene |
| Operaciones Reales en Registro / Top | ícono de runa y nombre "Sellos Reales T5.0" | ícono y nombre de la pieza: "Casco Real (Tela)" |
| Notas de ventas | se insertaban como HTML | se muestran como texto |
| Calculadora / Sellos Reales | línea de depuración visible (`state.premium=… taxRate=…`) | quitada |
| Tarjetas de ganancia | siempre verdes, incluso con pérdida | rojas si hay pérdida |
| Resultado de Sellos Reales | etiqueta y valor uno debajo del otro; impuesto "−0" | en una fila; "0" |
| Leyenda del gráfico de estados | punto de color + emoji repetido | solo el punto |
| Celular: Precios | los números se cortaban ("18" en vez de 186) | completos |
| Celular: Registro | tabla ancha, filas muy altas | tarjetas compactas |
| Ícono de la pestaña | no tenía (error 404) | ⚔️ |
| **Dashboard (v7)** | | |
| "En inventario" | solo contaba ventas marcadas como pendientes: una pieza crafteada sin vender salía como 0 | cuenta crafteadas y en venta, con su costo y lo que queda por cobrar |
| Meta | el selector diaria/semanal/mensual se ignoraba, el progreso se topaba en 150% y usaba profit proyectado | usa su propio período, muestra el porcentaje real, lo que falta, el ritmo por día y la proyección |
| Meta y período | se reiniciaban al recargar | se guardan en tu cuenta |
| Paneles | fijos | eliges indicadores y paneles y los ordenas; se guarda en tu cuenta |
| Profit por día | sumaba el profit proyectado de cada operación | suma la ganancia realmente cobrada |
| Paneles nuevos | — | Inventario, Rentabilidad por item y tier, Acumulado del período |
| Gráfico de estados | "Sin histórico" usaba el mismo morado que "Bulk Win" | gris, con orden fijo y porcentajes |

Operaciones nuevas: nacen como **⚪ Crafteado** hasta que les registras un
intento de venta. (En la versión anterior, al recargar la página se les creaba
sola una venta *"Vendido"* con el precio de venta; eso ahora solo pasa al
importar datos viejos que no tienen ventas.)

**El motor de cálculo no cambió**: un test compara, carácter por carácter, cada
función de cálculo contra el `app.js` original.

---

## Estructura

```
index.html          pantallas de login/carga + la app
app.js              la app original, con el guardado apuntando a la nube
styles.css          estilos originales + login y estado de la nube (al final)
config.js           URL y clave pública de Supabase
js/cloud-core.js    traducción app <-> tablas, guardado por diferencias, tiempo real
js/cloud-ui.js      login, carga inicial, guardado automático, avisos
js/dashboard-core.js períodos, KPIs, meta, inventario y series del Dashboard
vendor/             supabase-js 2.116.0 (local, sin CDN)
supabase/           esquema SQL y configuración del Supabase local
tests/              pruebas (ver abajo)
```

### Base de datos

| Tabla | Contenido |
|---|---|
| `profiles` | Premium, tema y tu panel del Dashboard |
| `material_prices` | runa / alma / reliquia por tier |
| `sigil_prices` | Sello Real por tier |
| `operations` | el registro |
| `sales` | intentos de venta de cada operación |

Todas con **RLS**: la base de datos solo entrega y acepta filas del usuario que
inició sesión. Los importes son `numeric` para que vuelvan con exactamente los
mismos dígitos que envió el navegador.

---

## Pruebas (QA)

Requieren **Docker Desktop** y **Node.js**. Corren contra un Supabase **local**,
nunca contra tu proyecto real.

> Las pruebas viven en la carpeta de trabajo `caerleon-profit-supabase/`
> (no se publican en GitHub Pages). La versión anterior usada como referencia
> está copiada en `tests/original/` (commit `f5d5091`).

```bash
npm install
npx supabase start        # Supabase local en Docker (la primera vez descarga imágenes)
npm test                  # todo: unitarias + integración + navegador
```

| Suite | Qué verifica |
|---|---|
| `test:unit` (37) | el motor de cálculo es idéntico al original; solo cambió lo previsto; tus operaciones ida y vuelta sin perder nada; cálculo de diferencias; y los números del Dashboard (períodos, KPIs, meta, inventario) con tus datos reales |
| `test:integration` (14) | registro cerrado; login; alta con precios por defecto; subir/editar/borrar exacto; >1000 filas; **un usuario no ve ni toca datos de otro**; sin sesión no se ve nada; tiempo real entre dispositivos |
| `test:e2e` (21) | en Edge: login, importar tu JSON, calculadora, sellos, ventas, precios, tema, recarga, borrar, cerrar sesión, **PC ↔ celular en vivo**, subida de datos de la versión anterior, cada arreglo de interfaz, y el Dashboard (inventario, meta, períodos y panel editable que viaja entre dispositivos) |

Probar la página a mano con el Supabase local:

```bash
npm run serve             # http://127.0.0.1:5500/?dev=1
```

Con `?dev=1` la página usa el Supabase local (usuarios de prueba creados en
`http://127.0.0.1:54323`, el panel local). `?dev=0` vuelve a la configuración real.
