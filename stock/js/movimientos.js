import {
  TIPOS_MOVIMIENTO, ESTABLECIMIENTOS, CATEGORIAS,
  KILOS_MIN_SANIDAD, KILOS_MAX_SANIDAD,
} from './config.js';
import { encolarMovimiento } from './sync.js';
import { getEstado } from './auth.js';
import { cargarTitulares, obtenerTitularesCache, crearCapitalizador } from './titulares.js';
import { cargarRodeos, rodeosDe, crearRodeo, stockDelRodeo, titularesDelRodeo, registrarEntradaFeedLot, registrarSalidaFeedLot } from './rodeos.js';
import { marcarComoReemplazado } from './historial.js';
import { crearGrupoBotones, obtenerSeleccion, establecerSeleccion, limpiarSeleccion } from './botones.js';

// Id del movimiento que se está corrigiendo, o null en carga normal — ver
// precargarParaEditar() (disparado desde historial.js vía evento, para no
// armar un import circular entre los dos módulos).
let editandoId = null;

const CAMPOS = [
  'establecimiento_origen', 'establecimiento_destino',
  'categoria_origen', 'categoria_destino',
  'titular_origen', 'titular_destino',
  'rodeo_destino',
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

// Para precargar el formulario al editar: reconstruye la selección
// tipo+capitalizador a partir de un titular_id ya resuelto.
function precargarTitular(prefijo, titularId) {
  if (!titularId) { limpiarTitular(prefijo); return; }
  const esBase = titularId === 'agro_salado' || titularId === 'dona_julia';
  establecerSeleccion(`mov-titular-${prefijo}-tipo`, esBase ? titularId : 'capitalizador');
  if (!esBase) {
    el(`mov-titular-${prefijo}-cap-wrap`).classList.remove('oculto');
    el(`mov-titular-${prefijo}-cap`).value = titularId;
  }
}

// El rodeo de origen ya tiene cabezas de titulares puntuales — no tiene
// sentido dejar elegir una titularidad de origen que ese rodeo ni
// siquiera tiene (ej. rodeo con AS + DJ, no debería poder elegirse un
// capitalizador). Se nublan (deshabilitan) las opciones que no
// corresponden, best-effort: si falla la consulta (sin conexión) se
// deja todo habilitado como hasta ahora, no bloquea la carga.
async function actualizarTitularesOrigenDisponibles() {
  const grupo = el('mov-titular-origen-tipo');
  const capSelect = el('mov-titular-origen-cap');
  const habilitarTodo = () => {
    grupo.querySelectorAll('.boton-opcion').forEach((b) => { b.disabled = false; b.classList.remove('deshabilitado'); });
    [...capSelect.options].forEach((o) => { o.disabled = false; });
  };

  const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
  const rodeoId = el(RODEO_ORIGEN_IDS.select).value;
  if (!cfg || !cfg.campos.includes('titular_origen') || !rodeoId || rodeoId === '__nuevo__' || !navigator.onLine) {
    habilitarTodo();
    return;
  }

  let disponibles;
  try {
    disponibles = await titularesDelRodeo(rodeoId);
  } catch (error) {
    console.warn('No se pudo verificar qué titulares tiene ese rodeo:', error);
    habilitarTodo();
    return;
  }

  grupo.querySelectorAll('.boton-opcion').forEach((boton) => {
    const valor = boton.dataset.value;
    const activo = valor === 'capitalizador'
      ? [...capSelect.options].some((o) => o.value && o.value !== '__nuevo__' && disponibles.has(o.value))
      : disponibles.has(valor);
    boton.disabled = !activo;
    boton.classList.toggle('deshabilitado', !activo);
    if (!activo && boton.classList.contains('seleccionado')) {
      boton.classList.remove('seleccionado');
      grupo.dispatchEvent(new Event('cambio'));
    }
  });
  [...capSelect.options].forEach((opcion) => {
    if (!opcion.value || opcion.value === '__nuevo__') return;
    opcion.disabled = !disponibles.has(opcion.value);
  });
}

// ─── rodeo: obligatorio, se filtra por la categoría/establecimiento
// "relevante" del tipo de movimiento actual ───

// Para la mayoría de los tipos solo hay un lado (origen O destino) por
// campo; para los que tienen los dos (traslado, cambio_categoria,
// cambio_titular) el rodeo se identifica por el lado ORIGEN, porque es
// el rodeo que ya existe y se está moviendo/modificando — el destino se
// duplica del origen (ver duplicar*EnDestino en config.js).
function campoRelevante(cfg, base) {
  return cfg.campos.includes(`${base}_origen`) ? 'origen' : 'destino';
}

// IDs de los dos selectores de rodeo posibles — "origen" (siempre visible,
// el rodeo que ya existe) y "destino" (solo para cambio_rodeo: separar/
// fusionar animales en OTRO rodeo). Mismos ids que usaba el selector único
// original para no tener que tocar el resto del formulario.
const RODEO_ORIGEN_IDS = {
  select: 'mov-rodeo', wrap: 'mov-rodeo-nuevo-wrap',
  nombre: 'mov-rodeo-nuevo-nombre', fecha: 'mov-rodeo-nuevo-fecha', crear: 'mov-rodeo-nuevo-crear',
};
const RODEO_DESTINO_IDS = {
  select: 'mov-rodeo-destino', wrap: 'mov-rodeo-destino-nuevo-wrap',
  nombre: 'mov-rodeo-destino-nuevo-nombre', fecha: 'mov-rodeo-destino-nuevo-fecha', crear: 'mov-rodeo-destino-nuevo-crear',
};

// Para el rodeo destino, si el tipo tiene un establecimiento_destino
// REAL (no duplicado del origen — hoy solo cambio_rodeo), el rodeo se
// filtra por ESE establecimiento, no por el de origen: el rodeo destino
// puede estar en otro establecimiento.
function establecimientoParaRodeo(cfg, ids) {
  if (ids === RODEO_DESTINO_IDS && cfg.campos.includes('establecimiento_destino')) {
    return obtenerSeleccion('mov-establecimiento-destino');
  }
  return obtenerSeleccion(`mov-establecimiento-${campoRelevante(cfg, 'establecimiento')}`);
}

function poblarSelectRodeo(ids, excluirId) {
  const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
  if (!cfg) return;
  const categoriaId = obtenerSeleccion(`mov-categoria-${campoRelevante(cfg, 'categoria')}`);
  const establecimientoId = establecimientoParaRodeo(cfg, ids);

  const select = el(ids.select);
  const valorPrevio = select.value;
  select.innerHTML = '';
  const opcionVacia = document.createElement('option');
  opcionVacia.value = '';
  opcionVacia.textContent = 'Elegir...';
  select.appendChild(opcionVacia);

  if (categoriaId && establecimientoId) {
    for (const r of rodeosDe(establecimientoId, categoriaId)) {
      if (excluirId && r.id === excluirId) continue;
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.codigo;
      select.appendChild(opt);
    }
  }
  const opcionNueva = document.createElement('option');
  opcionNueva.value = '__nuevo__';
  opcionNueva.textContent = '+ Crear rodeo nuevo...';
  select.appendChild(opcionNueva);

  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

// El rodeo destino nunca puede ser el mismo que el de origen — se re-arma
// cada vez que cambia cualquiera de los dos, para excluir siempre el actual.
function actualizarSelectsRodeo() {
  poblarSelectRodeo(RODEO_ORIGEN_IDS, null);
  const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
  if (cfg && cfg.campos.includes('rodeo_destino')) {
    poblarSelectRodeo(RODEO_DESTINO_IDS, el(RODEO_ORIGEN_IDS.select).value);
  }
}

function inicializarSelectorRodeo(ids) {
  el(ids.select).addEventListener('change', () => {
    const esNuevo = el(ids.select).value === '__nuevo__';
    el(ids.wrap).classList.toggle('oculto', !esNuevo);
    if (esNuevo) el(ids.fecha).value = new Date().toISOString().slice(0, 10);
    if (ids === RODEO_ORIGEN_IDS) {
      poblarSelectRodeo(RODEO_DESTINO_IDS, el(ids.select).value);
      actualizarTitularesOrigenDisponibles();
    }
  });

  el(ids.crear).addEventListener('click', async () => {
    const nombre = el(ids.nombre).value.trim();
    if (!nombre) { alert('Ingresá un nombre para el rodeo.'); return; }
    const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
    const categoriaId = obtenerSeleccion(`mov-categoria-${campoRelevante(cfg, 'categoria')}`);
    const establecimientoId = establecimientoParaRodeo(cfg, ids);
    if (!categoriaId || !establecimientoId) {
      alert('Elegí primero categoría y establecimiento para poder crear el rodeo.');
      return;
    }
    try {
      const nuevo = await crearRodeo({
        nombre,
        categoriaId,
        establecimientoId,
        fechaCreacion: el(ids.fecha).value || undefined,
        usuarioId: getEstado().session.user.id,
      });
      actualizarSelectsRodeo();
      el(ids.select).value = nuevo.id;
      el(ids.wrap).classList.add('oculto');
      el(ids.nombre).value = '';
    } catch (error) {
      alert('No se pudo crear el rodeo: ' + error.message);
    }
  });
}

// En un traslado, origen y destino nunca pueden ser el mismo
// establecimiento — en vez de dejar clickear y recién avisar al guardar,
// se nubla (deshabilita) la opción de destino que coincide con el
// origen elegido. No aplica a cambio_rodeo, que si puede compartir
// establecimiento (mover animales de un rodeo a otro sin cambiar de
// campo).
function actualizarEstablecimientosDestinoDisponibles() {
  const tipo = obtenerSeleccion('mov-tipo');
  const origenId = tipo === 'traslado' ? obtenerSeleccion('mov-establecimiento-origen') : '';
  el('mov-establecimiento-destino').querySelectorAll('.boton-opcion').forEach((boton) => {
    const excluir = !!origenId && boton.dataset.value === origenId;
    boton.disabled = excluir;
    boton.classList.toggle('deshabilitado', excluir);
    if (excluir && boton.classList.contains('seleccionado')) {
      boton.classList.remove('seleccionado');
      el('mov-establecimiento-destino').dispatchEvent(new Event('cambio'));
    }
  });
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
  crearGrupoBotones('mov-feedlot-corral', [
    { id: '1', nombre: 'Corral 1' }, { id: '2', nombre: 'Corral 2' },
    { id: '3', nombre: 'Corral 3' }, { id: '4', nombre: 'Corral 4' },
  ]);
}

// ─── Feed lot: corral + ciclo (fecha estimada de salida, kilos objetivo) ───
// Entrada = traslado QUE LLEVA a feed_lot (desde otro lado); salida =
// traslado que SACA de feed_lot, o cualquier venta/faena/mortandad cuyo
// origen es feed_lot. Para 'traslado' el establecimiento_destino es un
// campo elegido directo (no duplicado), así que se puede leer en vivo acá
// sin esperar a armarFila().
const TIPOS_SALIDA_STOCK = ['venta_gordo', 'venta_vaca_prenada', 'venta_invernada', 'faena_conserva', 'mortandad'];

function calcularEstadoFeedLot() {
  const tipo = obtenerSeleccion('mov-tipo');
  const cfg = TIPOS_MOVIMIENTO[tipo];
  if (!cfg) return { entrada: false, salida: false };
  const origen = cfg.campos.includes('establecimiento_origen') ? obtenerSeleccion('mov-establecimiento-origen') : null;
  const destino = cfg.campos.includes('establecimiento_destino') ? obtenerSeleccion('mov-establecimiento-destino') : null;
  const entrada = tipo === 'traslado' && destino === 'feed_lot' && origen !== 'feed_lot';
  const salida =
    (tipo === 'traslado' && origen === 'feed_lot' && destino !== 'feed_lot') ||
    (TIPOS_SALIDA_STOCK.includes(tipo) && origen === 'feed_lot');
  return { entrada, salida };
}

function actualizarBloqueFeedLot() {
  const { entrada } = calcularEstadoFeedLot();
  el('mov-feedlot-entrada').classList.toggle('oculto', !entrada);
}

function actualizarCamposVisibles() {
  const tipo = obtenerSeleccion('mov-tipo');
  if (!tipo) return;
  const cfg = TIPOS_MOVIMIENTO[tipo];

  for (const campo of CAMPOS) {
    const contenedor = document.querySelector(`[data-campo="${campo}"]`);
    contenedor.classList.toggle('oculto', !cfg.campos.includes(campo));
  }
  // mov-rodeo-destino es "required" en el HTML, pero solo corresponde para
  // los tipos que lo usan (cambio_rodeo) — si queda required mientras su
  // contenedor está oculto, el navegador bloquea el submit en SILENCIO
  // (sin mensaje visible) para cualquier otro tipo de movimiento.
  el('mov-rodeo-destino').required = cfg.campos.includes('rodeo_destino');

  // Siempre se reconstruye para que quede sin selección al cambiar de tipo
  // (evita arrastrar una categoría elegida que ya no corresponde).
  crearGrupoBotones(
    'mov-categoria-destino',
    cfg.categoriasPermitidas ? CATEGORIAS.filter((c) => cfg.categoriasPermitidas.includes(c.id)) : CATEGORIAS
  );
  actualizarSelectsRodeo();
  actualizarBloqueFeedLot();
  actualizarEstablecimientosDestinoDisponibles();
  actualizarTitularesOrigenDisponibles();
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
    rodeo_id: el('mov-rodeo').value,
    rodeo_destino: cfg.campos.includes('rodeo_destino') ? el('mov-rodeo-destino').value : null,
    observaciones: el('mov-observaciones').value.trim() || null,
    feedlotEntrada: calcularEstadoFeedLot().entrada,
    feedlotSalida: calcularEstadoFeedLot().salida,
    feedlotCorral: obtenerSeleccion('mov-feedlot-corral'),
    feedlotKilosEntrada: el('mov-feedlot-kilos-entrada').value || null,
    feedlotFechaSalida: el('mov-feedlot-fecha-salida').value || null,
    feedlotKilosObjetivo: el('mov-feedlot-kilos-objetivo').value || null,
    editandoId,
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

  if (!datos.rodeo_id || datos.rodeo_id === '__nuevo__') {
    errores.push('Elegí un rodeo (o creá uno nuevo con "+ Crear rodeo nuevo...").');
  }
  if (datos.cfg.campos.includes('rodeo_destino')) {
    if (datos.rodeo_destino === '__nuevo__') {
      errores.push('Terminá de crear el rodeo destino (o elegí uno existente).');
    } else if (datos.rodeo_destino && datos.rodeo_destino === datos.rodeo_id) {
      errores.push('El rodeo destino tiene que ser distinto del rodeo de origen.');
    }
  }

  if (datos.feedlotEntrada && !datos.feedlotCorral) {
    errores.push('Elegí a qué corral entra el rodeo en feed lot.');
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
    rodeo_id: datos.rodeo_id,
    rodeo_destino_id: datos.rodeo_destino || null,
    observaciones: datos.observaciones,
    editado_de: datos.editandoId || null,
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

let toastTimer = null;
function mostrarToast(texto, duracionMs) {
  const toast = el('toast');
  toast.textContent = texto;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), duracionMs || 3000);
}

function resetFormulario() {
  el('mov-cabezas').value = '';
  el('mov-kilos').value = '';
  el('mov-observaciones').value = '';
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('mov-establecimiento-origen');
  limpiarSeleccion('mov-establecimiento-destino');
  limpiarSeleccion('mov-categoria-origen');
  limpiarTitular('origen');
  limpiarTitular('destino');
  el('mov-rodeo-nuevo-wrap').classList.add('oculto');
  el('mov-rodeo-nuevo-nombre').value = '';
  el('mov-rodeo-destino-nuevo-wrap').classList.add('oculto');
  el('mov-rodeo-destino-nuevo-nombre').value = '';
  limpiarSeleccion('mov-feedlot-corral');
  el('mov-feedlot-kilos-entrada').value = '';
  el('mov-feedlot-fecha-salida').value = '';
  el('mov-feedlot-kilos-objetivo').value = '';
  // establecerSeleccion dispara 'cambio' -> actualizarCamposVisibles() ->
  // actualizarSelectsRodeo()/actualizarBloqueFeedLot(), que ya reconstruyen
  // los selects vacíos y ocultan el bloque de feed lot.
  establecerSeleccion('mov-tipo', primerTipoPermitido());
}

function cancelarEdicion() {
  editandoId = null;
  el('mov-editando-aviso').classList.add('oculto');
  el('mov-submit').textContent = 'Guardar movimiento';
  resetFormulario();
}

// Precarga el formulario con los datos de un movimiento del historial para
// corregirlo — el tipo se elige primero porque dispara
// actualizarCamposVisibles() (reconstruye categoría-destino, selects de
// rodeo y bloque de feed lot), recién después tiene sentido setear el
// resto de los campos que dependen de eso.
function precargarParaEditar(fila) {
  editandoId = fila.id;
  establecerSeleccion('mov-tipo', fila.tipo_movimiento);
  if (fila.establecimiento_origen) establecerSeleccion('mov-establecimiento-origen', fila.establecimiento_origen);
  if (fila.establecimiento_destino) establecerSeleccion('mov-establecimiento-destino', fila.establecimiento_destino);
  if (fila.categoria_origen) establecerSeleccion('mov-categoria-origen', fila.categoria_origen);
  if (fila.categoria_destino) establecerSeleccion('mov-categoria-destino', fila.categoria_destino);
  precargarTitular('origen', fila.titular_origen);
  precargarTitular('destino', fila.titular_destino);
  el('mov-cabezas').value = fila.cantidad_cabezas;
  el('mov-kilos').value = fila.kilos_promedio;
  el('mov-fecha').value = fila.fecha;
  el('mov-observaciones').value = fila.observaciones || '';
  actualizarSelectsRodeo();
  if (fila.rodeo_id) el('mov-rodeo').value = fila.rodeo_id;
  if (fila.rodeo_destino_id) el('mov-rodeo-destino').value = fila.rodeo_destino_id;
  actualizarTitularesOrigenDisponibles();

  el('mov-editando-texto').textContent =
    `✏️ Corrigiendo el movimiento del ${fila.fecha} (${fila.tipo_movimiento_nombre}). Al guardar, el original queda tachado en el historial como "Editado".`;
  el('mov-editando-aviso').classList.remove('oculto');
  el('mov-submit').textContent = 'Guardar corrección';
  location.hash = 'cargar';
}

// Precarga "Cargar movimiento" con tipo Mortandad para resolver una
// diferencia pendiente de Trabajo de Manga (pedido desde el botón
// "Cargar movimiento que lo explica" — ver trabajoManga.js). Deja la
// cantidad como punto de partida, no como definitiva: el usuario la
// puede ajustar antes de guardar.
function precargarParaMortandad({ establecimientoId, categoriaId, rodeoId, cantidad }) {
  establecerSeleccion('mov-tipo', 'mortandad');
  if (establecimientoId) establecerSeleccion('mov-establecimiento-origen', establecimientoId);
  if (categoriaId) establecerSeleccion('mov-categoria-origen', categoriaId);
  actualizarSelectsRodeo();
  if (rodeoId) el('mov-rodeo').value = rodeoId;
  actualizarTitularesOrigenDisponibles();
  if (cantidad) el('mov-cabezas').value = cantidad;
  location.hash = 'cargar';
}

// Salida/interna sacan cabezas del rodeo de origen — no puede haber más
// saliendo que las que tiene. Solo se puede chequear con conexión (pide el
// stock real a Supabase); si está offline se deja pasar como hasta ahora
// (la app es offline-first) y si el chequeo mismo falla por red no se
// bloquea el movimiento por eso — solo cuando el chequeo SÍ pudo hacerse y
// da que no alcanza.
async function validarStockDisponible(datos) {
  if (datos.cfg.clase === 'entrada') return null;
  if (!navigator.onLine) return null;
  let disponible;
  try {
    disponible = await stockDelRodeo(datos.rodeo_id);
  } catch (error) {
    console.warn('No se pudo verificar el stock del rodeo antes de guardar:', error);
    return null;
  }
  const cabezas = Number(datos.cantidad_cabezas);
  if (cabezas > disponible) {
    return `No hay stock suficiente en ese rodeo: tiene ${disponible} cabeza(s) y se intentan mover ${cabezas}.`;
  }
  return null;
}

async function onSubmit(evento) {
  evento.preventDefault();
  const datos = leerFormulario();
  const { errores, advertencias } = validar(datos);

  if (errores.length) {
    mostrarMensaje(errores.join(' '), 'error');
    return;
  }

  // Guardar una corrección exige conexión: además de encolar el movimiento
  // nuevo, hay que marcar el original como reemplazado con un UPDATE en
  // vivo (no pasa por el outbox) — mismo criterio que anular.
  if (datos.editandoId && !navigator.onLine) {
    mostrarMensaje('Necesitás conexión a internet para guardar una corrección.', 'error');
    return;
  }

  const errorStock = await validarStockDisponible(datos);
  if (errorStock) {
    mostrarMensaje(errorStock, 'error');
    return;
  }

  const fila = armarFila(datos);
  await encolarMovimiento(fila);

  // Best-effort: el movimiento en sí ya quedó guardado (offline-first vía
  // outbox); el corral/ciclo de feed lot es metadata complementaria, no
  // bloquea ni se reintenta si falla (ej. sin conexión en este instante).
  if (datos.feedlotEntrada) {
    try {
      await registrarEntradaFeedLot({
        rodeoId: datos.rodeo_id,
        corral: datos.feedlotCorral,
        fecha: datos.fecha,
        kilosIngreso: Number(datos.feedlotKilosEntrada || datos.kilos_promedio),
        fechaEstimadaSalida: datos.feedlotFechaSalida,
        kilosSalidaObjetivo: datos.feedlotKilosObjetivo,
      });
    } catch (error) {
      console.warn('No se pudo registrar la entrada a feed lot:', error);
    }
  } else if (datos.feedlotSalida) {
    try {
      await registrarSalidaFeedLot({ rodeoId: datos.rodeo_id, fecha: datos.fecha, kilosSalida: Number(datos.kilos_promedio) });
    } catch (error) {
      console.warn('No se pudo registrar la salida de feed lot:', error);
    }
  }

  if (datos.editandoId) {
    try {
      await marcarComoReemplazado(datos.editandoId, fila.id);
    } catch (error) {
      mostrarMensaje(
        `La corrección se guardó, pero no se pudo marcar el movimiento original como reemplazado: ${error.message}. Avisá para resolverlo a mano.`,
        'advertencia'
      );
      cancelarEdicion();
      mostrarToast('✅ CORRECCIÓN REGISTRADA');
      return;
    }
  }

  mostrarToast(datos.editandoId ? '✅ CORRECCIÓN REGISTRADA' : '✅ MOVIMIENTO REGISTRADO');
  if (advertencias.length) {
    mostrarMensaje(`Se sincroniza automáticamente. (${advertencias.join(' ')})`, 'advertencia');
  } else {
    mostrarMensaje('', 'ok');
  }
  cancelarEdicion();
}

export async function initMovimientos() {
  await Promise.all([cargarTitulares(), cargarRodeos()]);
  poblarGrupos();
  inicializarSelectorRodeo(RODEO_ORIGEN_IDS);
  inicializarSelectorRodeo(RODEO_DESTINO_IDS);
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  el('mov-tipo').addEventListener('cambio', actualizarCamposVisibles);
  for (const id of ['mov-categoria-origen', 'mov-categoria-destino', 'mov-establecimiento-origen', 'mov-establecimiento-destino']) {
    el(id).addEventListener('cambio', () => { actualizarSelectsRodeo(); actualizarBloqueFeedLot(); });
  }
  el('mov-establecimiento-origen').addEventListener('cambio', actualizarEstablecimientosDestinoDisponibles);
  establecerSeleccion('mov-tipo', primerTipoPermitido());
  activarAccesoRapidoFeedLot();
  el('mov-form').addEventListener('submit', onSubmit);
  el('mov-editando-cancelar').addEventListener('click', cancelarEdicion);
  document.addEventListener('hacienda:editar-movimiento', (evento) => precargarParaEditar(evento.detail));
  document.addEventListener('hacienda:precargar-mortandad', (evento) => precargarParaMortandad(evento.detail));
}
