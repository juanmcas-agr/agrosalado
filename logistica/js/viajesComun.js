// Utilidades compartidas entre viajes.js (lado chofer) y adminViajes.js
// (lado staff) — ambos muestran el mismo tipo de fila (un viaje, con sus
// documentos y su estado de liquidación), solo cambia quién puede
// editar/eliminar cada uno.
import { urlFirmadaDocumento } from './storage.js';

// Último día del mes de un input type="month" ("YYYY-MM") en formato ISO.
export function rangoMes(mesStr) {
  const [anio, mesNum] = mesStr.split('-').map(Number);
  return {
    desde: `${mesStr}-01`,
    hasta: new Date(anio, mesNum, 0).toISOString().slice(0, 10),
  };
}

export async function verDocumento(path) {
  try {
    const url = await urlFirmadaDocumento(path);
    window.open(url, '_blank', 'noopener');
  } catch (error) {
    alert('No se pudo abrir el archivo: ' + error.message);
  }
}

// Celda de tabla con un botón por documento cargado (si hay).
export function celdaDocs(v) {
  const td = document.createElement('td');
  if (v.carta_porte_path) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'boton-secundario';
    btn.textContent = 'C. porte';
    btn.addEventListener('click', () => verDocumento(v.carta_porte_path));
    td.appendChild(btn);
  }
  if (v.ticket_pesada_path) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'boton-secundario';
    btn.textContent = 'T. pesada';
    btn.addEventListener('click', () => verDocumento(v.ticket_pesada_path));
    td.appendChild(btn);
  }
  return td;
}

// El concepto de liquidación no existe para propios (esos viajes
// alimentan el sueldo, no facturación) — para ellos no hay nada que
// mostrar acá.
export function textoEstadoLiquidacion(categoria, v) {
  if (categoria === 'propio') return '';
  if (!v.liquidacion_estado) return 'Sin liquidar';
  if (v.liquidacion_estado === 'aceptada') return `Apto para facturar (${v.liquidacion_codigo})`;
  if (v.liquidacion_estado === 'pendiente') return 'En liquidación pendiente';
  return 'Liquidación rechazada';
}

// Muestra (o esconde, si no hay path) un link "ver archivo actual" para
// un documento ya cargado — se usa en los formularios de edición, tanto
// del chofer como del staff.
export async function mostrarLinkActual(idContenedor, path, etiqueta) {
  const div = document.getElementById(idContenedor);
  if (!path) {
    div.classList.add('oculto');
    div.innerHTML = '';
    return;
  }
  div.classList.remove('oculto');
  div.textContent = `${etiqueta} ya cargado(a) — generando enlace...`;
  try {
    const url = await urlFirmadaDocumento(path);
    div.innerHTML = `${etiqueta} ya cargado(a) — <a href="${url}" target="_blank" rel="noopener">ver archivo actual</a>. Elegí uno nuevo abajo solo si lo querés reemplazar.`;
  } catch (error) {
    div.textContent = `${etiqueta}: no se pudo generar el enlace (${error.message})`;
  }
}
