import {
  TIPOS_MOVIMIENTO, ESTABLECIMIENTOS, CATEGORIAS, SIGUIENTE_CATEGORIA, DESTINO_VENTA,
  KILOS_MIN_SANIDAD, KILOS_MAX_SANIDAD,
} from './config.js';
import { supabase } from './supabaseClient.js';
import { encolarMovimiento } from './sync.js';
import { getEstado } from './auth.js';
import { cargarTitulares, obtenerTitularesCache, crearCapitalizador, crearCliente } from './titulares.js';
import { cargarCompradores, obtenerCompradoresCache, crearComprador } from './compradores.js';
import { cargarRodeos, rodeosDe, crearRodeo, stockDelRodeo, titularesDelRodeo, registrarEntradaFeedLot, registrarSalidaFeedLot } from './rodeos.js';
import { marcarComoReemplazado } from './historial.js';
import { refrescarDiferenciasPendientes } from './trabajoManga.js';
import { crearGrupoBotones, obtenerSeleccion, establecerSeleccion, limpiarSeleccion } from './botones.js';

// Id del movimiento que se está corrigiendo, o null en carga normal — ver
// precargarParaEditar() (disparado desde historial.js vía evento, para no
// armar un import circular entre los dos módulos).
let editandoId = null;

// Para editar un movimiento 'hoteleria' (sinRodeo): no hay selector de
// Rodeo para volver a elegir, así que se guarda acá el rodeo_id del
// lote original y onSubmit() lo reusa en vez de crear un rodeo nuevo.
let rodeoIdEditandoSinRodeo = null;

const CAMPOS = [
  'establecimiento_origen', 'establecimiento_destino',
  'categoria_origen', 'categoria_destino',
  'titular_origen', 'titular_destino',
  'rodeo_destino', 'cliente',
  'destino_venta', 'comprador',
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

// ─── Cliente (Hotelería): lista aparte de titulares.tipo='cliente', no se
// mezcla con Agro Salado/Doña Julia/Capitalizador de arriba ───

function poblarSelectCliente() {
  const select = el('mov-cliente');
  const valorPrevio = select.value;
  select.innerHTML = '';
  const opcionVacia = document.createElement('option');
  opcionVacia.value = '';
  opcionVacia.textContent = 'Elegir...';
  select.appendChild(opcionVacia);
  for (const c of obtenerTitularesCache().filter((t) => t.tipo === 'cliente')) {
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

function inicializarCliente() {
  poblarSelectCliente();
  el('mov-cliente').addEventListener('change', async () => {
    const select = el('mov-cliente');
    if (select.value !== '__nuevo__') return;
    const nombre = prompt('Nombre del cliente:');
    if (!nombre || !nombre.trim()) {
      select.value = '';
      return;
    }
    try {
      const nuevo = await crearCliente(nombre.trim());
      poblarSelectCliente();
      select.value = nuevo.id;
    } catch (error) {
      alert('No se pudo crear el cliente: ' + error.message);
      select.value = '';
    }
  });
}

// Valor limpio del select de Cliente (nunca '__nuevo__', que es solo el
// disparador del alta on-the-fly).
function obtenerCliente() {
  const valor = el('mov-cliente').value;
  return valor && valor !== '__nuevo__' ? valor : '';
}

// ─── Comprador (Venta): trazabilidad de a quién se le vendió, no afecta
// stock ni titularidad — lista propia (compradores.js), mismo patrón
// "+ Agregar nuevo..." que Cliente/Capitalizador ───

function poblarSelectComprador() {
  const select = el('mov-comprador');
  const valorPrevio = select.value;
  select.innerHTML = '';
  const opcionVacia = document.createElement('option');
  opcionVacia.value = '';
  opcionVacia.textContent = 'Elegir...';
  select.appendChild(opcionVacia);
  for (const c of obtenerCompradoresCache()) {
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

function inicializarComprador() {
  poblarSelectComprador();
  el('mov-comprador').addEventListener('change', async () => {
    const select = el('mov-comprador');
    if (select.value !== '__nuevo__') return;
    const nombre = prompt('Nombre del comprador:');
    if (!nombre || !nombre.trim()) {
      select.value = '';
      return;
    }
    try {
      const nuevo = await crearComprador(nombre.trim());
      poblarSelectComprador();
      select.value = nuevo.id;
    } catch (error) {
      alert('No se pudo crear el comprador: ' + error.message);
      select.value = '';
    }
  });
}

function obtenerComprador() {
  const valor = el('mov-comprador').value;
  return valor && valor !== '__nuevo__' ? valor : '';
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
// puede estar en otro establecimiento. Hotelería/Salida de hotelería
// tienen el establecimiento FIJO (siempre feed_lot, sin selector).
function establecimientoParaRodeo(cfg, ids) {
  if (cfg.establecimientoOrigenFijo || cfg.establecimientoDestinoFijo) {
    return cfg.establecimientoOrigenFijo || cfg.establecimientoDestinoFijo;
  }
  if (ids === RODEO_DESTINO_IDS && cfg.campos.includes('establecimiento_destino')) {
    return obtenerSeleccion('mov-establecimiento-destino');
  }
  return obtenerSeleccion(`mov-establecimiento-${campoRelevante(cfg, 'establecimiento')}`);
}

function poblarSelectRodeo(ids, excluirId) {
  const tipo = obtenerSeleccion('mov-tipo');
  const cfg = TIPOS_MOVIMIENTO[tipo];
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
    for (const r of rodeosDe(establecimientoId, categoriaId, { soloHoteleria: Boolean(cfg.soloRodeosHoteleria) })) {
      if (excluirId && r.id === excluirId) continue;
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.codigo;
      select.appendChild(opt);
    }
  }
  // Un puestero no da de alta rodeos — solo puede elegir entre los que ya
  // existen. Salida de hotelería tampoco ofrece crear uno: solo se puede
  // cerrar un lote de hotelería que ya existe.
  if (getEstado().perfil?.rol !== 'puestero' && !cfg.soloRodeosHoteleria) {
    const opcionNueva = document.createElement('option');
    opcionNueva.value = '__nuevo__';
    opcionNueva.textContent = '+ Crear rodeo nuevo...';
    select.appendChild(opcionNueva);
  }

  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

// El rodeo destino nunca puede ser el mismo que el de origen — se re-arma
// cada vez que cambia cualquiera de los dos, para excluir siempre el actual.
function actualizarSelectsRodeo() {
  const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
  // Hotelería no tiene selector de rodeo — se crea uno solo al guardar
  // (ver onSubmit), no hace falta poblar nada.
  if (cfg && cfg.sinRodeo) return;
  poblarSelectRodeo(RODEO_ORIGEN_IDS, null);
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
// origen elegido. En cambio_rodeo es al revés: solo puede compartir
// establecimiento (mover animales de un rodeo a otro DENTRO del mismo
// campo; para cambiar de establecimiento existe "Traslado"), así que acá
// se fuerza el mismo valor que el origen y se nubla el resto.
function actualizarEstablecimientosDestinoDisponibles() {
  const tipo = obtenerSeleccion('mov-tipo');
  const esCambioRodeo = tipo === 'cambio_rodeo';
  const origenId = (tipo === 'traslado' || esCambioRodeo) ? obtenerSeleccion('mov-establecimiento-origen') : '';
  el('mov-establecimiento-destino').querySelectorAll('.boton-opcion').forEach((boton) => {
    if (!origenId) {
      boton.disabled = false;
      boton.classList.remove('deshabilitado');
      return;
    }
    const excluir = esCambioRodeo ? boton.dataset.value !== origenId : boton.dataset.value === origenId;
    boton.disabled = excluir;
    boton.classList.toggle('deshabilitado', excluir);
    if (excluir && boton.classList.contains('seleccionado')) {
      boton.classList.remove('seleccionado');
      el('mov-establecimiento-destino').dispatchEvent(new Event('cambio'));
    }
  });
  if (esCambioRodeo && origenId && obtenerSeleccion('mov-establecimiento-destino') !== origenId) {
    establecerSeleccion('mov-establecimiento-destino', origenId);
  }
}

// ─── formulario ───

// Un puestero carga datos pero con un subset acotado de tipos de
// movimiento — el resto (traslados, cambio de titular, ventas, compras,
// apertura de stock) queda para encargado/administrativo/owner. Cambio
// de rodeo entra en el subset porque no requiere crear un rodeo nuevo
// (elige entre los que ya existen en el mismo establecimiento).
const TIPOS_PUESTERO = ['paricion', 'mortandad', 'cambio_categoria', 'cambio_rodeo'];

function tiposVisibles() {
  const rol = getEstado().perfil?.rol;
  const entradas = Object.entries(TIPOS_MOVIMIENTO).filter(([, cfg]) => !cfg.oculto);
  return rol === 'puestero' ? entradas.filter(([id]) => TIPOS_PUESTERO.includes(id)) : entradas;
}

function poblarGrupos() {
  crearGrupoBotones('mov-tipo', tiposVisibles().map(([id, cfg]) => ({ id, nombre: cfg.nombre })));
  aplicarBloqueoAperturaStock();
  crearGrupoBotones('mov-establecimiento-origen', ESTABLECIMIENTOS);
  crearGrupoBotones('mov-establecimiento-destino', ESTABLECIMIENTOS);
  crearGrupoBotones('mov-categoria-origen', CATEGORIAS);
  crearGrupoBotones('mov-categoria-destino', CATEGORIAS);
  crearGrupoBotones('mov-destino-venta', DESTINO_VENTA);
  inicializarTitular('origen');
  inicializarTitular('destino');
  inicializarCliente();
  inicializarComprador();
  crearGrupoBotones('mov-feedlot-corral', [
    { id: '1', nombre: 'Corral 1' }, { id: '2', nombre: 'Corral 2' },
    { id: '3', nombre: 'Corral 3' }, { id: '4', nombre: 'Corral 4' },
  ]);
}

// ─── Consulta rápida de movimientos por establecimiento ────────────────
// Vive acá (pantalla "Cargar movimiento") y no en Historial porque un
// puestero no tiene acceso a Historial (ver router.js), pero sí a esta
// pantalla — es la única forma que tiene de corroborar, antes de cargar,
// que nadie más (ej. un encargado desde Historial) ya cargó ese mismo
// movimiento. Es de solo lectura, sin editar/anular.
function poblarSelectConsultaEstablecimiento() {
  const select = el('mov-consulta-establecimiento');
  select.innerHTML = '';
  for (const e of ESTABLECIMIENTOS) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nombre;
    select.appendChild(opt);
  }
  // El Tara por default: es el establecimiento donde surgió la necesidad
  // (carga por dos personas distintas, Ponce en el campo y Enriques desde
  // Historial) — cualquiera puede elegir otro con el selector.
  select.value = 'el_tara';
}

function itemConsulta(fila) {
  const categoria = fila.categoria_origen_nombre || fila.categoria_destino_nombre || '';
  const hora = fila.created_at ? new Date(fila.created_at).toLocaleString('es-AR') : '';
  const div = document.createElement('div');
  div.className = 'consulta-item';
  div.textContent =
    `${fila.fecha} — ${fila.tipo_movimiento_nombre}${categoria ? ' · ' + categoria : ''} · ${fila.cantidad_cabezas} cab.` +
    ` — cargado por ${fila.usuario_nombre || '—'} (${hora})`;
  return div;
}

export async function refrescarConsultaEstablecimiento() {
  const establecimientoId = el('mov-consulta-establecimiento')?.value;
  const contenedor = el('mov-consulta-lista');
  if (!establecimientoId || !contenedor) return;
  if (!navigator.onLine) {
    contenedor.innerHTML = '<div style="color:#666;">Sin conexión — no se puede consultar ahora.</div>';
    return;
  }
  contenedor.textContent = 'Cargando…';
  const { data, error } = await supabase
    .from('historial_movimientos')
    .select('*')
    .eq('anulado', false)
    .or(`establecimiento_origen.eq.${establecimientoId},establecimiento_destino.eq.${establecimientoId}`)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) {
    contenedor.innerHTML = `<div class="mensaje error">No se pudo consultar: ${error.message}</div>`;
    return;
  }
  contenedor.innerHTML = '';
  if (!data.length) {
    contenedor.innerHTML = '<div style="color:#666;">Sin movimientos cargados todavía en ese establecimiento.</div>';
    return;
  }
  for (const fila of data) contenedor.appendChild(itemConsulta(fila));
}

// ─── Feed lot: corral + ciclo (fecha estimada de salida, kilos objetivo) ───
// Entrada = traslado QUE LLEVA a feed_lot (desde otro lado); salida =
// traslado que SACA de feed_lot, o cualquier venta/faena/mortandad cuyo
// origen es feed_lot. Para 'traslado' el establecimiento_destino es un
// campo elegido directo (no duplicado), así que se puede leer en vivo acá
// sin esperar a armarFila().
// 'venta' (el tipo unificado, ver config.js) faltaba acá — sin esto, una
// venta con origen feed_lot nunca liberaba el corral/cerraba el ciclo.
const TIPOS_SALIDA_STOCK = ['venta', 'venta_gordo', 'venta_vaca_prenada', 'venta_invernada', 'faena_conserva', 'mortandad'];

function calcularEstadoFeedLot() {
  const tipo = obtenerSeleccion('mov-tipo');
  const cfg = TIPOS_MOVIMIENTO[tipo];
  if (!cfg) return { entrada: false, salida: false };
  const origen = cfg.campos.includes('establecimiento_origen') ? obtenerSeleccion('mov-establecimiento-origen') : null;
  const destino = cfg.campos.includes('establecimiento_destino') ? obtenerSeleccion('mov-establecimiento-destino') : null;
  // Hotelería/Salida de hotelería tienen el establecimiento fijo en
  // feed_lot (sin selector), así que entran/salen de corral siempre.
  const entrada = (tipo === 'traslado' && destino === 'feed_lot' && origen !== 'feed_lot') || tipo === 'hoteleria';
  const salida =
    (tipo === 'traslado' && origen === 'feed_lot' && destino !== 'feed_lot') ||
    (TIPOS_SALIDA_STOCK.includes(tipo) && origen === 'feed_lot') ||
    tipo === 'salida_hoteleria';
  return { entrada, salida };
}

function actualizarBloqueFeedLot() {
  const { entrada } = calcularEstadoFeedLot();
  el('mov-feedlot-entrada').classList.toggle('oculto', !entrada);
}

// A feed lot no hace falta elegir un rodeo destino aparte: las cabezas
// entran directo al corral (bloque de arriba), quedándose en el mismo
// rodeo de origen (ver registrarEntradaFeedLot/armarFila) — la excepción
// solo aplica a "Traslado", el único tipo que puede tener feed_lot como
// destino y a la vez pedir rodeo_destino.
function trasladoAFeedLot() {
  return obtenerSeleccion('mov-tipo') === 'traslado' && obtenerSeleccion('mov-establecimiento-destino') === 'feed_lot';
}

function actualizarRequeridoRodeoDestino() {
  const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
  if (!cfg) return;
  const aplica = cfg.campos.includes('rodeo_destino') && !trasladoAFeedLot();
  document.querySelector('[data-campo="rodeo_destino"]').classList.toggle('oculto', !aplica);
  el('mov-rodeo-destino').required = aplica;
}

// Hotelería no tiene selector de Rodeo (se crea uno solo al guardar) — se
// esconde el bloque entero, mismo criterio que mov-rodeo-destino de arriba.
function actualizarRequeridoRodeo() {
  const cfg = TIPOS_MOVIMIENTO[obtenerSeleccion('mov-tipo')];
  if (!cfg) return;
  document.querySelector('[data-campo="rodeo"]').classList.toggle('oculto', Boolean(cfg.sinRodeo));
  el('mov-rodeo').required = !cfg.sinRodeo;
}

const CATEGORIAS_AL_PIE = ['ternero_al_pie', 'ternera_al_pie'];

// Qué categorías puede tener mov-categoria-origen para el tipo actual:
// - Cambio de categoría: solo las que tienen un paso siguiente definido en
//   SIGUIENTE_CATEGORIA — novillo/toro/vaca son categorías terminales, no
//   tiene sentido elegirlas como origen de un cambio si no hay adónde ir.
// - Cualquier otro tipo (venta, mortandad, traslado, etc.): todas — ahí
//   categoria_origen es la categoría real del animal en el rodeo, no un
//   paso de la cadena. Traslado con destino Feed Lot tiene una restricción
//   aparte (ver actualizarCategoriasOrigenDisponibles) que nubla en vez de
//   reconstruir, para no perder la selección por tocar el establecimiento.
function opcionesCategoriaOrigen(tipo) {
  if (tipo === 'cambio_categoria') return CATEGORIAS.filter((c) => SIGUIENTE_CATEGORIA[c.id]);
  return CATEGORIAS;
}

// Traslado con destino Feed Lot: "al pie" no tiene sentido ahí (todavía
// están con la madre) — se nublan (deshabilitan) esas 2 opciones en vez de
// reconstruir el grupo entero, mismo criterio que
// actualizarEstablecimientosDestinoDisponibles/actualizarTitularesOrigenDisponibles,
// para no perder una selección válida solo por tocar el establecimiento.
function actualizarCategoriasOrigenDisponibles() {
  const bloquear = trasladoAFeedLot();
  const grupo = el('mov-categoria-origen');
  grupo.querySelectorAll('.boton-opcion').forEach((boton) => {
    const deshabilitar = bloquear && CATEGORIAS_AL_PIE.includes(boton.dataset.value);
    boton.disabled = deshabilitar;
    boton.classList.toggle('deshabilitado', deshabilitar);
    if (deshabilitar && boton.classList.contains('seleccionado')) {
      boton.classList.remove('seleccionado');
      grupo.dispatchEvent(new Event('cambio'));
    }
  });
}

// Qué categorías puede tener mov-categoria-destino para el tipo actual:
// - Si el tipo tiene categoriasPermitidas (Parición), solo esas.
// - Si es Cambio de categoría, la única "siguiente" definida en
//   SIGUIENTE_CATEGORIA para el origen elegido — no se puede saltar un
//   paso ni elegir cualquier categoría al voleo, para minimizar error de
//   carga (el origen ya está limitado a categorías con cadena definida,
//   ver opcionesCategoriaOrigen()).
// - Cualquier otro tipo: todas.
function opcionesCategoriaDestino(tipo) {
  const cfg = TIPOS_MOVIMIENTO[tipo];
  if (cfg.categoriasPermitidas) return CATEGORIAS.filter((c) => cfg.categoriasPermitidas.includes(c.id));
  if (tipo === 'cambio_categoria') {
    const origen = obtenerSeleccion('mov-categoria-origen');
    const siguienteId = SIGUIENTE_CATEGORIA[origen];
    if (siguienteId) return CATEGORIAS.filter((c) => c.id === siguienteId);
  }
  return CATEGORIAS;
}

// Sin tipo elegido: todos los campos que dependen de él quedan ocultos y
// sin exigir nada, para no bloquear el submit en silencio (ver onSubmit,
// que además corta antes con un mensaje visible si no se eligió tipo).
function ocultarCamposDependientesDeTipo() {
  for (const campo of CAMPOS) {
    document.querySelector(`[data-campo="${campo}"]`).classList.add('oculto');
  }
  document.querySelector('[data-campo="rodeo"]').classList.add('oculto');
  document.querySelector('[data-campo="rodeo_destino"]').classList.add('oculto');
  el('mov-cliente').required = false;
  el('mov-comprador').required = false;
  el('mov-rodeo').required = false;
  el('mov-rodeo-destino').required = false;
  el('mov-observaciones').required = false;
  el('mov-observaciones-label').textContent = 'Observaciones (opcional)';
  actualizarBloqueFeedLot();
}

function actualizarCamposVisibles() {
  const tipo = obtenerSeleccion('mov-tipo');
  if (!tipo) { ocultarCamposDependientesDeTipo(); return; }
  const cfg = TIPOS_MOVIMIENTO[tipo];

  for (const campo of CAMPOS) {
    const contenedor = document.querySelector(`[data-campo="${campo}"]`);
    contenedor.classList.toggle('oculto', !cfg.campos.includes(campo));
  }
  // mov-rodeo-destino es "required" en el HTML, pero solo corresponde para
  // los tipos que lo usan (y no a feed lot, ver trasladoAFeedLot) — si
  // queda required mientras su contenedor está oculto, el navegador
  // bloquea el submit en SILENCIO (sin mensaje visible) para cualquier
  // otro caso. Mismo motivo para mov-cliente/mov-comprador: son <select>
  // required en el HTML, pero solo corresponden a algunos tipos.
  actualizarRequeridoRodeoDestino();
  actualizarRequeridoRodeo();
  el('mov-cliente').required = cfg.campos.includes('cliente');
  el('mov-comprador').required = cfg.campos.includes('comprador');

  // Para Mortandad, las Observaciones dejan de ser opcionales: hay que
  // contar qué pasó (causa de la muerte) para que quede registrado.
  const esMortandad = tipo === 'mortandad';
  el('mov-observaciones').required = esMortandad;
  el('mov-observaciones-label').textContent = esMortandad
    ? 'Observaciones — obligatorio para Mortandad (contá qué pasó)'
    : 'Observaciones (opcional)';

  // Siempre se reconstruye para que quede sin selección al cambiar de tipo
  // (evita arrastrar una categoría elegida que ya no corresponde).
  crearGrupoBotones('mov-categoria-origen', opcionesCategoriaOrigen(tipo));
  crearGrupoBotones('mov-categoria-destino', opcionesCategoriaDestino(tipo));
  actualizarCategoriasOrigenDisponibles();
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
  // Cliente (Hotelería): reemplaza a Titularidad de origen/destino para
  // 'hoteleria'/'salida_hoteleria' — ver campos en config.js.
  const cliente = cfg.campos.includes('cliente') ? obtenerCliente() : null;
  return {
    tipo,
    cfg,
    fecha: el('mov-fecha').value,
    establecimiento_origen: cfg.establecimientoOrigenFijo
      || (cfg.campos.includes('establecimiento_origen') ? obtenerSeleccion('mov-establecimiento-origen') : null),
    establecimiento_destino: cfg.establecimientoDestinoFijo
      || (cfg.campos.includes('establecimiento_destino') ? obtenerSeleccion('mov-establecimiento-destino') : null),
    categoria_origen: cfg.campos.includes('categoria_origen') ? obtenerSeleccion('mov-categoria-origen') : null,
    categoria_destino: cfg.campos.includes('categoria_destino') ? obtenerSeleccion('mov-categoria-destino') : null,
    titular_origen: cfg.campos.includes('titular_origen') ? obtenerTitular('origen') : (tipo === 'salida_hoteleria' ? cliente : null),
    titular_destino: cfg.campos.includes('titular_destino') ? obtenerTitular('destino') : (tipo === 'hoteleria' ? cliente : null),
    cliente,
    destino_venta: cfg.campos.includes('destino_venta') ? obtenerSeleccion('mov-destino-venta') : null,
    comprador: cfg.campos.includes('comprador') ? obtenerComprador() : null,
    cantidad_cabezas: el('mov-cabezas').value,
    kilos_promedio: el('mov-kilos').value,
    rodeo_id: cfg.sinRodeo ? null : el('mov-rodeo').value,
    rodeo_destino: (cfg.campos.includes('rodeo_destino') && !trasladoAFeedLot()) ? el('mov-rodeo-destino').value : null,
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
    if (campo === 'rodeo_destino') continue; // se valida aparte, abajo (no aplica a un traslado a feed lot)
    if (!datos[campo]) errores.push('Falta completar un campo obligatorio.');
  }

  // Hotelería no elige rodeo — se crea uno solo al guardar (ver onSubmit).
  if (!datos.cfg.sinRodeo && (!datos.rodeo_id || datos.rodeo_id === '__nuevo__')) {
    errores.push('Elegí un rodeo (o creá uno nuevo con "+ Crear rodeo nuevo...").');
  }
  const esTrasladoAFeedLot = datos.tipo === 'traslado' && datos.establecimiento_destino === 'feed_lot';
  if (datos.cfg.campos.includes('rodeo_destino') && !esTrasladoAFeedLot) {
    if (!datos.rodeo_destino) {
      errores.push('Elegí un rodeo destino (o creá uno nuevo con "+ Crear rodeo nuevo...").');
    } else if (datos.rodeo_destino === '__nuevo__') {
      errores.push('Terminá de crear el rodeo destino (o elegí uno existente).');
    } else if (datos.rodeo_destino === datos.rodeo_id) {
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
  if (datos.tipo === 'cambio_rodeo' && datos.establecimiento_origen !== datos.establecimiento_destino) {
    errores.push('Un cambio de rodeo tiene que ser dentro del mismo establecimiento (para cambiar de establecimiento usá "Traslado").');
  }
  if (datos.tipo === 'cambio_categoria' && datos.categoria_origen === datos.categoria_destino) {
    errores.push('En un cambio de categoría, la categoría de origen y destino deben ser distintas.');
  }
  if (datos.tipo === 'cambio_titular' && datos.titular_origen === datos.titular_destino) {
    errores.push('En un cambio de titularidad, la titularidad de origen y destino deben ser distintas.');
  }
  if (datos.tipo === 'mortandad' && !datos.observaciones) {
    errores.push('Para Mortandad, las Observaciones son obligatorias (contá qué pasó).');
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
    destino_venta: datos.destino_venta || null,
    comprador_id: datos.comprador || null,
    editado_de: datos.editandoId || null,
  };
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
  rodeoIdEditandoSinRodeo = null;
  el('mov-cabezas').value = '';
  el('mov-kilos').value = '';
  el('mov-observaciones').value = '';
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('mov-establecimiento-origen');
  limpiarSeleccion('mov-establecimiento-destino');
  limpiarSeleccion('mov-categoria-origen');
  limpiarSeleccion('mov-destino-venta');
  limpiarTitular('origen');
  limpiarTitular('destino');
  el('mov-cliente').value = '';
  el('mov-comprador').value = '';
  el('mov-rodeo-nuevo-wrap').classList.add('oculto');
  el('mov-rodeo-nuevo-nombre').value = '';
  el('mov-rodeo-destino-nuevo-wrap').classList.add('oculto');
  el('mov-rodeo-destino-nuevo-nombre').value = '';
  limpiarSeleccion('mov-feedlot-corral');
  el('mov-feedlot-kilos-entrada').value = '';
  el('mov-feedlot-fecha-salida').value = '';
  el('mov-feedlot-kilos-objetivo').value = '';
  // Sin tipo preseleccionado a propósito: si quedara uno marcado por
  // defecto, es fácil no darse cuenta y cargar el movimiento equivocado
  // (venía pasando con "Compra de invernada"). limpiarSeleccion no dispara
  // 'cambio', así que se llama a mano para ocultar los campos dependientes.
  limpiarSeleccion('mov-tipo');
  actualizarCamposVisibles();
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
  const cfgTipo = TIPOS_MOVIMIENTO[fila.tipo_movimiento];
  rodeoIdEditandoSinRodeo = cfgTipo?.sinRodeo ? fila.rodeo_id : null;
  if (fila.establecimiento_origen) establecerSeleccion('mov-establecimiento-origen', fila.establecimiento_origen);
  if (fila.establecimiento_destino) establecerSeleccion('mov-establecimiento-destino', fila.establecimiento_destino);
  if (fila.categoria_origen) establecerSeleccion('mov-categoria-origen', fila.categoria_origen);
  if (fila.categoria_destino) establecerSeleccion('mov-categoria-destino', fila.categoria_destino);
  precargarTitular('origen', fila.titular_origen);
  precargarTitular('destino', fila.titular_destino);
  if (fila.tipo_movimiento === 'hoteleria') el('mov-cliente').value = fila.titular_destino || '';
  if (fila.tipo_movimiento === 'salida_hoteleria') el('mov-cliente').value = fila.titular_origen || '';
  if (fila.destino_venta) establecerSeleccion('mov-destino-venta', fila.destino_venta);
  el('mov-comprador').value = fila.comprador_id || '';
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

// Alerta (no bloquea) si ya existe un movimiento muy parecido: mismo tipo,
// fecha, establecimiento(s), categoría(s) y cantidad de cabezas, sin
// anular ni reemplazado. Pensado para el caso real de dos personas
// cargando por separado (ej. Ponce en el campo, Enriques desde Historial)
// sin verse una a la otra — ver mov-consulta-establecimiento más arriba,
// que le da a Ponce una forma de chequear antes de cargar. Solo se puede
// chequear con conexión; si falla la consulta, se deja pasar (best-effort,
// mismo criterio que validarStockDisponible).
async function buscarPosibleDuplicado(datos) {
  let query = supabase
    .from('historial_movimientos')
    .select('codigo, created_at, usuario_nombre')
    .eq('tipo_movimiento', datos.tipo)
    .eq('fecha', datos.fecha)
    .eq('cantidad_cabezas', Number(datos.cantidad_cabezas))
    .eq('anulado', false)
    .is('reemplazado_por', null)
    .limit(1);
  if (datos.establecimiento_origen) query = query.eq('establecimiento_origen', datos.establecimiento_origen);
  if (datos.establecimiento_destino) query = query.eq('establecimiento_destino', datos.establecimiento_destino);
  if (datos.categoria_origen) query = query.eq('categoria_origen', datos.categoria_origen);
  if (datos.categoria_destino) query = query.eq('categoria_destino', datos.categoria_destino);
  const { data, error } = await query;
  if (error) { console.warn('No se pudo chequear duplicados:', error); return null; }
  return data && data[0] ? data[0] : null;
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
  if (!obtenerSeleccion('mov-tipo')) {
    mostrarMensaje('Elegí un tipo de movimiento.', 'error');
    return;
  }
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

  // No aplica al editar (no tiene sentido que un movimiento se marque
  // "duplicado" de sí mismo) ni sin conexión (no hay forma de chequear).
  if (!datos.editandoId && navigator.onLine) {
    const duplicado = await buscarPosibleDuplicado(datos);
    if (duplicado) {
      const hora = duplicado.created_at ? new Date(duplicado.created_at).toLocaleString('es-AR') : '';
      const seguir = confirm(
        `⚠️ Ya hay un movimiento muy parecido cargado (${duplicado.codigo || 'sin código'}), por ${duplicado.usuario_nombre || 'otro usuario'} el ${hora}.\n\n¿Confirmás que este NO es un duplicado y querés guardarlo igual?`
      );
      if (!seguir) return;
    }
  }

  // Hotelería no elige un rodeo — se crea uno nuevo acá mismo, dedicado a
  // este lote (categoria_destino/'feed_lot'/es_hoteleria=true), igual que
  // "+ Crear rodeo nuevo..." en los demás tipos: exige conexión, no es
  // offline-first como el resto del movimiento.
  if (datos.cfg.sinRodeo) {
    if (datos.editandoId && rodeoIdEditandoSinRodeo) {
      // Corrección de un movimiento 'hoteleria' ya cargado: reusa el mismo
      // rodeo del lote original, no crea uno nuevo.
      datos.rodeo_id = rodeoIdEditandoSinRodeo;
    } else if (!navigator.onLine) {
      mostrarMensaje('Necesitás conexión a internet para cargar Hotelería (crea un rodeo nuevo para el lote).', 'error');
      return;
    } else {
      try {
        const cliente = obtenerTitularesCache().find((t) => t.id === datos.cliente);
        const nuevoRodeo = await crearRodeo({
          nombre: `Hotelería ${cliente?.nombre || datos.cliente}`,
          categoriaId: datos.categoria_destino,
          establecimientoId: datos.establecimiento_destino,
          fechaCreacion: datos.fecha,
          usuarioId: getEstado().session.user.id,
          esHoteleria: true,
        });
        datos.rodeo_id = nuevoRodeo.id;
      } catch (error) {
        mostrarMensaje('No se pudo crear el rodeo de Hotelería: ' + error.message, 'error');
        return;
      }
    }
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
  // Best-effort: si este movimiento resolvió una diferencia pendiente, la
  // saca de la lista apenas se pueda — si todavía no sincronizó (offline
  // o de camino), se termina de reflejar solo cuando el trigger de la
  // base la resuelva y se recargue la pantalla.
  refrescarDiferenciasPendientes();
}

export async function initMovimientos() {
  await Promise.all([cargarTitulares(), cargarRodeos(), cargarCompradores()]);
  poblarGrupos();
  inicializarSelectorRodeo(RODEO_ORIGEN_IDS);
  inicializarSelectorRodeo(RODEO_DESTINO_IDS);
  el('mov-fecha').value = new Date().toISOString().slice(0, 10);
  el('mov-tipo').addEventListener('cambio', actualizarCamposVisibles);
  for (const id of ['mov-categoria-origen', 'mov-categoria-destino', 'mov-establecimiento-origen', 'mov-establecimiento-destino']) {
    el(id).addEventListener('cambio', () => { actualizarSelectsRodeo(); actualizarBloqueFeedLot(); actualizarRequeridoRodeoDestino(); });
  }
  el('mov-establecimiento-origen').addEventListener('cambio', actualizarEstablecimientosDestinoDisponibles);
  // Solo importa para Traslado con destino Feed Lot — nubla "al pie" apenas
  // se elige Feed Lot como establecimiento de destino.
  el('mov-establecimiento-destino').addEventListener('cambio', actualizarCategoriasOrigenDisponibles);
  // Solo importa para Cambio de categoría (el único tipo donde origen y
  // destino de categoría son independientes) — reconstruye las opciones
  // de destino según la cadena SIGUIENTE_CATEGORIA del origen elegido.
  el('mov-categoria-origen').addEventListener('cambio', () => {
    crearGrupoBotones('mov-categoria-destino', opcionesCategoriaDestino(obtenerSeleccion('mov-tipo')));
  });
  ocultarCamposDependientesDeTipo();
  activarAccesoRapidoFeedLot();
  el('mov-form').addEventListener('submit', onSubmit);
  el('mov-editando-cancelar').addEventListener('click', cancelarEdicion);
  document.addEventListener('hacienda:editar-movimiento', (evento) => precargarParaEditar(evento.detail));
  document.addEventListener('hacienda:precargar-mortandad', (evento) => precargarParaMortandad(evento.detail));

  poblarSelectConsultaEstablecimiento();
  el('mov-consulta-establecimiento').addEventListener('change', refrescarConsultaEstablecimiento);
  el('mov-consulta-actualizar').addEventListener('click', refrescarConsultaEstablecimiento);
  refrescarConsultaEstablecimiento();
}
