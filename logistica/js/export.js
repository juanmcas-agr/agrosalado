// Export a Excel, mismo patrón que stock/js/export.js: usa la librería
// SheetJS ya cargada como global XLSX (ver index.html) sobre los datos que
// ya están en pantalla (cacheados/filtrados) — no dispara una consulta
// nueva.
import { textoEstadoLiquidacion } from './viajesComun.js';

function nombreConFecha(base, ext = 'xlsx') {
  return `${base}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function exportarFilas(filas, nombreHoja, nombreBase) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja.slice(0, 31));
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}

// Se usa tanto del lado staff (viajes_staff, todos los transportistas)
// como del lado chofer (mis_viajes, siempre los propios) — mismo shape de
// fila en los dos casos porque ambos consultan viajes_detalle.
export function exportarViajes(viajes, nombreBase = 'viajes') {
  const filas = viajes.map((v) => ({
    Código: v.codigo,
    Fecha: v.fecha_carga,
    Transportista: v.transportista_nombre,
    Categoría: v.transportista_categoria === 'propio' ? 'Propio' : 'Externo',
    Camión: v.camion_patente,
    Origen: v.origen,
    Destino: v.destino,
    Mercadería: v.mercaderia,
    Km: v.km ?? '',
    Tn: v.tn ?? '',
    Observaciones: v.observaciones || '',
    Estado: textoEstadoLiquidacion(v.transportista_categoria, v),
  }));
  exportarFilas(filas, 'Viajes', nombreBase);
}

export function exportarSueldoPropios(filas, nombreBase = 'sueldo_propios') {
  const datos = filas.map((f) => ({
    Transportista: f.nombre,
    Viajes: f.cantidad,
    Tn: +f.tn.toFixed(2),
    Km: f.km,
    'Mes cerrado': f.cerrado ? 'Sí' : 'No',
  }));
  exportarFilas(datos, 'Sueldo de propios', nombreBase);
}

export function exportarPendientesFacturar(liquidaciones, nombreBase = 'pendientes_facturar') {
  const datos = liquidaciones.map((l) => ({
    Código: l.codigo,
    Transportista: l.transportista_nombre,
    'Aceptada el': l.resuelto_at ? new Date(l.resuelto_at).toLocaleDateString('es-AR') : '',
    Viajes: l.cantidad_viajes,
    Tn: Number(l.total_tn),
    Km: l.total_km,
  }));
  exportarFilas(datos, 'Pendientes de facturar', nombreBase);
}
