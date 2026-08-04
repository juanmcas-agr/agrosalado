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

function poblarSelect(select, opciones, { placeholder } = {}) {
  select.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const o of opciones) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.nombre;
    select.appendChild(opt);
  }
}

function poblarSelects() {
  const selTipo = el('mov-tipo');
  selTipo.innerHTML = '';
  for (const [id, cfg] of Object.entries(TIPOS_MOVIMIENTO)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = cfg.nombre;
    selTipo.appendChild(opt);
  }

  poblarSelect(el('mov-establecimiento-origen'), ESTABLECIMIENTOS, { placeholder: 'Elegir...' });
  poblarSelect(el('mov-establecimiento-destino'), ESTABLECIMIENTOS, { placeholder: 'Elegir...' });
  poblarSelect(el('mov-categoria-origen'), CATEGORIAS, { placeholder: 'Elegir...' });
  poblarSelect(el('mov-categoria-destino'), CATEGORIAS, { placeholder: 'Elegir...' });
}

function actualizarCamposVisibles() {
  const tipo = el('mov-tipo').value;
  const cfg = TIPOS_MOVIMIENTO[tipo];
  for (const campo of CAMPOS) {
    const contenedor = document.querySelector(`[data-campo="${campo}"]`);
    const visible = cfg.campos.includes(campo);
    contenedor.classList.toggle('oculto', !visible);
    contenedor.querySelector('select').required = visible;
  }

  const selCategoriaDestino = el('mov-categoria-destino');
  if (cfg.categoriasPermitidas) {
    poblarSelect(
      selCategoriaDestino,
      CATEGORIAS.filter((c) => cfg.categoriasPermitidas.includes(c.id)),
      { placeholder: 'Elegir...' }
    );
  } else if (selCategoriaDestino.options.length !== CATEGORIAS.length + 1) {
    poblarSelect(selCategoriaDestino, CATEGORIAS, { placeholder: 'Elegir...' });
  }
}

function activarAccesoRapidoFeedLot() {
  el('mov-feedlot').addEventListener('click', () => {
    el('mov-tipo').value = 'traslado';
    actualizarCamposVisibles();
    el('mov-establecimiento-destino').value = 'feed_lot';
  });
}

function leerFormulario() {
  const tipo = el('mov-tipo').value;
  const cfg = TIPOS_MOVIMIENTO[tipo];
  return {
    tipo,
    cfg,
    fecha: el('mov-fecha').value,
    establecimiento_origen: cfg.campos.includes('establecimiento_origen') ? el('mov-establecimiento-origen').value : null,
    establecimiento_destino: cfg.campos.includes('establecimiento_destino') ? el('mov-establecimiento-destino').value : null,
    categoria_origen: cfg.campos.includes('categoria_origen') ? el('mov-categoria-origen').value : null,
    categoria_destino: cfg.campos.includes('categoria_destino') ? el('mov-categoria-destino').value : null,
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
  el('mov-form').reset();
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  actualizarCamposVisibles();
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
  poblarSelects();
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  el('mov-tipo').addEventListener('change', actualizarCamposVisibles);
  actualizarCamposVisibles();
  activarAccesoRapidoFeedLot();
  el('mov-form').addEventListener('submit', onSubmit);
}
