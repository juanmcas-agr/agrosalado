import {
  TIPOS_MOVIMIENTO, ESTABLECIMIENTOS, CATEGORIAS,
  KILOS_MIN_SANIDAD, KILOS_MAX_SANIDAD,
} from './config.js';
import { encolarMovimiento } from './sync.js';
import { getEstado } from './auth.js';

const CAMPOS = ['establecimiento_origen', 'establecimiento_destino', 'categoria_origen', 'categoria_destino'];

function el(id) {
  return document.getElementById(id);
}

// ─── grupos de botones (reemplazan los <select>: son pocas opciones y así
// queda "pintado" el elegido, más rápido de tocar en el campo) ───

function crearGrupoBotones(id, opciones) {
  const contenedor = el(id);
  contenedor.classList.add('grupo-botones');
  contenedor.innerHTML = '';
  for (const o of opciones) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-opcion';
    boton.dataset.value = o.id;
    boton.textContent = o.nombre;
    boton.addEventListener('click', () => {
      contenedor.querySelectorAll('.boton-opcion').forEach((b) => b.classList.remove('seleccionado'));
      boton.classList.add('seleccionado');
      contenedor.dispatchEvent(new Event('cambio'));
    });
    contenedor.appendChild(boton);
  }
}

function obtenerSeleccion(id) {
  const boton = el(id).querySelector('.boton-opcion.seleccionado');
  return boton ? boton.dataset.value : '';
}

function establecerSeleccion(id, valor) {
  const contenedor = el(id);
  contenedor.querySelectorAll('.boton-opcion').forEach((b) => {
    b.classList.toggle('seleccionado', b.dataset.value === valor);
  });
  contenedor.dispatchEvent(new Event('cambio'));
}

function limpiarSeleccion(id) {
  el(id).querySelectorAll('.boton-opcion').forEach((b) => b.classList.remove('seleccionado'));
}

function poblarGrupos() {
  crearGrupoBotones('mov-tipo', Object.entries(TIPOS_MOVIMIENTO).map(([id, cfg]) => ({ id, nombre: cfg.nombre })));
  crearGrupoBotones('mov-establecimiento-origen', ESTABLECIMIENTOS);
  crearGrupoBotones('mov-establecimiento-destino', ESTABLECIMIENTOS);
  crearGrupoBotones('mov-categoria-origen', CATEGORIAS);
  crearGrupoBotones('mov-categoria-destino', CATEGORIAS);
}

function actualizarCamposVisibles() {
  const tipo = obtenerSeleccion('mov-tipo');
  if (!tipo) return;
  const cfg = TIPOS_MOVIMIENTO[tipo];

  for (const campo of CAMPOS) {
    const contenedor = document.querySelector(`[data-campo="${campo}"]`);
    contenedor.classList.toggle('oculto', !cfg.campos.includes(campo));
  }

  // Siempre se reconstruye para que quede sin selección al cambiar de tipo
  // (evita arrastrar una categoría elegida que ya no corresponde).
  crearGrupoBotones(
    'mov-categoria-destino',
    cfg.categoriasPermitidas ? CATEGORIAS.filter((c) => cfg.categoriasPermitidas.includes(c.id)) : CATEGORIAS
  );
}

function activarAccesoRapidoFeedLot() {
  el('mov-feedlot').addEventListener('click', () => {
    establecerSeleccion('mov-tipo', 'traslado');
    establecerSeleccion('mov-establecimiento-destino', 'feed_lot');
  });
}

function leerFormulario() {
  const tipo = obtenerSeleccion('mov-tipo');
  const cfg = TIPOS_MOVIMIENTO[tipo];
  return {
    tipo,
    cfg,
    fecha: el('mov-fecha').value,
    establecimiento_origen: cfg.campos.includes('establecimiento_origen') ? obtenerSeleccion('mov-establecimiento-origen') : null,
    establecimiento_destino: cfg.campos.includes('establecimiento_destino') ? obtenerSeleccion('mov-establecimiento-destino') : null,
    categoria_origen: cfg.campos.includes('categoria_origen') ? obtenerSeleccion('mov-categoria-origen') : null,
    categoria_destino: cfg.campos.includes('categoria_destino') ? obtenerSeleccion('mov-categoria-destino') : null,
    cantidad_cabezas: el('mov-cabezas').value,
    kilos_promedio: el('mov-kilos').value,
    observaciones: el('mov-observaciones').value.trim() || null,
  };
}

function validar(datos) {
  const errores = [];
  const advertencias = [];

  if (!datos.fecha) errores.push('Falta la fecha.');
  else if (datos.fecha > new Date().toISOString().slice(0, 10)) errores.push('La fecha no puede ser futura.');

  for (const campo of datos.cfg.campos) {
    if (!datos[campo]) errores.push('Falta completar un campo obligatorio.');
  }

  const cabezas = Number(datos.cantidad_cabezas);
  if (!Number.isInteger(cabezas) || cabezas <= 0) errores.push('La cantidad de cabezas debe ser un entero mayor a 0.');

  const kilos = Number(datos.kilos_promedio);
  if (!(kilos > 0)) errores.push('Los kilos promedio deben ser mayores a 0.');
  else if (kilos < KILOS_MIN_SANIDAD || kilos > KILOS_MAX_SANIDAD) {
    advertencias.push(`${kilos} kg/cabeza es un valor fuera de lo habitual (${KILOS_MIN_SANIDAD}-${KILOS_MAX_SANIDAD} kg). Verificá antes de confirmar.`);
  }

  if (datos.tipo === 'traslado' && datos.establecimiento_origen === datos.establecimiento_destino) {
    errores.push('En un traslado, el establecimiento de origen y destino deben ser distintos.');
  }
  if (datos.tipo === 'cambio_categoria' && datos.categoria_origen === datos.categoria_destino) {
    errores.push('En un cambio de categoría, la categoría de origen y destino deben ser distintas.');
  }

  return { errores, advertencias };
}

function armarFila(datos) {
  const { cfg } = datos;
  let categoria_destino = datos.categoria_destino;
  let establecimiento_destino = datos.establecimiento_destino;
  if (cfg.duplicarCategoriaEnDestino) categoria_destino = datos.categoria_origen;
  if (cfg.duplicarEstablecimientoEnDestino) establecimiento_destino = datos.establecimiento_origen;

  return {
    id: crypto.randomUUID(),
    tipo_movimiento: datos.tipo,
    fecha: datos.fecha,
    establecimiento_origen: datos.establecimiento_origen || null,
    establecimiento_destino: establecimiento_destino || null,
    categoria_origen: datos.categoria_origen || null,
    categoria_destino: categoria_destino || null,
    cantidad_cabezas: Number(datos.cantidad_cabezas),
    kilos_promedio: Number(datos.kilos_promedio),
    usuario_id: getEstado().session.user.id,
    observaciones: datos.observaciones,
  };
}

function mostrarMensaje(texto, tipo) {
  const contenedor = el('mov-mensaje');
  contenedor.textContent = texto;
  contenedor.className = tipo; // 'error' | 'ok' | 'advertencia'
}

function resetFormulario() {
  el('mov-cabezas').value = '';
  el('mov-kilos').value = '';
  el('mov-observaciones').value = '';
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('mov-establecimiento-origen');
  limpiarSeleccion('mov-establecimiento-destino');
  limpiarSeleccion('mov-categoria-origen');
  establecerSeleccion('mov-tipo', Object.keys(TIPOS_MOVIMIENTO)[0]);
}

async function onSubmit(evento) {
  evento.preventDefault();
  const datos = leerFormulario();
  const { errores, advertencias } = validar(datos);

  if (errores.length) {
    mostrarMensaje(errores.join(' '), 'error');
    return;
  }

  const fila = armarFila(datos);
  await encolarMovimiento(fila);

  const avisoExtra = advertencias.length ? ` (${advertencias.join(' ')})` : '';
  mostrarMensaje(`Movimiento guardado.${avisoExtra} Se sincroniza automáticamente.`, advertencias.length ? 'advertencia' : 'ok');
  resetFormulario();
}

export function initMovimientos() {
  poblarGrupos();
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  el('mov-tipo').addEventListener('cambio', actualizarCamposVisibles);
  establecerSeleccion('mov-tipo', Object.keys(TIPOS_MOVIMIENTO)[0]);
  activarAccesoRapidoFeedLot();
  el('mov-form').addEventListener('submit', onSubmit);
}
