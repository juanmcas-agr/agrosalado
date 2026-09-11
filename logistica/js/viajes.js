// Lado chofer (propio o externo): cargar/editar/eliminar sus propios
// viajes, con carta de porte / ticket de pesada obligatorios para
// externos (opcionales para propios).
//
// La RLS es la que realmente decide qué se puede tocar (ver
// supabase/schema.sql, viajes_update/viajes_delete): un propio nunca
// llega a VER un viaje de un período ya cerrado (queda afuera del select),
// así que del lado del cliente no hace falta replicar esa regla — solo
// hace falta ocultar los botones de Editar/Eliminar para un externo cuya
// liquidación ya fue aceptada (sigue viendo el viaje, para ver el código,
// pero ya no lo puede tocar).
//
// Los adjuntos se suben a Storage ANTES de insertar la fila: el id del
// viaje se genera acá mismo (crypto.randomUUID()), no lo asigna la base,
// para poder armar la ruta viajes/{transportista}/{viaje}/... y que el
// insert ya llegue con los dos paths cargados (el trigger validar_viaje()
// exige ambos para externos — ver schema.sql).
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';
import { subirDocumento } from './storage.js';
import { rangoMes, celdaDocs, textoEstadoLiquidacion, mostrarLinkActual } from './viajesComun.js';

function el(id) {
  return document.getElementById(id);
}

let camionesCache = [];
let viajesCache = [];
let editandoId = null;

function esExterno() {
  return getEstado().transportista.categoria === 'externo';
}

async function cargarCamionesSelect() {
  const { data, error } = await supabase.from('camiones').select('*').eq('activo', true).order('patente');
  if (error) {
    console.error('No se pudieron cargar los camiones:', error);
    return;
  }
  camionesCache = data;
  el('viaje-camion').innerHTML = '<option value="">Elegir...</option>'
    + camionesCache.map((c) => `<option value="${c.id}">${c.patente}${c.descripcion ? ' — ' + c.descripcion : ''}</option>`).join('');
  el('mv-filtro-camion').innerHTML = '<option value="">Todos</option>'
    + camionesCache.map((c) => `<option value="${c.id}">${c.patente}</option>`).join('');
}

function actualizarRequeridosAdjuntos() {
  const requerido = esExterno();
  el('viaje-carta-porte-requerido').classList.toggle('oculto', !requerido);
  el('viaje-ticket-pesada-requerido').classList.toggle('oculto', !requerido);
}

function resetFormulario() {
  editandoId = null;
  el('viaje-form').reset();
  el('viaje-id').value = '';
  el('viaje-fecha').value = new Date().toISOString().slice(0, 10);
  el('viaje-form-titulo').textContent = 'Cargar viaje';
  el('viaje-guardar-btn').textContent = 'Guardar viaje';
  el('viaje-cancelar-edicion').classList.add('oculto');
  el('viaje-form-mensaje').textContent = '';
  el('viaje-carta-porte-actual').classList.add('oculto');
  el('viaje-ticket-pesada-actual').classList.add('oculto');
  actualizarRequeridosAdjuntos();
}

function editarViaje(v) {
  editandoId = v.id;
  el('viaje-id').value = v.id;
  el('viaje-fecha').value = v.fecha_carga;
  el('viaje-camion').value = v.camion_id;
  el('viaje-origen').value = v.origen;
  el('viaje-destino').value = v.destino;
  el('viaje-mercaderia').value = v.mercaderia;
  el('viaje-km').value = v.km ?? '';
  el('viaje-tn').value = v.tn ?? '';
  el('viaje-observaciones').value = v.observaciones || '';
  el('viaje-carta-porte').value = '';
  el('viaje-ticket-pesada').value = '';
  mostrarLinkActual('viaje-carta-porte-actual', v.carta_porte_path, 'Carta de porte');
  mostrarLinkActual('viaje-ticket-pesada-actual', v.ticket_pesada_path, 'Ticket de pesada');
  el('viaje-form-titulo').textContent = `Editar viaje ${v.codigo}`;
  el('viaje-guardar-btn').textContent = 'Guardar cambios';
  el('viaje-cancelar-edicion').classList.remove('oculto');
  actualizarRequeridosAdjuntos();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function eliminarViaje(v) {
  if (!confirm(`¿Eliminar el viaje ${v.codigo}? Esta acción no se puede deshacer.`)) return;
  const mensaje = el('mv-mensaje');
  const { error } = await supabase.from('viajes').delete().eq('id', v.id);
  if (error) {
    mensaje.textContent = `No se pudo eliminar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  if (editandoId === v.id) resetFormulario();
  await cargarMisViajes();
}

// Solo aplica a externos: una vez que la liquidación que incluye este
// viaje fue aceptada, no lo puede seguir editando/borrando (sigue
// viéndolo, para ver el código). Un propio nunca ve acá un viaje de un
// período cerrado (RLS ya lo excluyó del select), así que para propios
// esto siempre da false.
function estaBloqueado(v) {
  return v.liquidacion_estado === 'aceptada';
}

function renderMisViajes() {
  const tbody = el('mv-tabla').querySelector('tbody');
  if (!viajesCache.length) {
    tbody.innerHTML = '<tr><td colspan="10">Sin viajes cargados.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const v of viajesCache) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${v.codigo}</td>
      <td>${v.fecha_carga}</td>
      <td>${v.camion_patente}</td>
      <td>${v.origen} → ${v.destino}</td>
      <td>${v.mercaderia}</td>
      <td>${v.km ?? ''}</td>
      <td>${v.tn ?? ''}</td>
    `;
    tr.appendChild(celdaDocs(v));
    const tdEstado = document.createElement('td');
    tdEstado.textContent = textoEstadoLiquidacion(getEstado().transportista.categoria, v);
    tr.appendChild(tdEstado);
    const tdAcciones = document.createElement('td');
    tr.appendChild(tdAcciones);
    if (!estaBloqueado(v)) {
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
    }
    tbody.appendChild(tr);
  }
}

export async function cargarMisViajes() {
  const mensaje = el('mv-mensaje');
  mensaje.textContent = '';

  let query = supabase.from('viajes_detalle').select('*');
  const camionId = el('mv-filtro-camion').value;
  const mes = el('mv-filtro-mes').value; // "YYYY-MM"
  if (camionId) query = query.eq('camion_id', camionId);
  if (mes) {
    const { desde, hasta } = rangoMes(mes);
    query = query.gte('fecha_carga', desde).lte('fecha_carga', hasta);
  }

  const { data, error } = await query.order('fecha_carga', { ascending: false });
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  viajesCache = data;
  renderMisViajes();
}

async function guardarViaje(evento) {
  evento.preventDefault();
  const mensaje = el('viaje-form-mensaje');
  mensaje.textContent = '';

  const fecha_carga = el('viaje-fecha').value;
  const camion_id = el('viaje-camion').value;
  const origen = el('viaje-origen').value.trim();
  const destino = el('viaje-destino').value.trim();
  const mercaderia = el('viaje-mercaderia').value.trim();
  const km = el('viaje-km').value ? Number(el('viaje-km').value) : null;
  const tn = el('viaje-tn').value ? Number(el('viaje-tn').value) : null;
  const observaciones = el('viaje-observaciones').value.trim() || null;
  const archivoCartaPorte = el('viaje-carta-porte').files[0] || null;
  const archivoTicketPesada = el('viaje-ticket-pesada').files[0] || null;

  if (!fecha_carga || !camion_id || !origen || !destino || !mercaderia) {
    mensaje.textContent = 'Completá fecha, camión, origen, destino y mercadería.';
    mensaje.className = 'error';
    return;
  }
  if (fecha_carga > new Date().toISOString().slice(0, 10)) {
    mensaje.textContent = 'La fecha no puede ser futura.';
    mensaje.className = 'error';
    return;
  }
  if (esExterno()) {
    const viajeActual = editandoId ? viajesCache.find((v) => v.id === editandoId) : null;
    const tieneCartaPorte = !!archivoCartaPorte || !!viajeActual?.carta_porte_path;
    const tieneTicketPesada = !!archivoTicketPesada || !!viajeActual?.ticket_pesada_path;
    if (!tieneCartaPorte || !tieneTicketPesada) {
      mensaje.textContent = 'Para transportistas externos, la carta de porte y el ticket de pesada son obligatorios.';
      mensaje.className = 'error';
      return;
    }
  }

  const { session } = getEstado();
  const viajeId = editandoId || crypto.randomUUID();
  const datos = { fecha_carga, camion_id, origen, destino, mercaderia, km, tn, observaciones };

  try {
    if (archivoCartaPorte) datos.carta_porte_path = await subirDocumento(session.user.id, viajeId, 'carta_porte', archivoCartaPorte);
    if (archivoTicketPesada) datos.ticket_pesada_path = await subirDocumento(session.user.id, viajeId, 'ticket_pesada', archivoTicketPesada);
  } catch (error) {
    mensaje.textContent = `No se pudo subir el archivo: ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  let error;
  if (editandoId) {
    ({ error } = await supabase.from('viajes').update(datos).eq('id', editandoId));
  } else {
    ({ error } = await supabase.from('viajes').insert({ id: viajeId, ...datos, transportista_id: session.user.id, cargado_por: session.user.id }));
  }
  if (error) {
    mensaje.textContent = `No se pudo guardar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  resetFormulario();
  await cargarMisViajes();
  mensaje.textContent = 'Viaje guardado.';
  mensaje.className = 'ok';
}

export async function cargarPantallaMisViajes() {
  await cargarCamionesSelect();
  await cargarMisViajes();
}

export function initMisViajes() {
  resetFormulario();
  el('viaje-form').addEventListener('submit', guardarViaje);
  el('viaje-cancelar-edicion').addEventListener('click', resetFormulario);
  el('mv-filtrar').addEventListener('click', cargarMisViajes);
}
