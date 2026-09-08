import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';

function nombreConFecha(base, ext = 'xlsx') {
  return `${base}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function filasMatrizParaExcel(matriz) {
  const totalesPorCategoria = {};
  for (const c of CATEGORIAS) totalesPorCategoria[c.id] = 0;

  const filas = ESTABLECIMIENTOS.map((e) => {
    const fila = { Establecimiento: e.nombre };
    let total = 0;
    for (const c of CATEGORIAS) {
      fila[c.nombre] = matriz[e.id][c.id];
      total += matriz[e.id][c.id];
      totalesPorCategoria[c.id] += matriz[e.id][c.id];
    }
    fila.Total = total;
    return fila;
  });

  const filaTotal = { Establecimiento: 'Total' };
  let totalGeneral = 0;
  for (const c of CATEGORIAS) {
    filaTotal[c.nombre] = totalesPorCategoria[c.id];
    totalGeneral += totalesPorCategoria[c.id];
  }
  filaTotal.Total = totalGeneral;
  filas.push(filaTotal);

  return filas;
}

export function exportarMatrizStock(matriz, nombreBase, tituloHoja) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filasMatrizParaExcel(matriz));
  XLSX.utils.book_append_sheet(wb, ws, tituloHoja.slice(0, 31));
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}

export function exportarStockEstablecimiento(totalesPorCategoria, nombreEstablecimiento, nombreBase) {
  const filas = CATEGORIAS.map((c) => ({ Categoría: c.nombre, Cabezas: totalesPorCategoria[c.id] || 0 }));
  const total = Object.values(totalesPorCategoria).reduce((a, b) => a + b, 0);
  filas.push({ Categoría: 'Total', Cabezas: total });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, nombreEstablecimiento.slice(0, 31));
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}

export function exportarHistorial(filasHistorial, nombreBase = 'historial_movimientos') {
  const filas = filasHistorial.map((f) => ({
    Código: f.codigo || '',
    'Fecha movimiento': f.fecha,
    'Fecha de registro': new Date(f.created_at).toLocaleString('es-AR'),
    Tipo: f.tipo_movimiento_nombre,
    'Establecimiento origen': f.establecimiento_origen_nombre || '',
    'Categoría origen': f.categoria_origen_nombre || '',
    'Establecimiento destino': f.establecimiento_destino_nombre || '',
    'Categoría destino': f.categoria_destino_nombre || '',
    'Titular origen': f.titular_origen_nombre || '',
    'Titular destino': f.titular_destino_nombre || '',
    Cabezas: f.cantidad_cabezas,
    'Kg/cabeza': f.kilos_promedio,
    Rodeo: f.rodeo || '',
    'Cargado por': f.usuario_nombre || '',
    Observaciones: f.observaciones || '',
    Estado: f.anulado ? `Anulado (${f.anulado_motivo || 'sin motivo'})` : 'Activo',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}

// filasConDetalle: salida de obtenerTrabajosConDetalle() en
// trabajoMangaDetalle.js (ya trae categoriaNombre/propietariosTexto/
// detalleTexto resueltos) — mismo shape para Historial y Reportes.
export function exportarTrabajosManga(filasConDetalle, nombreBase = 'historial_trabajos_manga') {
  const filas = filasConDetalle.map((t) => ({
    Código: t.codigo || '',
    Fecha: t.fecha,
    Rodeo: t.rodeo || '',
    Categoría: t.categoriaNombre || '',
    'Cantidad trabajada': t.cantidad_trabajada,
    'Diferencia pendiente': t.diferencia_pendiente ? 'Sí' : 'No',
    'Propietario(s)': t.propietariosTexto || '',
    Detalle: t.detalleTexto || '',
    'Cargado por': t.usuario_nombre || '',
    Observaciones: t.observaciones || '',
    Estado: t.anulado ? `Anulado (${t.anulado_motivo || 'sin motivo'})` : 'Activo',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, 'Trabajo de Manga');
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}
