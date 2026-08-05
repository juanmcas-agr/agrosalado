import {
  TIPOS_MOVIMIENTO, ESTABLECIMIENTOS, CATEGORIAS,
  KILOS_MIN_SANIDAD, KILOS_MAX_SANIDAD,
} from './config.js';
import { encolarMovimiento } from './sync.js';
import { getEstado } from './auth.js';
import { cargarTitulares, obtenerTitularesCache, crearCapitalizador } from './titulares.js';
import { crearGrupoBotones, obtenerSeleccion, establecerSeleccion, limpiarSeleccion } from './botones.js';

const CAMPOS = [
  'establecimiento_origen', 'establecimiento_destino',
  'categoria_origen', 'categoria_destino',
  'titular_origen', 'titular_destino',
];

function el(id) {
  return document.getElementById(id);
}

function aplicarBloqueoAperturaStock() {
  const boton = document.querySelector('#mov-tipo .boton-opcion[data-value="apertura_stock"]');
  if (!boton) return;
  const rol = getEstado().perfil?.rol;
  if (rol !== 'owner') {
    boton.disabled = true;
    boton.classList.add('deshabilitado');
    boton.title = 'Solo un owner puede cargar una apertura de stock';
  }
}

// ─── titularidad: Agro Salado / Doña Julia / Capitalizador (+ lista) ───

function poblarSelectCapitalizadores(idSelect) {
  const select = el(idSelect);
  const valorPrevio = select.value;
  select.innerHTML = '';
  const opcionVacia = document.createElement('option');
  opcionVacia.value = '';
  opcionVacia.textContent = 'Elegir...';
  select.appendChild(opcionVacia);
  for (const c of obtenerTitularesCache().filter((t) => t.tipo === 'capitalizador')) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre;
    select.appendChild(opt);
  }
  const opcionNueva = document.createElement('option');
  opcionNueva.value = '__nuevo__';
  opcionNueva.textContent = '+ Agregar nuevo...';
  select.appendChild(opcionNueva);
  if (valorPrevio) select.value = valorPrevio;
}

function inicializarTitular(prefijo) {
  const idTipo = `mov-titular-${prefijo}-tipo`;
  const idSelectWrap = `mov-titular-${prefijo}-cap-wrap`;
  const idSelect = `mov-titular-${prefijo}-cap`;

  crearGrupoBotones(idTipo, [
    { id: 'agro_salado', nombre: 'Agro Salado' },
    { id: 'dona_julia', nombre: 'Doña Julia' },
    { id: 'capitalizador', nombre: 'Capitalizador' },
  ]);
  poblarSelectCapitalizadores(idSelect);

  el(idTipo).addEventListener('cambio', () => {
    const tipo = obtenerSeleccion(idTipo);
    el(idSelectWrap).classList.toggle('oculto', tipo !== 'capitalizador');
  });

  el(idSelect).addEventListener('change', async () => {
    const select = el(idSelect);
    if (select.value !== '__nuevo__') return;
    const nombre = prompt('Nombre del nuevo capitalizador:');
    if (!nombre || !nombre.trim()) {
      select.value = '';
      return;
    }
    try {
      const nuevo = await crearCapitalizador(nombre.trim());
      poblarSelectCapitalizadores(idSelect);
      select.value = nuevo.id;
    } catch (error) {
      alert('No se pudo crear el capitalizador: ' + error.message);
      select.value = '';
    }
  });
}

function obtenerTitular(prefijo) {
  const tipo = obtenerSeleccion(`mov-titular-${prefijo}-tipo`);
  if (!tipo) return '';
  if (tipo === 'capitalizador') {
    const valor = el(`mov-titular-${prefijo}-cap`).value;
    return valor && valor !== '__nuevo__' ? valor : '';
  }
  return tipo;
}

function limpiarTitular(prefijo) {
  limpiarSeleccion(`mov-titular-${prefijo}-tipo`);
  el(`mov-titular-${prefijo}-cap-wrap`).classList.add('oculto');
  el(`mov-titular-${prefijo}-cap`).value = '';
}

// ─── formulario ───

function poblarGrupos() {
  crearGrupoBotones('mov-tipo', Object.entries(TIPOS_MOVIMIENTO).map(([id, cfg]) => ({ id, nombre: cfg.nombre })));
  aplicarBloqueoAperturaStock();
  crearGrupoBotones('mov-establecimiento-origen', ESTABLECIMIENTOS);
  crearGrupoBotones('mov-establecimiento-destino', ESTABLECIMIENTOS);
  crearGrupoBotones('mov-categoria-origen', CATEGORIAS);
  crearGrupoBotones('mov-categoria-destino', CATEGORIAS);
  inicializarTitular('origen');
  inicializarTitular('destino');
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
    titular_origen: cfg.campos.includes('titular_origen') ? obtenerTitular('origen') : null,
    titular_destino: cfg.campos.includes('titular_destino') ? obtenerTitular('destino') : null,
    cantidad_cabezas: el('mov-cabezas').value,
    kilos_promedio: el('mov-kilos').value,
    rodeo: el('mov-rodeo').value.trim() || null,
    observaciones: el('mov-observaciones').value.trim() || null,
  };
}

function validar(datos) {
  const errores = [];
  const advertencias = [];

  if (datos.cfg.soloOwner && getEstado().perfil?.rol !== 'owner') {
    errores.push('Solo un owner puede cargar este tipo de movimiento.');
  }

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
  if (datos.tipo === 'cambio_titular' && datos.titular_origen === datos.titular_destino) {
    errores.push('En un cambio de titularidad, la titularidad de origen y destino deben ser distintas.');
  }

  return { errores, advertencias };
}

function armarFila(datos) {
  const { cfg } = datos;
  let categoria_destino = datos.categoria_destino;
  let establecimiento_destino = datos.establecimiento_destino;
  let titular_destino = datos.titular_destino;
  if (cfg.duplicarCategoriaEnDestino) categoria_destino = datos.categoria_origen;
  if (cfg.duplicarEstablecimientoEnDestino) establecimiento_destino = datos.establecimiento_origen;
  if (cfg.duplicarTitularEnDestino) titular_destino = datos.titular_origen;

  return {
    id: crypto.randomUUID(),
    tipo_movimiento: datos.tipo,
    fecha: datos.fecha,
    establecimiento_origen: datos.establecimiento_origen || null,
    establecimiento_destino: establecimiento_destino || null,
    categoria_origen: datos.categoria_origen || null,
    categoria_destino: categoria_destino || null,
    titular_origen: datos.titular_origen || null,
    titular_destino: titular_destino || null,
    cantidad_cabezas: Number(datos.cantidad_cabezas),
    kilos_promedio: Number(datos.kilos_promedio),
    usuario_id: getEstado().session.user.id,
    rodeo: datos.rodeo,
    observaciones: datos.observaciones,
  };
}

function primerTipoPermitido() {
  const rol = getEstado().perfil?.rol;
  return Object.entries(TIPOS_MOVIMIENTO).find(([, cfg]) => !cfg.soloOwner || rol === 'owner')[0];
}

function mostrarMensaje(texto, tipo) {
  const contenedor = el('mov-mensaje');
  contenedor.textContent = texto;
  contenedor.className = tipo; // 'error' | 'ok' | 'advertencia'
}

function resetFormulario() {
  el('mov-cabezas').value = '';
  el('mov-kilos').value = '';
  el('mov-rodeo').value = '';
  el('mov-observaciones').value = '';
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('mov-establecimiento-origen');
  limpiarSeleccion('mov-establecimiento-destino');
  limpiarSeleccion('mov-categoria-origen');
  limpiarTitular('origen');
  limpiarTitular('destino');
  establecerSeleccion('mov-tipo', primerTipoPermitido());
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

export async function initMovimientos() {
  await cargarTitulares();
  poblarGrupos();
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  el('mov-tipo').addEventListener('cambio', actualizarCamposVisibles);
  establecerSeleccion('mov-tipo', primerTipoPermitido());
  activarAccesoRapidoFeedLot();
  el('mov-form').addEventListener('submit', onSubmit);
}
