// Lado staff: listado global de viajes (todos los transportistas que le
// corresponda ver — la RLS ya filtra los de propios si no tiene
// acceso_logistica_sueldos, acá no hace falta repetir esa regla) con
// filtros, y edición/eliminación de CUALQUIER viaje en cualquier momento
// (a diferencia del chofer, administración no tiene el candado de
// liquidación aceptada / período cerrado — puede corregir un error
// siempre). No hay alta nueva desde acá: los viajes los cargan los
// choferes, esta pantalla es de revisión y corrección.
import { supabase } from './supabaseClient.js';
import { subirDocumento } from './storage.js';
import { rangoMes, celdaDocs, textoEstadoLiquidacion, mostrarLinkActual } from './viajesComun.js';

function el(id) {
  return document.getElementById(id);
}

let camionesCache = [];
let transportistasCache = [];
let viajesCache = [];
let editandoId = null;

async function cargarFiltrosCatalogo() {
  const [camiones, transportistas] = await Promise.all([
    supabase.from('camiones').select('*').order('patente'),
    supabase.from('transportistas').select('*').order('nombre_completo'),
  ]);
  camionesCache = camiones.data || [];
  transportistasCache = transportistas.data || [];

  const opcionesCamiones = camionesCache.map((c) => `<option value="${c.id}">${c.patente}</option>`).join('');
  el('av-filtro-camion').innerHTML = '<option value="">Todos</option>' + opcionesCamiones;
  el('av-camion').innerHTML = '<option value="">Elegir...</option>'
    + camionesCache.map((c) => `<option value="${c.id}">${c.patente}${c.descripcion ? ' — ' + c.descripcion : ''}</option>`).join('');
  el('av-filtro-transportista').innerHTML = '<option value="">Todos</option>'
    + transportistasCache.map((t) => `<option value="${t.user_id}">${t.nombre_completo} (${t.categoria === 'propio' ? 'propio' : 'externo'})</option>`).join('');
}

function resetFormulario() {
  editandoId = null;
  el('av-form-bloque').classList.add('oculto');
  el('av-form').reset();
  el('av-id').value = '';
  el('av-carta-porte-actual').classList.add('oculto');
  el('av-ticket-pesada-actual').classList.add('oculto');
}

function editarViaje(v) {
  editandoId = v.id;
  el('av-form-bloque').classList.remove('oculto');
  el('av-form-titulo').textContent = `Editar viaje ${v.codigo} (${v.transportista_nombre})`;
  el('av-id').value = v.id;
  el('av-fecha').value = v.fecha_carga;
  el('av-camion').value = v.camion_id;
  el('av-origen').value = v.origen;
  el('av-destino').value = v.destino;
  el('av-mercaderia').value = v.mercaderia;
  el('av-km').value = v.km ?? '';
  el('av-tn').value = v.tn ?? '';
  el('av-observaciones').value = v.observaciones || '';
  el('av-carta-porte').value = '';
  el('av-ticket-pesada').value = '';
  mostrarLinkActual('av-carta-porte-actual', v.carta_porte_path, 'Carta de porte');
  mostrarLinkActual('av-ticket-pesada-actual', v.ticket_pesada_path, 'Ticket de pesada');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function eliminarViaje(v) {
  if (!confirm(`¿Eliminar el viaje ${v.codigo} de ${v.transportista_nombre}? Esta acción no se puede deshacer.`)) return;
  const mensaje = el('av-mensaje');
  const { error } = await supabase.from('viajes').delete().eq('id', v.id);
  if (error) {
    mensaje.textContent = `No se pudo eliminar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  if (editandoId === v.id) resetFormulario();
  await cargarViajesStaff();
}

function renderViajes() {
  const tbody = el('av-tabla').querySelector('tbody');
  if (!viajesCache.length) {
    tbody.innerHTML = '<tr><td colspan="11">Sin viajes para este filtro.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const v of viajesCache) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${v.codigo}</td>
      <td>${v.fecha_carga}</td>
      <td>${v.transportista_nombre} (${v.transportista_categoria === 'propio' ? 'propio' : 'externo'})</td>
      <td>${v.camion_patente}</td>
      <td>${v.origen} → ${v.destino}</td>
      <td>${v.mercaderia}</td>
      <td>${v.km ?? ''}</td>
      <td>${v.tn ?? ''}</td>
    `;
    tr.appendChild(celdaDocs(v));
    const tdEstado = document.createElement('td');
    tdEstado.textContent = textoEstadoLiquidacion(v.transportista_categoria, v);
    tr.appendChild(tdEstado);

    const tdAcciones = document.createElement('td');
    const btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.className = 'boton-secundario';
    btnEditar.textContent = 'Editar';
    btnEditar.addEventListener('click', () => editarViaje(v));
    tdAcciones.appendChild(btnEditar);

    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.className = 'boton-anular';
    btnEliminar.textContent = 'Eliminar';
    btnEliminar.addEventListener('click', () => eliminarViaje(v));
    tdAcciones.appendChild(btnEliminar);
    tr.appendChild(tdAcciones);

    tbody.appendChild(tr);
  }
}

export async function cargarViajesStaff() {
  const mensaje = el('av-mensaje');
  mensaje.textContent = '';

  let query = supabase.from('viajes_detalle').select('*');
  const camionId = el('av-filtro-camion').value;
  const transportistaId = el('av-filtro-transportista').value;
  const categoria = el('av-filtro-categoria').value;
  const mes = el('av-filtro-mes').value;
  if (camionId) query = query.eq('camion_id', camionId);
  if (transportistaId) query = query.eq('transportista_id', transportistaId);
  if (categoria) query = query.eq('transportista_categoria', categoria);
  if (mes) {
    const { desde, hasta } = rangoMes(mes);
    query = query.gte('fecha_carga', desde).lte('fecha_carga', hasta);
  }

  const { data, error } = await query.order('fecha_carga', { ascending: false }).limit(300);
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  viajesCache = data;
  renderViajes();
}

async function guardarViaje(evento) {
  evento.preventDefault();
  const mensaje = el('av-mensaje');
  mensaje.textContent = '';
  if (!editandoId) return; // esta pantalla no da de alta viajes nuevos

  const viajeActual = viajesCache.find((v) => v.id === editandoId);
  const fecha_carga = el('av-fecha').value;
  const camion_id = el('av-camion').value;
  const origen = el('av-origen').value.trim();
  const destino = el('av-destino').value.trim();
  const mercaderia = el('av-mercaderia').value.trim();
  const km = el('av-km').value ? Number(el('av-km').value) : null;
  const tn = el('av-tn').value ? Number(el('av-tn').value) : null;
  const observaciones = el('av-observaciones').value.trim() || null;
  const archivoCartaPorte = el('av-carta-porte').files[0] || null;
  const archivoTicketPesada = el('av-ticket-pesada').files[0] || null;

  if (!fecha_carga || !camion_id || !origen || !destino || !mercaderia) {
    mensaje.textContent = 'Completá fecha, camión, origen, destino y mercadería.';
    mensaje.className = 'error';
    return;
  }

  const datos = { fecha_carga, camion_id, origen, destino, mercaderia, km, tn, observaciones };
  try {
    if (archivoCartaPorte) datos.carta_porte_path = await subirDocumento(viajeActual.transportista_id, editandoId, 'carta_porte', archivoCartaPorte);
    if (archivoTicketPesada) datos.ticket_pesada_path = await subirDocumento(viajeActual.transportista_id, editandoId, 'ticket_pesada', archivoTicketPesada);
  } catch (error) {
    mensaje.textContent = `No se pudo subir el archivo: ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  const { error } = await supabase.from('viajes').update(datos).eq('id', editandoId);
  if (error) {
    mensaje.textContent = `No se pudo guardar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  resetFormulario();
  await cargarViajesStaff();
  mensaje.textContent = 'Viaje actualizado.';
  mensaje.className = 'ok';
}

export async function cargarPantallaViajesStaff() {
  await cargarFiltrosCatalogo();
  await cargarViajesStaff();
}

export function initViajesStaff() {
  el('av-filtrar').addEventListener('click', cargarViajesStaff);
  el('av-form').addEventListener('submit', guardarViaje);
  el('av-cancelar').addEventListener('click', resetFormulario);
}
