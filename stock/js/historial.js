import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, TIPOS_MOVIMIENTO } from './config.js';
import { getEstado } from './auth.js';
import { exportarHistorial, exportarTrabajosManga } from './export.js';
import { cargarRodeos, obtenerRodeosCache } from './rodeos.js';
import { cargarTitulares } from './titulares.js';
import { cargarCatalogosSanidad, obtenerTrabajosConDetalle } from './trabajoMangaDetalle.js';

const VENTANA_ANULACION_HORAS = 48;

function el(id) {
  return document.getElementById(id);
}

function poblarFiltros() {
  const selEst = el('hist-filtro-establecimiento');
  if (!selEst.options.length) {
    selEst.innerHTML = '<option value="">Todos los establecimientos</option>';
    for (const e of ESTABLECIMIENTOS) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.nombre;
      selEst.appendChild(opt);
    }
  }

  const selTipo = el('hist-filtro-tipo');
  if (!selTipo.options.length) {
    selTipo.innerHTML = '<option value="">Todos los tipos</option>';
    for (const [id, cfg] of Object.entries(TIPOS_MOVIMIENTO)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = cfg.nombre;
      selTipo.appendChild(opt);
    }
  }

  const selEstado = el('hist-filtro-estado');
  if (!selEstado.options.length) {
    selEstado.innerHTML = `
      <option value="activos" selected>Sin anular</option>
      <option value="anulados">Anulados</option>
      <option value="">Todos</option>
    `;
  }
}

// Mismas reglas para anular y editar: administrativo/owner sin límite de
// tiempo, o el propio usuario dentro de la ventana — y en ningún caso si
// ya está anulado o ya fue reemplazado por una corrección (no tiene
// sentido volver a tocar un movimiento que "ya no rige").
function puedeModificar(fila) {
  const { perfil, session } = getEstado();
  if (!perfil || fila.anulado || fila.reemplazado_por) return false;
  if (perfil.rol === 'administrativo' || perfil.rol === 'owner') return true;
  if (fila.usuario_id !== session.user.id) return false;
  const horas = (Date.now() - new Date(fila.created_at).getTime()) / 36e5;
  return horas <= VENTANA_ANULACION_HORAS;
}

function describirMovimiento(fila) {
  const origen = fila.establecimiento_origen_nombre
    ? `${fila.establecimiento_origen_nombre} (${fila.categoria_origen_nombre})`
    : '—';
  const destino = fila.establecimiento_destino_nombre
    ? `${fila.establecimiento_destino_nombre} (${fila.categoria_destino_nombre})`
    : '—';
  return { origen, destino };
}

function describirTitular(fila) {
  if (fila.titular_origen_nombre && fila.titular_destino_nombre && fila.titular_origen !== fila.titular_destino) {
    return `${fila.titular_origen_nombre} → ${fila.titular_destino_nombre}`;
  }
  return fila.titular_origen_nombre || fila.titular_destino_nombre || '—';
}

async function anularMovimiento(id) {
  if (!navigator.onLine) {
    alert('Necesitás conexión a internet para anular un movimiento.');
    return;
  }
  const motivo = prompt('Motivo de la anulación:');
  if (motivo === null) return;
  const { perfil } = getEstado();
  const { error } = await supabase
    .from('movimientos')
    .update({
      anulado: true,
      anulado_por: getEstado().session.user.id,
      anulado_at: new Date().toISOString(),
      anulado_motivo: motivo || null,
    })
    .eq('id', id);
  if (error) {
    alert(`No se pudo anular: ${error.message}`);
    return;
  }
  await cargarHistorial();
}

// Se llama desde movimientos.js al confirmar una corrección — el
// movimiento nuevo ya se guardó (con editado_de=id), esto solo marca el
// viejo. Requiere conexión (igual que anular): es un UPDATE puntual, no
// pasa por el outbox offline.
export async function marcarComoReemplazado(idOriginal, idNuevo) {
  const { error } = await supabase.from('movimientos').update({ reemplazado_por: idNuevo }).eq('id', idOriginal);
  if (error) throw error;
}

// Pide precargar el formulario de "Cargar movimiento" con esta fila — vía
// evento en vez de importar movimientos.js directo, para no armar un
// import circular (movimientos.js si necesita marcarComoReemplazado de acá).
function pedirEdicion(fila) {
  document.dispatchEvent(new CustomEvent('hacienda:editar-movimiento', { detail: fila }));
}

function renderFilas(filas) {
  const tbody = el('hist-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  for (const fila of filas) {
    const { origen, destino } = describirMovimiento(fila);
    const tr = document.createElement('tr');
    if (fila.anulado) tr.classList.add('anulado');
    if (fila.reemplazado_por) tr.classList.add('editado');
    let estado = '';
    if (fila.anulado) estado = `Anulado (${fila.anulado_motivo || 'sin motivo'})`;
    else if (fila.reemplazado_por) estado = `✏️ Editado → ${fila.reemplazado_por_codigo || '?'}`;
    else if (fila.editado_de) estado = `✏️ Corrección de ${fila.editado_de_codigo || '?'}`;
    tr.innerHTML = `
      <td>${fila.codigo || ''}</td>
      <td>${fila.fecha}</td>
      <td>${new Date(fila.created_at).toLocaleString('es-AR')}</td>
      <td>${fila.tipo_movimiento_nombre}</td>
      <td>${origen}</td>
      <td>${destino}</td>
      <td>${describirTitular(fila)}</td>
      <td>${fila.cantidad_cabezas}</td>
      <td>${fila.kilos_promedio}</td>
      <td>${fila.rodeo || ''}</td>
      <td>${fila.usuario_nombre || '—'}</td>
      <td>${fila.observaciones || ''}</td>
      <td>${estado}</td>
      <td></td>
    `;
    if (puedeModificar(fila)) {
      const btnEditar = document.createElement('button');
      btnEditar.textContent = 'Editar';
      btnEditar.className = 'boton-secundario';
      btnEditar.style.cssText = 'width:auto;padding:4px 10px;margin-right:6px;';
      btnEditar.addEventListener('click', () => pedirEdicion(fila));
      tr.lastElementChild.appendChild(btnEditar);

      const btnAnular = document.createElement('button');
      btnAnular.textContent = 'Anular';
      btnAnular.className = 'boton-anular';
      btnAnular.addEventListener('click', () => anularMovimiento(fila.id));
      tr.lastElementChild.appendChild(btnAnular);
    }
    tbody.appendChild(tr);
  }
}

let ultimasFilas = [];

export async function cargarHistorial() {
  let query = supabase.from('historial_movimientos').select('*').limit(200);

  const codigo = el('hist-filtro-codigo').value.trim();
  const establecimiento = el('hist-filtro-establecimiento').value;
  const tipo = el('hist-filtro-tipo').value;
  const estado = el('hist-filtro-estado').value;
  const desde = el('hist-filtro-desde').value;
  const hasta = el('hist-filtro-hasta').value;

  // Buscar por código: campo autónomo, pisa el resto de los filtros (si
  // sabés el código, querés ESE movimiento puntual, no una lista filtrada).
  if (codigo) {
    query = query.ilike('codigo', `%${codigo}%`);
  } else {
    if (establecimiento) {
      query = query.or(`establecimiento_origen.eq.${establecimiento},establecimiento_destino.eq.${establecimiento}`);
    }
    if (tipo) query = query.eq('tipo_movimiento', tipo);
    if (estado === 'activos') query = query.eq('anulado', false);
    else if (estado === 'anulados') query = query.eq('anulado', true);
    if (desde) query = query.gte('fecha', desde);
    if (hasta) query = query.lte('fecha', hasta);
  }

  const { data, error } = await query;
  if (error) {
    el('hist-mensaje').textContent = `No se pudo cargar el historial (¿sin conexión?): ${error.message}`;
    el('hist-mensaje').className = 'error';
    return;
  }
  el('hist-mensaje').textContent = '';
  ultimasFilas = data;
  renderFilas(data);
}

function exportar() {
  if (!ultimasFilas.length) return;
  exportarHistorial(ultimasFilas);
}

// ─── Historial de Trabajos de Manga (misma lógica que el de arriba:
// filtros, buscar por código, exportar — pero de solo lectura, sin
// Editar/Anular todavía, trabajos_manga no tiene ese concepto hoy) ───

function poblarSelectRodeoHistorialManga() {
  const select = el('hist-manga-filtro-rodeo');
  select.innerHTML = '<option value="">Todos los rodeos</option>';
  for (const r of obtenerRodeosCache()) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.codigo;
    select.appendChild(opt);
  }
}

function renderFilasManga(trabajos) {
  const tbody = el('hist-manga-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  if (!trabajos.length) {
    tbody.innerHTML = '<tr><td colspan="8">Sin trabajos de manga en el rango elegido.</td></tr>';
    return;
  }
  for (const t of trabajos) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.codigo}</td>
      <td>${t.fecha}</td>
      <td>${t.rodeo || ''}</td>
      <td>${t.categoriaNombre}</td>
      <td>${t.cantidad_trabajada}${t.diferencia_pendiente ? ' ⚠️' : ''}</td>
      <td>${t.propietariosTexto}</td>
      <td>${t.detalleTexto}</td>
      <td>${t.usuario_nombre || ''}</td>
    `;
    tbody.appendChild(tr);
  }
}

let ultimasFilasManga = [];

export async function cargarHistorialManga() {
  const mensaje = el('hist-manga-mensaje');
  mensaje.textContent = '';

  const codigo = el('hist-manga-filtro-codigo').value.trim();
  const rodeoId = el('hist-manga-filtro-rodeo').value;
  const desde = el('hist-manga-filtro-desde').value;
  const hasta = el('hist-manga-filtro-hasta').value;

  try {
    ultimasFilasManga = await obtenerTrabajosConDetalle({ codigo, rodeoId, desde, hasta });
    renderFilasManga(ultimasFilasManga);
  } catch (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
  }
}

function exportarManga() {
  if (!ultimasFilasManga.length) return;
  exportarTrabajosManga(ultimasFilasManga);
}

export function initHistorial() {
  poblarFiltros();
  el('hist-filtrar').addEventListener('click', cargarHistorial);
  el('hist-exportar').addEventListener('click', exportar);
  cargarHistorial();

  el('hist-manga-filtrar').addEventListener('click', cargarHistorialManga);
  el('hist-manga-exportar').addEventListener('click', exportarManga);
  Promise.all([cargarRodeos(), cargarTitulares(), cargarCatalogosSanidad()]).then(() => {
    poblarSelectRodeoHistorialManga();
    cargarHistorialManga();
  });
}
