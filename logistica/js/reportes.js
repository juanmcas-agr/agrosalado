// Lado staff: dos reportes independientes en una misma pantalla. "Sueldo
// de propios" agrega los viajes de un mes por transportista propio — se
// oculta para quien no tenga acceso_logistica_sueldos u owner, mismo
// criterio que Cierres (M8); la RLS ya bloquearía los datos igual, esto
// solo evita mostrar un bloque que de entrada no serviría de nada.
// "Pendientes de facturar" lista las liquidaciones ya aceptadas (con
// código asignado) — es la misma información que Liquidaciones filtrada a
// "Aceptadas", acá como reporte de seguimiento, visible a cualquier staff.
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';
import { rangoMes } from './viajesComun.js';
import { exportarSueldoPropios, exportarPendientesFacturar } from './export.js';

function el(id) {
  return document.getElementById(id);
}

let sueldoCache = [];
let facturarCache = [];

function hoyMesStr() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

function puedeVerSueldos() {
  const perfil = getEstado().perfil;
  return perfil.rol === 'owner' || perfil.acceso_logistica_sueldos === true;
}

function renderSueldoPropios(filas) {
  const tbody = el('rp-sueldo-tabla').querySelector('tbody');
  if (!filas.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin viajes de propios en este mes.</td></tr>';
    return;
  }
  tbody.innerHTML = [...filas]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((f) => `<tr><td>${f.nombre}</td><td>${f.cantidad}</td><td>${f.tn.toFixed(2)}</td><td>${f.km}</td><td>${f.cerrado ? 'Sí' : 'No'}</td></tr>`)
    .join('');
}

export async function cargarSueldoPropios() {
  const mensaje = el('rp-sueldo-mensaje');
  mensaje.textContent = '';
  const mesStr = el('rp-sueldo-mes').value;
  if (!mesStr) {
    mensaje.textContent = 'Elegí el mes.';
    mensaje.className = 'error';
    return;
  }
  const [anio, mes] = mesStr.split('-').map(Number);
  const { desde, hasta } = rangoMes(mesStr);

  const [viajesRes, cierresRes] = await Promise.all([
    supabase.from('viajes_detalle').select('*').eq('transportista_categoria', 'propio').gte('fecha_carga', desde).lte('fecha_carga', hasta),
    supabase.from('cierres_periodo_propio').select('transportista_id').eq('anio', anio).eq('mes', mes),
  ]);
  if (viajesRes.error || cierresRes.error) {
    const error = viajesRes.error || cierresRes.error;
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  const cerrados = new Set((cierresRes.data || []).map((c) => c.transportista_id));
  const porTransportista = {};
  for (const v of viajesRes.data) {
    const fila = porTransportista[v.transportista_id] || (porTransportista[v.transportista_id] = {
      nombre: v.transportista_nombre,
      cantidad: 0,
      tn: 0,
      km: 0,
      cerrado: cerrados.has(v.transportista_id),
    });
    fila.cantidad += 1;
    fila.tn += Number(v.tn) || 0;
    fila.km += Number(v.km) || 0;
  }
  sueldoCache = Object.values(porTransportista);
  renderSueldoPropios(sueldoCache);
}

function renderPendientesFacturar(liquidaciones) {
  const tbody = el('rp-facturar-tabla').querySelector('tbody');
  if (!liquidaciones.length) {
    tbody.innerHTML = '<tr><td colspan="6">Sin liquidaciones pendientes de facturar.</td></tr>';
    return;
  }
  tbody.innerHTML = liquidaciones.map((l) => `
    <tr>
      <td>${l.codigo}</td>
      <td>${l.transportista_nombre}</td>
      <td>${l.resuelto_at ? new Date(l.resuelto_at).toLocaleDateString('es-AR') : ''}</td>
      <td>${l.cantidad_viajes}</td>
      <td>${Number(l.total_tn).toFixed(2)}</td>
      <td>${l.total_km}</td>
    </tr>
  `).join('');
}

export async function cargarPendientesFacturar() {
  const mensaje = el('rp-facturar-mensaje');
  mensaje.textContent = '';
  const { data, error } = await supabase
    .from('liquidaciones_transporte_detalle')
    .select('*')
    .eq('estado', 'aceptada')
    .order('resuelto_at', { ascending: false });
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  facturarCache = data;
  renderPendientesFacturar(facturarCache);
}

export async function cargarPantallaReportes() {
  if (puedeVerSueldos()) await cargarSueldoPropios();
  await cargarPendientesFacturar();
}

export function initReportes() {
  el('rp-sueldo-bloque').classList.toggle('oculto', !puedeVerSueldos());
  if (!el('rp-sueldo-mes').value) el('rp-sueldo-mes').value = hoyMesStr();
  el('rp-sueldo-buscar').addEventListener('click', cargarSueldoPropios);
  el('rp-sueldo-exportar').addEventListener('click', () => {
    if (sueldoCache.length) exportarSueldoPropios(sueldoCache);
  });
  el('rp-facturar-actualizar').addEventListener('click', cargarPendientesFacturar);
  el('rp-facturar-exportar').addEventListener('click', () => {
    if (facturarCache.length) exportarPendientesFacturar(facturarCache);
  });
}
