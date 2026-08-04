import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';

function nombreConFecha(base, ext = 'xlsx') {
  return `${base}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function filasMatrizParaExcel(matriz) {
  return ESTABLECIMIENTOS.map((e) => {
    const fila = { Establecimiento: e.nombre };
    let total = 0;
    for (const c of CATEGORIAS) {
      fila[c.nombre] = matriz[e.id][c.id];
      total += matriz[e.id][c.id];
    }
    fila.Total = total;
    return fila;
  });
}

export function exportarMatrizStock(matriz, nombreBase, tituloHoja) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filasMatrizParaExcel(matriz));
  XLSX.utils.book_append_sheet(wb, ws, tituloHoja.slice(0, 31));
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}

export function exportarHistorial(filasHistorial, nombreBase = 'historial_movimientos') {
  const filas = filasHistorial.map((f) => ({
    Fecha: f.fecha,
    Tipo: f.tipo_movimiento_nombre,
    'Establecimiento origen': f.establecimiento_origen_nombre || '',
    'Categoría origen': f.categoria_origen_nombre || '',
    'Establecimiento destino': f.establecimiento_destino_nombre || '',
    'Categoría destino': f.categoria_destino_nombre || '',
    Cabezas: f.cantidad_cabezas,
    'Kg/cabeza': f.kilos_promedio,
    'Cargado por': f.usuario_nombre || '',
    Observaciones: f.observaciones || '',
    Estado: f.anulado ? `Anulado (${f.anulado_motivo || 'sin motivo'})` : 'Activo',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  XLSX.writeFile(wb, nombreConFecha(nombreBase));
}
