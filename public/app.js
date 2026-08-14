// =============================================================================
// Sushibox · Sistema de Costos — Frontend SPA v2.0
// Archivo: app.js
// API apunta a: /.netlify/functions/api (proxy que llama al GAS Web App)
// =============================================================================

'use strict';

// ── CONFIGURACION ─────────────────────────────────────────────────────────────
const API = '/.netlify/functions/api';

// IPC mensual argentino (variacion % mes a mes) — datos de referencia 2023-2024
const IPC_DATA = {
  labels: ['Ene 23','Feb 23','Mar 23','Abr 23','May 23','Jun 23',
           'Jul 23','Ago 23','Sep 23','Oct 23','Nov 23','Dic 23',
           'Ene 24','Feb 24','Mar 24','Abr 24','May 24','Jun 24'],
  values: [6.0, 6.6, 7.7, 8.4, 7.8, 6.0, 6.3, 12.4, 12.7, 8.3, 12.8, 25.5,
           20.6, 13.2, 11.0, 8.8, 4.2, 4.6]
};

// ── ESTADO DE LA APLICACION ───────────────────────────────────────────────────
let currentRole  = null;
let chartCosts   = null;
let chartIPC     = null;
let priceItems   = [];   // filas en la tabla de actualizar precios
let insumosData  = [];   // cache de getInsumos
let productsData = [];   // cache de getProducts

// ── BOOTSTRAP ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
  const saved = sessionStorage.getItem('sb_role');
  if (saved) {
    applyRole(saved);
  }
  // Bind drag-and-drop
  const dz = document.getElementById('drop-zone');
  if (dz) {
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
    dz.addEventListener('drop',      e  => { e.preventDefault(); dz.classList.remove('drag-over'); handleFileDrop(e); });
    dz.addEventListener('click',     ()  => document.getElementById('file-input').click());
  }
  const fi = document.getElementById('file-input');
  if (fi) fi.addEventListener('change', handleFileSelect);
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function login(role) {
  sessionStorage.setItem('sb_role', role);
  applyRole(role);
}

function logout() {
  sessionStorage.removeItem('sb_role');
  currentRole = null;
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  // Destruir charts para evitar canvas reuse error
  if (chartCosts) { chartCosts.destroy(); chartCosts = null; }
  if (chartIPC)   { chartIPC.destroy();   chartIPC   = null; }
  priceItems   = [];
  insumosData  = [];
  productsData = [];
}

function applyRole(role) {
  currentRole = role;
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  const label = role === 'admin' ? 'Administrador' : 'Operativo';
  document.getElementById('user-label').textContent = label;

  // Mostrar/ocultar elementos de admin
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = (role === 'admin') ? '' : 'none';
  });

  // Navegar al panel inicial
  const firstPanel = (role === 'admin') ? 'admin' : 'operativo';
  navigate(firstPanel);
}

// ── NAVEGACION ─────────────────────────────────────────────────────────────────
function navigate(panel) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById('panel-' + panel);
  const navBtn = document.querySelector(`.nav-item[data-panel="${panel}"]`);
  if (target) target.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  // Cargar datos al entrar en el panel
  if (panel === 'admin')      initAdmin();
  if (panel === 'operativo')  initOperativo();
  if (panel === 'dashboard')  initDashboard();
}

// ── API WRAPPER ────────────────────────────────────────────────────────────────
async function apiCall(method, params) {
  try {
    let url     = API;
    let options = {};

    if (method === 'GET') {
      const qs = new URLSearchParams(params).toString();
      url = API + (qs ? '?' + qs : '');
      options = { method: 'GET' };
    } else {
      options = {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params)
      };
    }

    const res  = await fetch(url, options);
    const json = await res.json();

    if (!res.ok || json.success === false) {
      throw new Error(json.error || 'Error desconocido del servidor');
    }
    return json.data;

  } catch (err) {
    throw err;
  }
}

// ── PANEL ADMIN: PRECIOS ───────────────────────────────────────────────────────
async function initAdmin() {
  if (insumosData.length > 0) {
    renderInsumosTable(insumosData);
    return;
  }
  const wrap    = document.getElementById('insumos-table-wrap');
  const loading = document.getElementById('insumos-loading');
  loading.classList.remove('hidden');
  wrap.classList.add('hidden');
  try {
    const data = await apiCall('GET', { action: 'getInsumos' });
    insumosData = data || [];
    renderInsumosTable(insumosData);
  } catch (err) {
    loading.innerHTML = `<span style="color:var(--orange)">Error al cargar insumos: ${esc(err.message)}</span>`;
  }
}

function renderInsumosTable(rows) {
  const loading = document.getElementById('insumos-loading');
  const wrap    = document.getElementById('insumos-table-wrap');
  const tbody   = document.getElementById('insumos-table-body');
  loading.classList.add('hidden');
  wrap.classList.remove('hidden');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-muted);text-align:center">Sin insumos en el sistema</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const dias  = daysSince(r.fechaUpdate);
    const badge = dias === null ? 'badge-blue' : (dias > 30 ? 'badge-red' : (dias > 14 ? 'badge-orange' : 'badge-green'));
    const label = dias === null ? 'Sin fecha'  : (dias > 30 ? 'Desactualizado' : (dias > 14 ? 'Actualizar pronto' : 'Vigente'));
    return `<tr>
      <td>${esc(r.nombre || r.nombreLista)}</td>
      <td>${esc(r.idProveedor)}</td>
      <td>${fmtARS(r.costoNeto)}</td>
      <td>${fmtARS(r.costoConIVA)}</td>
      <td style="font-weight:600">${fmtARS(r.costoReal)}</td>
      <td>${esc(r.fechaUpdate)}</td>
      <td><span class="badge ${badge}">${label}</span></td>
    </tr>`;
  }).join('');
}

// ── FILE UPLOAD (simulacion OCR) ───────────────────────────────────────────────
function handleFileDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  const status = document.getElementById('upload-status');
  status.innerHTML = `
    <p><span class="spinner"></span> Procesando: <strong>${esc(file.name)}</strong> (${(file.size/1024).toFixed(1)} KB)</p>
    <p style="color:var(--text-muted);margin-top:.4rem;font-size:.8rem">Simulando extraccion de precios...</p>`;

  // Simular latencia de OCR/parsing
  setTimeout(() => {
    const simulated = generateSimulatedPrices(file.name);
    status.innerHTML = `<div class="alert alert-success">Deteccion completada — ${simulated.length} precios encontrados en <strong>${esc(file.name)}</strong></div>`;
    renderPriceTable(simulated);
    document.getElementById('price-edit-section').classList.remove('hidden');
  }, 1800);
}

function generateSimulatedPrices(filename) {
  // Genera precios simulados basados en nombres reales del sistema
  const base = insumosData.length > 0
    ? insumosData.slice(0, 6).map(r => ({
        nombreLista:     r.nombreLista,
        precioAnterior:  r.costoNeto,
        precioNuevo:     +(r.costoNeto * (1 + (Math.random() * 0.3 - 0.05))).toFixed(2)
      }))
    : [
        { nombreLista: 'Salmon x kg',     precioAnterior: 4500, precioNuevo: 5200 },
        { nombreLista: 'Arroz sushi x kg', precioAnterior: 850,  precioNuevo: 920  },
        { nombreLista: 'Alga nori x 10',   precioAnterior: 1200, precioNuevo: 1350 },
        { nombreLista: 'Palta x kg',       precioAnterior: 2100, precioNuevo: 1980 },
        { nombreLista: 'Queso crema x kg', precioAnterior: 1800, precioNuevo: 1900 },
      ];
  return base;
}

function renderPriceTable(items) {
  priceItems = items.map((it, i) => ({ ...it, idx: i }));
  const tbody = document.getElementById('price-table-body');
  tbody.innerHTML = priceItems.map(it => {
    const varPct = it.precioAnterior > 0
      ? (((it.precioNuevo - it.precioAnterior) / it.precioAnterior) * 100).toFixed(1)
      : null;
    const varClass = varPct === null ? '' : (parseFloat(varPct) > 0 ? 'var-pos' : 'var-neg');
    const varLabel = varPct === null ? '—' : (parseFloat(varPct) > 0 ? '+' : '') + varPct + '%';
    return `<tr>
      <td>${esc(it.nombreLista)}</td>
      <td>${fmtARS(it.precioAnterior)}</td>
      <td>
        <input type="number" step="0.01" min="0" value="${it.precioNuevo}"
          onchange="updatePriceRow(${it.idx}, this.value)">
      </td>
      <td class="${varClass}" id="var-cell-${it.idx}">${varLabel}</td>
      <td>
        <button class="btn-ghost" style="font-size:.72rem;padding:.25rem .5rem"
          onclick="removePriceRow(${it.idx})">Quitar</button>
      </td>
    </tr>`;
  }).join('');
}

function updatePriceRow(idx, newVal) {
  const it      = priceItems.find(p => p.idx === idx);
  if (!it) return;
  it.precioNuevo = parseFloat(newVal) || it.precioNuevo;
  const varPct   = it.precioAnterior > 0
    ? (((it.precioNuevo - it.precioAnterior) / it.precioAnterior) * 100).toFixed(1)
    : null;
  const cell     = document.getElementById('var-cell-' + idx);
  if (cell) {
    cell.className = parseFloat(varPct) > 0 ? 'var-pos' : 'var-neg';
    cell.textContent = varPct === null ? '—' : (parseFloat(varPct) > 0 ? '+' : '') + varPct + '%';
  }
}

function removePriceRow(idx) {
  priceItems = priceItems.filter(p => p.idx !== idx);
  renderPriceTable(priceItems);
}

function loadManualMode() {
  const status = document.getElementById('upload-status');
  status.innerHTML = '<div class="alert alert-info">Modo manual: edita los precios directamente en la tabla y haz clic en Enviar.</div>';
  const manual = insumosData.length > 0
    ? insumosData.map(r => ({ nombreLista: r.nombreLista, precioAnterior: r.costoNeto, precioNuevo: r.costoNeto }))
    : [{ nombreLista: '', precioAnterior: 0, precioNuevo: 0 }];
  renderPriceTable(manual);
  document.getElementById('price-edit-section').classList.remove('hidden');
}

async function submitPrices() {
  const btn    = document.getElementById('btn-submit-prices');
  const alert  = document.getElementById('alert-prices');
  const valid  = priceItems.filter(p => p.nombreLista && p.precioNuevo > 0);

  if (!valid.length) {
    alert.innerHTML = '<div class="alert alert-error">No hay precios validos para enviar.</div>';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando...';
  alert.innerHTML = '';

  const payload = {
    action: 'updatePrices',
    items:  valid.map(p => ({ nombreLista: p.nombreLista, nuevoPrecioNeto: p.precioNuevo }))
  };

  try {
    const results = await apiCall('POST', payload);
    const ok      = results.filter(r => r.success).length;
    const fail    = results.length - ok;
    alert.innerHTML = `<div class="alert alert-success">
      Actualizacion completada: <strong>${ok} exitosos</strong>${fail ? `, ${fail} con errores` : ''}.
    </div>`;
    if (fail > 0) {
      const errList = results.filter(r => !r.success).map(r =>
        `<li>${esc(r.nombreLista || r.item?.nombreLista)}: ${esc(r.error)}</li>`
      ).join('');
      alert.innerHTML += `<div class="alert alert-error"><ul>${errList}</ul></div>`;
    }
    // Refrescar tabla de insumos
    insumosData = [];
    initAdmin();
  } catch (err) {
    alert.innerHTML = `<div class="alert alert-error">Error al enviar: ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Enviar Actualizacion al Servidor';
  }
}

function resetPriceForm() {
  priceItems = [];
  document.getElementById('price-edit-section').classList.add('hidden');
  document.getElementById('price-table-body').innerHTML = '';
  document.getElementById('alert-prices').innerHTML = '';
  document.getElementById('upload-status').innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">Sube un archivo para comenzar...</p>';
  document.getElementById('file-input').value = '';
}

// ── PANEL OPERATIVO: ORDEN DE COMPRA ──────────────────────────────────────────
async function initOperativo() {
  if (productsData.length > 0) {
    renderProductCards(productsData);
    return;
  }
  const grid    = document.getElementById('product-grid');
  const loading = document.getElementById('product-grid-loading');
  loading.classList.remove('hidden');
  grid.classList.add('hidden');

  try {
    const data = await apiCall('GET', { action: 'getProducts' });
    productsData = Array.isArray(data) ? data : [];
    renderProductCards(productsData);
  } catch (err) {
    loading.innerHTML = `<span style="color:var(--orange)">Error al cargar productos: ${esc(err.message)}</span>`;
  }
}

function renderProductCards(products) {
  const grid    = document.getElementById('product-grid');
  const loading = document.getElementById('product-grid-loading');
  const btn     = document.getElementById('btn-generate-po');
  loading.classList.add('hidden');
  grid.classList.remove('hidden');

  if (!products.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No se encontraron productos en el Recetario.</p>';
    return;
  }

  grid.innerHTML = products.map(prod => `
    <div class="product-card">
      <h4>${esc(prod)}</h4>
      <div class="qty-row">
        <label>Cantidad:</label>
        <input type="number" min="0" step="1" value="0"
          id="qty-${slugify(prod)}"
          data-product="${esc(prod)}"
          onchange="onQtyChange()">
      </div>
    </div>
  `).join('');

  btn.disabled = false;
}

function onQtyChange() {
  // Habilitar/deshabilitar boton segun si hay alguna cantidad > 0
  const anyQty = getProductPlan().some(p => p.quantity > 0);
  document.getElementById('btn-generate-po').disabled = !anyQty;
}

function getProductPlan() {
  return productsData.map(prod => {
    const input = document.getElementById('qty-' + slugify(prod));
    const qty   = input ? parseFloat(input.value) || 0 : 0;
    return { product: prod, quantity: qty };
  }).filter(p => p.quantity > 0);
}

function clearPlan() {
  productsData.forEach(prod => {
    const input = document.getElementById('qty-' + slugify(prod));
    if (input) input.value = 0;
  });
  document.getElementById('po-result-section').classList.add('hidden');
  document.getElementById('btn-generate-po').disabled = true;
}

async function generatePO() {
  const plan   = getProductPlan();
  const btn    = document.getElementById('btn-generate-po');
  const alertEl = document.getElementById('alert-po');
  const section = document.getElementById('po-result-section');

  if (!plan.length) {
    alert.innerHTML = '<div class="alert alert-error">Selecciona al menos un producto con cantidad mayor a 0.</div>';
    return;
  }

  btn.disabled    = true;
  btn.innerHTML   = '<span class="spinner"></span> Calculando...';
  alertEl.innerHTML = '';
  section.classList.remove('hidden');
  document.getElementById('po-providers-container').innerHTML =
    '<div class="loading-row"><span class="spinner"></span> Generando orden...</div>';

  try {
    const result = await apiCall('POST', { action: 'generatePO', plan });
    renderPOResult(result);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">Error al generar OC: ${esc(err.message)}</div>`;
    document.getElementById('po-providers-container').innerHTML = '';
  } finally {
    btn.disabled   = false;
    btn.innerHTML  = 'Generar Orden de Compra';
  }
}

function renderPOResult(result) {
  const container  = document.getElementById('po-providers-container');
  const totalEl    = document.getElementById('po-grand-total');
  const totalAmt   = document.getElementById('po-total-amount');
  const alertEl    = document.getElementById('alert-po');

  if (result.warnings && result.warnings.length) {
    alertEl.innerHTML = `<div class="alert alert-info">
      <strong>Advertencias:</strong><ul>${result.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
    </div>`;
  }

  if (!result.providers || !result.providers.length) {
    container.innerHTML = '<p style="color:var(--text-muted)">No se pudo generar la orden. Verificar recetas e insumos.</p>';
    return;
  }

  container.innerHTML = result.providers.map(prov => `
    <div class="po-provider-block">
      <div class="po-provider-header">
        <span>Proveedor: <strong>${esc(prov.nombre)}</strong></span>
        <span class="prov-subtotal">${fmtARS(prov.subtotal)}</span>
      </div>
      <div class="tbl-wrap" style="border-radius:0 0 var(--radius) var(--radius)">
        <table>
          <thead>
            <tr>
              <th>Insumo</th>
              <th>Cant. Teorica</th>
              <th>Merma %</th>
              <th>Cant. Real</th>
              <th>Unidad</th>
              <th>Costo Unit.</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${prov.items.map(it => `<tr>
              <td>${esc(it.nombre)}</td>
              <td style="text-align:right">${it.cantTeorica}</td>
              <td style="text-align:right">${it.merma}%</td>
              <td style="text-align:right;font-weight:600">${it.cantReal}</td>
              <td>${esc(it.unidad)}</td>
              <td style="text-align:right">${fmtARS(it.costoUnitReal)}</td>
              <td style="text-align:right;font-weight:600">${fmtARS(it.subtotal)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');

  totalEl.classList.remove('hidden');
  totalAmt.textContent = fmtARS(result.grandTotal);

  // Preparar zona de impresion
  preparePrint(result);
}

function preparePrint(result) {
  document.getElementById('print-meta').textContent =
    `Generado: ${new Date().toLocaleString('es-AR')} — Total: ${fmtARS(result.grandTotal)}`;

  document.getElementById('print-body').innerHTML = result.providers.map(prov => `
    <div style="margin-bottom:20px">
      <h3 style="border-bottom:1px solid #ccc;padding-bottom:4px">Proveedor: ${esc(prov.nombre)} — ${fmtARS(prov.subtotal)}</h3>
      <table border="1" cellpadding="4" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:11px">
        <thead style="background:#f0f0f0">
          <tr><th>Insumo</th><th>Cant.Teorica</th><th>Merma%</th><th>Cant.Real</th><th>Unidad</th><th>Costo Unit.</th><th>Subtotal</th></tr>
        </thead>
        <tbody>
          ${prov.items.map(it => `<tr>
            <td>${esc(it.nombre)}</td>
            <td align="right">${it.cantTeorica}</td>
            <td align="right">${it.merma}%</td>
            <td align="right"><strong>${it.cantReal}</strong></td>
            <td>${esc(it.unidad)}</td>
            <td align="right">${fmtARS(it.costoUnitReal)}</td>
            <td align="right"><strong>${fmtARS(it.subtotal)}</strong></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `).join('') + `<p style="text-align:right;font-size:14px;font-weight:bold;border-top:2px solid #000;padding-top:8px">
    TOTAL ESTIMADO: ${fmtARS(result.grandTotal)}
  </p>`;
}

function exportPO() {
  window.print();
}

// ── PANEL DASHBOARD ────────────────────────────────────────────────────────────
async function initDashboard() {
  const loading = document.getElementById('hist-loading');
  const wrap    = document.getElementById('hist-table-wrap');
  loading.classList.remove('hidden');
  wrap.classList.add('hidden');

  try {
    const hist    = await apiCall('GET', { action: 'getPriceHistory' });
    const insumos = insumosData.length > 0 ? insumosData : await apiCall('GET', { action: 'getInsumos' });
    if (!insumosData.length) insumosData = insumos || [];

    updateKPIs(hist, insumos);
    renderHistTable(hist);
    renderCostChart(hist);
    renderVariacionChart(hist);
  } catch (err) {
    loading.innerHTML = `<span style="color:var(--orange)">Error al cargar dashboard: ${esc(err.message)}</span>`;
  }
}

function updateKPIs(hist, insumos) {
  document.getElementById('kpi-insumos').textContent = (insumos || []).length;

  const fechas = (insumos || []).map(r => r.fechaUpdate).filter(Boolean);
  document.getElementById('kpi-last-update').textContent = fechas.length ? fechas.sort().reverse()[0] : '—';

  if (hist && hist.length) {
    const costos = hist.map(r => r.costoTotal).filter(v => v > 0);
    if (costos.length) {
      document.getElementById('kpi-lowest').textContent  = fmtARS(Math.min(...costos));
      document.getElementById('kpi-highest').textContent = fmtARS(Math.max(...costos));
    }
  }
}

function renderHistTable(rows) {
  const loading = document.getElementById('hist-loading');
  const wrap    = document.getElementById('hist-table-wrap');
  const tbody   = document.getElementById('hist-table-body');
  loading.classList.add('hidden');
  wrap.classList.remove('hidden');

  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);text-align:center">Sin historial de cotizaciones</td></tr>';
    return;
  }

  tbody.innerHTML = [...rows].reverse().map(r => {
    const margenNum = parseFloat(r.margen) || 0;
    const badge     = margenNum >= 40 ? 'badge-green' : (margenNum >= 20 ? 'badge-orange' : 'badge-red');
    return `<tr>
      <td>${esc(r.fecha)}</td>
      <td>${esc(r.producto)}</td>
      <td style="font-variant-numeric:tabular-nums">${fmtARS(r.costoTotal)}</td>
      <td style="font-variant-numeric:tabular-nums">${fmtARS(r.precioVenta)}</td>
      <td><span class="badge ${badge}">${margenNum.toFixed(1)}%</span></td>
      <td style="color:var(--text-muted);font-size:.8rem">${esc(r.notas)}</td>
    </tr>`;
  }).join('');
}

function renderCostChart(hist) {
  const ctx = document.getElementById('chart-costs').getContext('2d');
  if (chartCosts) chartCosts.destroy();

  // Agrupar por producto
  const byProduct = {};
  (hist || []).forEach(r => {
    if (!byProduct[r.producto]) byProduct[r.producto] = [];
    byProduct[r.producto].push({ fecha: r.fecha, costo: r.costoTotal });
  });

  // Tomar hasta 4 productos
  const products = Object.keys(byProduct).slice(0, 4);
  const colors   = ['#203D61','#6699CC','#FF5F00','#D1E0F0'];

  // Fechas unicas ordenadas
  const allFechas = [...new Set((hist || []).map(r => r.fecha))].sort();

  const datasets = products.map((prod, i) => ({
    label:           prod,
    data:            allFechas.map(f => {
      const pt = byProduct[prod].find(p => p.fecha === f);
      return pt ? pt.costo : null;
    }),
    borderColor:     colors[i],
    backgroundColor: colors[i] + '22',
    tension:         0.3,
    fill:            false,
    spanGaps:        true,
    pointRadius:     4,
    borderWidth:     2.5
  }));

  Chart.defaults.font.family = "'Source Sans 3', sans-serif";
  Chart.defaults.font.size   = 11;

  chartCosts = new Chart(ctx, {
    type: 'line',
    data: { labels: allFechas.length ? allFechas : IPC_DATA.labels.slice(-6), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#757575', font: { family: 'Poppins', size: 11, weight: '600' } } },
        tooltip: { backgroundColor: '#203D61', titleFont: { family: 'Poppins', weight: '600' }, padding: 10 }
      },
      scales: {
        x: { ticks: { color: '#757575', maxTicksLimit: 8 }, grid: { color: 'rgba(32,61,97,0.08)' } },
        y: { ticks: { color: '#757575', callback: v => '$' + v.toLocaleString('es-AR') }, grid: { color: 'rgba(32,61,97,0.08)' } }
      }
    }
  });
}

function renderVariacionChart(hist) {
  const ctx = document.getElementById('chart-ipc').getContext('2d');
  if (chartIPC) chartIPC.destroy();

  // Calcular variacion mensual del primer producto del historial
  let localLabels = IPC_DATA.labels;
  let costoVar    = IPC_DATA.values.map(() => null);

  if (hist && hist.length >= 2) {
    const productos = [...new Set(hist.map(r => r.producto))];
    const primer    = hist.filter(r => r.producto === productos[0]).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (primer.length >= 2) {
      const meses  = primer.map(r => r.fecha);
      const variacs = primer.slice(1).map((r, i) => {
        const prev = primer[i].costoTotal;
        return prev > 0 ? +((( r.costoTotal - prev) / prev) * 100).toFixed(1) : null;
      });
      localLabels = meses.slice(1);
      costoVar    = variacs;
    }
  }

  // Alinear IPC a los mismos meses si es posible
  const ipcVar = localLabels.map((_, i) => IPC_DATA.values[i] !== undefined ? IPC_DATA.values[i] : null);

  chartIPC = new Chart(ctx, {
    type: 'line',
    data: {
      labels: localLabels,
      datasets: [
        {
          label:           'Variacion Costos (%)',
          data:            costoVar,
          borderColor:     '#FF5F00',
          backgroundColor: 'rgba(255,95,0,0.08)',
          tension:         0.3,
          fill:            true,
          spanGaps:        true,
          pointRadius:     4,
          borderWidth:     2.5
        },
        {
          label:           'IPC Argentina (%)',
          data:            ipcVar,
          borderColor:     '#CECECE',
          backgroundColor: 'transparent',
          borderDash:      [5, 3],
          tension:         0.3,
          spanGaps:        true,
          pointRadius:     3,
          borderWidth:     1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#757575', font: { family: 'Poppins', size: 11, weight: '600' } } },
        tooltip: { backgroundColor: '#203D61', titleFont: { family: 'Poppins', weight: '600' }, padding: 10 }
      },
      scales: {
        x: { ticks: { color: '#757575', maxTicksLimit: 8 }, grid: { color: 'rgba(32,61,97,0.08)' } },
        y: {
          ticks: { color: '#757575', callback: v => v + '%' },
          grid:  { color: 'rgba(32,61,97,0.08)' }
        }
      }
    }
  });
}

// ── UTILIDADES ────────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtARS(val) {
  const n = parseFloat(val) || 0;
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function daysSince(dateStr) {
  if (!dateStr || dateStr === '—') return null;
  const parts = String(dateStr).split('/');
  if (parts.length < 3) return null;
  const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
