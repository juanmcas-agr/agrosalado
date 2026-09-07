// Pantalla de carga manual: para los productos sin fuente automática
// (MAP/UREA/Glifosato hoy), muestra el último valor conocido precargado y
// hace cuántos días pasaron desde la última carga HUMANA real (no cuenta
// el arrastre automático de cierre-diario-precios-relativos.js) — así se
// ve de un vistazo qué está desactualizado, sin bloquear nada.
import { supabase } from './supabaseClient.js';
import { PRODUCTOS } from './config.js';

function el(id) {
  return document.getElementById(id);
}

const PRODUCTOS_MANUALES = PRODUCTOS.filter((p) => p.origen === 'manual');
const DIAS_AVISO = 10;

function formatearFecha(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function diasDesde(iso) {
  if (!iso) return null;
  const hoy = new Date();
  const fecha = new Date(`${iso}T00:00:00`);
  return Math.floor((hoy - fecha) / (1000 * 60 * 60 * 24));
}

async function obtenerInfoProducto(productoId) {
  const [{ data: ultimo }, { data: ultimoManual }] = await Promise.all([
    supabase.from('precios_relativos_historial')
      .select('fecha, valor_nativo')
      .eq('producto_id', productoId)
      .order('fecha', { ascending: false })
      .limit(1),
    supabase.from('precios_relativos_historial')
      .select('fecha')
      .eq('producto_id', productoId)
      .eq('origen_dato', 'manual')
      .order('fecha', { ascending: false })
      .limit(1),
  ]);
  return {
    ultimoValor: ultimo && ultimo[0] ? ultimo[0] : null,
    ultimaFechaManual: ultimoManual && ultimoManual[0] ? ultimoManual[0].fecha : null,
  };
}

function fechaHoy() {
  return new Date().toISOString().slice(0, 10);
}

// Lista de fechas ISO entre desde y hasta, ambas incluidas.
function rangoDeFechas(desde, hasta) {
  const fechas = [];
  const cursor = new Date(`${desde}T00:00:00`);
  const fin = new Date(`${hasta}T00:00:00`);
  while (cursor <= fin) {
    fechas.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return fechas;
}

// Guarda el mismo valor para una fecha, o para todo un rango de fechas si
// se pasa "hasta" — cada día del rango queda como una fila propia con
// origen_dato='manual', para que cuente como "confirmado a mano" ese día
// puntual (no como un arrastre automático) y no dispare el aviso de
// estancamiento aunque el precio no haya cambiado.
async function guardarValor(producto, valor, fechaDesde, fechaHasta, msjEl) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { msjEl.textContent = 'No hay sesión activa.'; msjEl.className = 'carga-item-mensaje error'; return false; }

  const fechas = fechaHasta && fechaHasta > fechaDesde ? rangoDeFechas(fechaDesde, fechaHasta) : [fechaDesde];
  const filas = fechas.map((fecha) => ({
    producto_id: producto.id, fecha, valor_nativo: valor, origen_dato: 'manual', usuario_id: session.user.id,
  }));

  const { error } = await supabase.from('precios_relativos_historial').upsert(filas, { onConflict: 'producto_id,fecha' });
  if (error) {
    msjEl.textContent = 'No se pudo guardar: ' + error.message;
    msjEl.className = 'carga-item-mensaje error';
    return false;
  }
  msjEl.textContent = fechas.length > 1 ? `✅ Guardado para ${fechas.length} días.` : '✅ Guardado.';
  msjEl.className = 'carga-item-mensaje ok';
  return true;
}

function renderFilaProducto(producto, info) {
  const dias = diasDesde(info.ultimaFechaManual);
  const enAviso = dias == null || dias >= DIAS_AVISO;
  const textoAviso = info.ultimaFechaManual
    ? `Confirmado a mano por última vez el ${formatearFecha(info.ultimaFechaManual)} (hace ${dias} día${dias === 1 ? '' : 's'}).`
    : 'Todavía no se confirmó a mano ningún valor.';

  const div = document.createElement('div');
  div.className = `carga-item${enAviso ? ' carga-item-aviso' : ''}`;
  div.innerHTML = `
    <div class="carga-item-header">
      <strong>${producto.nombre}</strong> <span class="carga-unidad">(${producto.unidad})</span>
    </div>
    <div class="carga-item-aviso-texto">${enAviso ? '⚠️ ' : ''}${textoAviso}</div>
    <div class="carga-item-form">
      <input type="number" step="0.01" class="carga-input" value="${info.ultimoValor ? info.ultimoValor.valor_nativo : ''}" placeholder="Valor">
      <input type="date" class="carga-fecha" value="${fechaHoy()}" title="Desde">
      <input type="date" class="carga-fecha-hasta" title="Repetir hasta (opcional)">
      <button type="button" class="carga-guardar-btn">Guardar</button>
    </div>
    <div class="carga-item-ayuda">Si el precio rige para varios días, completá "hasta" y se carga repetido en todo ese rango.</div>
    <div class="carga-item-mensaje"></div>
  `;

  div.querySelector('.carga-guardar-btn').addEventListener('click', async () => {
    const input = div.querySelector('.carga-input');
    const fechaInput = div.querySelector('.carga-fecha');
    const fechaHastaInput = div.querySelector('.carga-fecha-hasta');
    const msj = div.querySelector('.carga-item-mensaje');
    const valor = parseFloat(input.value);
    if (!valor || valor <= 0) {
      msj.textContent = 'Ingresá un valor válido.';
      msj.className = 'carga-item-mensaje error';
      return;
    }
    if (!fechaInput.value) {
      msj.textContent = 'Elegí una fecha.';
      msj.className = 'carga-item-mensaje error';
      return;
    }
    if (fechaHastaInput.value && fechaHastaInput.value < fechaInput.value) {
      msj.textContent = '"Hasta" no puede ser anterior a la fecha de inicio.';
      msj.className = 'carga-item-mensaje error';
      return;
    }
    const ok = await guardarValor(producto, valor, fechaInput.value, fechaHastaInput.value, msj);
    if (ok) {
      const infoNueva = await obtenerInfoProducto(producto.id);
      div.replaceWith(renderFilaProducto(producto, infoNueva));
    }
  });

  return div;
}

export async function refrescarCarga() {
  const cont = el('cargaLista');
  cont.innerHTML = 'Cargando…';
  const filas = await Promise.all(
    PRODUCTOS_MANUALES.map(async (producto) => ({ producto, info: await obtenerInfoProducto(producto.id) }))
  );
  cont.innerHTML = '';
  for (const { producto, info } of filas) {
    cont.appendChild(renderFilaProducto(producto, info));
  }
}
