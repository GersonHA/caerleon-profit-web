# ⚔️ Caerleon Profit Calculator

Calculadora de profits para el **Black Market de Caerleon** (Albion Online). Te ayuda a decidir si vale la pena comprar un item base, encantar con materiales, y vender en el Black Market.

**Features:**
- 🧮 Calculadora con todas las fórmulas (materiales, profit, ROI, break-even, costo de oportunidad)
- 🖼️ **Iconos reales** de los items (arma, cabeza, pecho, etc.) y materiales (runa, alma, reliquia)
- 💰 Editor de precios de runas, almas y reliquias por tier
- 📜 Registro histórico con iconos, filtros y búsqueda
- 📊 Dashboard con KPIs y gráficos (Chart.js)
- 💾 Persistencia local en localStorage (no necesita servidor)
- 📤 Exportar/Importar JSON para backup o sync entre dispositivos
- 🌓 Tema claro/oscuro
- 📱 Responsive (mobile-first)

---

## 🚀 Cómo publicar en GitHub Pages

### 1. Crea un repo en GitHub

Ve a https://github.com/new y crea un repo (ej: `caerleon-profit`).

### 2. Sube los archivos

Tienes 3 archivos: `index.html`, `styles.css`, `app.js`. Más este README.

**Opción A — Web interface:**
1. Click en "uploading an existing file"
2. Arrastra los 4 archivos
3. Commit

**Opción B — Git CLI:**
```bash
cd caerleon-profit
git init
git add index.html styles.css app.js README.md
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/caerleon-profit.git
git push -u origin main
```

### 3. Activa GitHub Pages

1. Repo → Settings → Pages
2. Source: "Deploy from a branch"
3. Branch: `main` / `(root)`
4. Save

En 1-2 minutos tu sitio estará en:
```
https://TU-USUARIO.github.io/caerleon-profit/
```

¡Listo! Ábrelo desde cualquier dispositivo.

---

## 📱 Usar desde el celular

1. Abre el URL en Safari/Chrome del celular
2. (Opcional) iOS: Compartir → "Añadir a pantalla de inicio" para usarlo como app

---

## 🔄 Sincronizar entre dispositivos

Como cada navegador tiene su propio localStorage, para pasar tus datos:

**PC → Celular:**
1. En la PC, ve a "Configuración" → "Exportar JSON"
2. Te descarga un archivo `caerleon-profit-YYYY-MM-DD.json`
3. Envíatelo por WhatsApp/email/cloud al celular
4. En el celular, abre la web → "Configuración" → "Importar JSON"

**Automático (alternativa avanzada):**
- Crea un GitHub Gist privado
- Usa una herramienta como [gistpad](https://gistpad.app/) para sync automático
- (Requiere token de GitHub)

---

## 🎮 Cómo usar

### Calculadora
1. **Configuración** — Premium ON = 4% tax, OFF = 8% tax
2. **Datos** — Tipo, tier, encantamientos, calidad, cantidad, precios
3. **Materiales** — Se calcula automáticamente lo que necesitas
4. **Resultados** — Profit, ROI, break-even, todo en vivo
5. **Guardar** — Click en "💾 Guardar operación en Registro"

### Precios
Edita los precios a los que TÚ compraste cada material. Se usan en todas las operaciones.

### Registro
Ve todas tus operaciones pasadas. Filtra por tipo, estado, o busca texto.

### Dashboard
KPIs y gráficos para analizar tu performance en el tiempo.

---

## 📐 Reglas del juego (verificadas)

- **Tax Black Market**: 4% (Premium) / 8% (sin Premium)
- **Materiales por paso**: 2H=384, 1H=288, Pecho/Bolsa=192, Cabeza/Pies/Capa/Secundaria=96
- **Regla de encantamiento**: .0→.1 runas, .1→.2 almas, .2→.3 reliquias
- **Max encantamiento via upgrade**: .3 (para .4 necesitas crafting)
- **Item Power**: T4.0 = 700 IP, +100 por tier, +100 por encantamiento

---

## 🛠️ Tech

- HTML5 + CSS3 + Vanilla JS (sin frameworks)
- [Chart.js](https://www.chartjs.org/) v4.4.0 (incluido local, sin CDN)
- localStorage para persistencia
- 100% client-side, sin servidor

---

## 📝 Licencia

MIT — úsalo, modifícalo, comparte. Hecho para la comunidad de Albion Online.
