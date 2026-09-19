// Trabajo de Manga: bitácora de sanidad/reproducción/manejo sobre un
// rodeo — NO es un movimiento de stock (salvo Destete, que además dispara
// movimientos reales de cambio_categoria — ver M11). Esta base (M8) cubre
// solo fecha/propietario(s)/rodeo/categoría/cantidad trabajada, con
// alerta si la cantidad no coincide con el stock real del rodeo (no
// bloquea: se resuelve sola cuando el stock vuelve a coincidir tras un
// movimiento real, vía trigger resolver_diferencia_manga en la base).
import { supabase } from './supabaseClient.js';
import { CATEGORIAS, ESTABLECIMIENTOS } from './config.js';
import { getEstado } from './auth.js';
import { cargarTitulares, obtenerTitularesCache } from './titulares.js';
import { cargarRodeos, rodeosDeEstablecimiento, rodeosDeCategoria, obtenerRodeosCache, crearRodeo, stockDelRodeo, stockDelRodeoPorCategoria } from './rodeos.js';
import { crearGrupoBotones, crearGrupoBotonesMultiple, obtenerSeleccion, obtenerSeleccionMultiple, establecerSeleccion, establecerSeleccionMultiple, limpiarSeleccion, inicializarBotonToggle, estaActivo, desactivarBoton } from './botones.js';

function el(id) {
  return document.getElementById(id);
}

// ─── Catálogos de Sanidad con alta on-the-fly (mismo patrón que
// titulares.js: id = slug del nombre, se cachean y se agregan al vuelo). ───

function slugify(texto) {
  const sinAcentos = texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return sinAcentos.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const catalogos = {
  drogas: { tabla: 'catalogo_drogas', cache: [] },
  vacunas: { tabla: 'catalogo_vacunas_reproductivas', cache: [] },
  otras: { tabla: 'catalogo_otras_sanidades', cache: [] },
  toros: { tabla: 'catalogo_toros', cache: [] },
};

async function cargarCatalogo(clave) {
  const c = catalogos[clave];
  const { data, error } = await supabase.from(c.tabla).select('*').eq('activo', true).order('nombre');
  if (!error) c.cache = data;
  return c.cache;
}

async function crearEnCatalogo(clave, nombre) {
  const c = catalogos[clave];
  const id = slugify(nombre);
  if (!id) throw new Error('Nombre inválido');
  const existente = c.cache.find((x) => x.id === id);
  if (existente) return existente;
  const { data, error } = await supabase.from(c.tabla).insert({ id, nombre }).select().single();
  if (error) throw error;
  c.cache = [...c.cache, data];
  return data;
}

function poblarSelectCatalogo(idSelect, clave, textoNuevo) {
  const select = el(idSelect);
  const valorPrevio = select.value;
  select.innerHTML = '';
  const opcionVacia = document.createElement('option');
  opcionVacia.value = '';
  opcionVacia.textContent = 'Elegir...';
  select.appendChild(opcionVacia);
  for (const item of catalogos[clave].cache) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.nombre;
    select.appendChild(opt);
  }
  const opcionNueva = document.createElement('option');
  opcionNueva.value = '__nuevo__';
  opcionNueva.textContent = textoNuevo;
  select.appendChild(opcionNueva);
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

// ─── Selección múltiple contra un catálogo (vacunas / otras sanidades):
// un <select> "agregar" que suma chips a una lista, con alta on-the-fly. ───

const seleccionMultipleCatalogo = {
  vacunas: new Set(),
  otras: new Set(),
  toros: new Set(),
};

function renderChips(idLista, clave) {
  const contenedor = el(idLista);
  contenedor.innerHTML = '';
  for (const id of seleccionMultipleCatalogo[clave]) {
    const item = catalogos[clave].cache.find((x) => x.id === id);
    if (!item) continue;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item.nombre;
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = '×';
    boton.addEventListener('click', () => {
      seleccionMultipleCatalogo[clave].delete(id);
      renderChips(idLista, clave);
    });
    chip.appendChild(boton);
    contenedor.appendChild(chip);
  }
}

function inicializarAgregarCatalogo(idSelect, idLista, clave, textoNuevo) {
  poblarSelectCatalogo(idSelect, clave, textoNuevo);
  el(idSelect).addEventListener('change', async () => {
    const select = el(idSelect);
    const valor = select.value;
    if (!valor) return;
    if (valor === '__nuevo__') {
      const nombre = prompt('Nombre nuevo:');
      select.value = '';
      if (!nombre || !nombre.trim()) return;
      try {
        const nuevo = await crearEnCatalogo(clave, nombre.trim());
        poblarSelectCatalogo(idSelect, clave, textoNuevo);
        seleccionMultipleCatalogo[clave].add(nuevo.id);
        renderChips(idLista, clave);
      } catch (error) {
        alert('No se pudo crear: ' + error.message);
      }
      return;
    }
    seleccionMultipleCatalogo[clave].add(valor);
    renderChips(idLista, clave);
    select.value = '';
  });
}

function limpiarSeleccionMultipleCatalogo(clave, idLista) {
  seleccionMultipleCatalogo[clave].clear();
  renderChips(idLista, clave);
}

// Establecimiento primero, después Rodeo (filtrado solo por
// establecimiento — un mismo establecimiento puede tener rodeos de
// distintas categorías, todos aparecen acá) y recién ahí Categoría, que
// se DERIVA del rodeo elegido (ver actualizarCategoriaSegunRodeo) — no se
// elige a mano, un rodeo ya tiene una única categoría fija.
function poblarSelectRodeoManga() {
  const establecimientoId = obtenerSeleccion('manga-establecimiento');
  const select = el('manga-rodeo');
  const valorPrevio = select.value;
  select.innerHTML = '<option value="">Elegir...</option>';
  if (establecimientoId) {
    for (const r of rodeosDeEstablecimiento(establecimientoId)) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.codigo;
      select.appendChild(opt);
    }
  }
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
  actualizarCategoriaSegunRodeo();
}

// La categoría se deriva del rodeo elegido y se nublan (deshabilitan) las
// demás opciones, para que no se pueda cargar con una categoría que no
// corresponde a ese rodeo. Excepción: los 4 corrales fijos de Feed Lot
// (rodeo.categoria_id null, ver rodeoDelCorral en rodeos.js) pueden tener
// varias categorías a la vez — ahí no hay nada que derivar, se deja igual
// que sin rodeo elegido (todo habilitado, a elegir a mano).
function actualizarCategoriaSegunRodeo() {
  const rodeo = obtenerRodeosCache().find((r) => r.id === el('manga-rodeo').value);
  const grupo = el('manga-categoria');
  if (rodeo && rodeo.categoria_id) {
    establecerSeleccion('manga-categoria', rodeo.categoria_id);
    grupo.querySelectorAll('.boton-opcion').forEach((b) => {
      const activo = b.dataset.value === rodeo.categoria_id;
      b.disabled = !activo;
      b.classList.toggle('deshabilitado', !activo);
    });
  } else {
    limpiarSeleccion('manga-categoria');
    grupo.querySelectorAll('.boton-opcion').forEach((b) => {
      b.disabled = false;
      b.classList.remove('deshabilitado');
    });
  }
}

function leerSanidad() {
  if (!estaActivo('manga-check-sanidad')) return null;
  const desparasitada = el('manga-desparasitada').checked;
  return {
    desparasitada,
    droga_id: desparasitada && el('manga-droga').value && el('manga-droga').value !== '__nuevo__' ? el('manga-droga').value : null,
    cobre: el('manga-cobre').checked,
    aftosa: el('manga-aftosa').checked,
    brucelosis: el('manga-brucelosis').checked,
    carbunclo: el('manga-carbunclo').checked,
    vacunas: el('manga-check-vacunas').checked ? [...seleccionMultipleCatalogo.vacunas] : [],
    otras: el('manga-check-otras').checked ? [...seleccionMultipleCatalogo.otras] : [],
  };
}

async function guardarSanidad(trabajoMangaId, sanidad) {
  const { error: errorSanidad } = await supabase
    .from('trabajo_manga_sanidad')
    .insert({
      trabajo_manga_id: trabajoMangaId,
      desparasitada: sanidad.desparasitada,
      droga_id: sanidad.droga_id,
      cobre: sanidad.cobre,
      aftosa: sanidad.aftosa,
      brucelosis: sanidad.brucelosis,
      carbunclo: sanidad.carbunclo,
    });
  if (errorSanidad) throw errorSanidad;

  if (sanidad.vacunas.length) {
    const { error } = await supabase
      .from('trabajo_manga_vacunas')
      .insert(sanidad.vacunas.map((vacunaId) => ({ trabajo_manga_id: trabajoMangaId, vacuna_id: vacunaId })));
    if (error) throw error;
  }
  if (sanidad.otras.length) {
    const { error } = await supabase
      .from('trabajo_manga_otras_sanidades')
      .insert(sanidad.otras.map((sanidadId) => ({ trabajo_manga_id: trabajoMangaId, sanidad_id: sanidadId })));
    if (error) throw error;
  }
}

function activarBloquesSanidad() {
  inicializarBotonToggle('manga-check-sanidad', (activo) => {
    el('manga-bloque-sanidad').classList.toggle('oculto', !activo);
  });
  el('manga-desparasitada').addEventListener('change', () => {
    const marcada = el('manga-desparasitada').checked;
    el('manga-fila-droga').classList.toggle('oculto', !marcada);
    if (!marcada) el('manga-droga').value = '';
  });
  el('manga-check-vacunas').addEventListener('change', () => {
    const marcada = el('manga-check-vacunas').checked;
    el('manga-bloque-vacunas').classList.toggle('oculto', !marcada);
    if (!marcada) limpiarSeleccionMultipleCatalogo('vacunas', 'manga-vacunas');
  });
  el('manga-check-otras').addEventListener('change', () => {
    const marcada = el('manga-check-otras').checked;
    el('manga-bloque-otras').classList.toggle('oculto', !marcada);
    if (!marcada) limpiarSeleccionMultipleCatalogo('otras', 'manga-otras');
  });
}

function limpiarSanidad() {
  desactivarBoton('manga-check-sanidad');
  el('manga-bloque-sanidad').classList.add('oculto');
  el('manga-desparasitada').checked = false;
  el('manga-fila-droga').classList.add('oculto');
  el('manga-droga').value = '';
  el('manga-cobre').checked = false;
  el('manga-aftosa').checked = false;
  el('manga-brucelosis').checked = false;
  el('manga-carbunclo').checked = false;
  el('manga-check-vacunas').checked = false;
  el('manga-bloque-vacunas').classList.add('oculto');
  limpiarSeleccionMultipleCatalogo('vacunas', 'manga-vacunas');
  el('manga-check-otras').checked = false;
  el('manga-bloque-otras').classList.add('oculto');
  limpiarSeleccionMultipleCatalogo('otras', 'manga-otras');
}

function leerReproduccion() {
  if (!estaActivo('manga-check-reproduccion')) return null;
  const estadoCorporalTexto = el('manga-estado-corporal').value;
  return {
    estado_corporal: estadoCorporalTexto ? Number(estadoCorporalTexto) : null,
    inseminacion: el('manga-check-inseminacion').checked,
    toros: el('manga-check-inseminacion').checked ? [...seleccionMultipleCatalogo.toros] : [],
    tacto: el('manga-tacto').checked,
    raspaje: el('manga-raspaje').checked,
    ecografia: el('manga-ecografia').checked,
    resincronizacion: el('manga-resincronizacion').checked,
  };
}

async function guardarReproduccion(trabajoMangaId, reproduccion) {
  const { error: errorReproduccion } = await supabase
    .from('trabajo_manga_reproduccion')
    .insert({
      trabajo_manga_id: trabajoMangaId,
      estado_corporal: reproduccion.estado_corporal,
      inseminacion: reproduccion.inseminacion,
      tacto: reproduccion.tacto,
      raspaje: reproduccion.raspaje,
      ecografia: reproduccion.ecografia,
      resincronizacion: reproduccion.resincronizacion,
    });
  if (errorReproduccion) throw errorReproduccion;

  if (reproduccion.toros.length) {
    const { error } = await supabase
      .from('trabajo_manga_inseminacion_toros')
      .insert(reproduccion.toros.map((toroId) => ({ trabajo_manga_id: trabajoMangaId, toro_id: toroId })));
    if (error) throw error;
  }
}

function activarBloquesReproduccion() {
  inicializarBotonToggle('manga-check-reproduccion', (activo) => {
    el('manga-bloque-reproduccion').classList.toggle('oculto', !activo);
  });
  el('manga-check-inseminacion').addEventListener('change', () => {
    const marcada = el('manga-check-inseminacion').checked;
    el('manga-bloque-toros').classList.toggle('oculto', !marcada);
    if (!marcada) limpiarSeleccionMultipleCatalogo('toros', 'manga-toros');
  });
}

function limpiarReproduccion() {
  desactivarBoton('manga-check-reproduccion');
  el('manga-bloque-reproduccion').classList.add('oculto');
  el('manga-estado-corporal').value = '';
  el('manga-check-inseminacion').checked = false;
  el('manga-bloque-toros').classList.add('oculto');
  limpiarSeleccionMultipleCatalogo('toros', 'manga-toros');
  el('manga-tacto').checked = false;
  el('manga-raspaje').checked = false;
  el('manga-ecografia').checked = false;
  el('manga-resincronizacion').checked = false;
}

// ─── Manejo de rodeo: aparte / capada / pesada de control / Destete ───
// Destete no es un movimiento en sí — es la bitácora de trabajo_manga_manejo
// — pero SÍ dispara movimientos reales de cambio_categoria (ternero_al_pie→
// ternero, ternera_al_pie→ternera: primer paso de la cadena de categorías)
// que además cambian de rodeo (cada sexo pasa a su propio rodeo nuevo), ver
// ejecutarDestete().

function poblarSelectRodeoDestino(idSelect, categoriaId) {
  const select = el(idSelect);
  const valorPrevio = select.value;
  select.innerHTML = '<option value="">Elegir...</option>';
  for (const r of rodeosDeCategoria(categoriaId)) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.codigo;
    select.appendChild(opt);
  }
  // Un puestero no da de alta rodeos — solo puede elegir entre los que
  // ya existen.
  if (getEstado().perfil?.rol !== 'puestero') {
    const opcionNueva = document.createElement('option');
    opcionNueva.value = '__nuevo__';
    opcionNueva.textContent = '+ Crear rodeo nuevo...';
    select.appendChild(opcionNueva);
  }
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

function inicializarSelectorRodeoDestino(prefijo, categoriaId) {
  const idSelect = `manga-destete-rodeo-${prefijo}`;
  const idWrap = `${idSelect}-nuevo-wrap`;
  const idNombre = `${idSelect}-nombre`;
  const idFecha = `${idSelect}-fecha`;
  const idCrear = `${idSelect}-crear`;

  poblarSelectRodeoDestino(idSelect, categoriaId);

  el(idSelect).addEventListener('change', () => {
    const esNuevo = el(idSelect).value === '__nuevo__';
    el(idWrap).classList.toggle('oculto', !esNuevo);
    if (esNuevo) el(idFecha).value = new Date().toISOString().slice(0, 10);
  });

  el(idCrear).addEventListener('click', async () => {
    const nombre = el(idNombre).value.trim();
    if (!nombre) { alert('Ingresá un nombre para el rodeo.'); return; }
    const rodeoMadreId = el('manga-rodeo').value;
    const establecimientoId = obtenerRodeosCache().find((r) => r.id === rodeoMadreId)?.establecimiento_id;
    if (!establecimientoId) { alert('Elegí primero el rodeo de arriba.'); return; }
    try {
      const nuevo = await crearRodeo({
        nombre,
        categoriaId,
        establecimientoId,
        fechaCreacion: el(idFecha).value || undefined,
        usuarioId: getEstado().session.user.id,
      });
      poblarSelectRodeoDestino(idSelect, categoriaId);
      el(idSelect).value = nuevo.id;
      el(idWrap).classList.add('oculto');
    } catch (error) {
      alert('No se pudo crear el rodeo: ' + error.message);
    }
  });
}

function leerManejo() {
  if (!estaActivo('manga-check-manejo')) return null;
  const pesadaTexto = el('manga-pesada-control').value;
  const destete = el('manga-check-destete').checked;
  return {
    aparte: el('manga-aparte').checked,
    capada: el('manga-capada').checked,
    pesada_control_kilos: pesadaTexto ? Number(pesadaTexto) : null,
    destete,
    destete_machos_cantidad: destete ? Number(el('manga-destete-machos').value) || 0 : null,
    destete_hembras_cantidad: destete ? Number(el('manga-destete-hembras').value) || 0 : null,
    destete_kilos_ternero: destete && el('manga-destete-kilos-ternero').value ? Number(el('manga-destete-kilos-ternero').value) : null,
    destete_kilos_ternera: destete && el('manga-destete-kilos-ternera').value ? Number(el('manga-destete-kilos-ternera').value) : null,
    rodeoNovillitoId: destete ? el('manga-destete-rodeo-novillito').value : null,
    rodeoVaquillonaId: destete ? el('manga-destete-rodeo-vaquillona').value : null,
  };
}

async function ejecutarDestete(trabajoMangaId, manejo, contexto) {
  const establecimientoId = obtenerRodeosCache().find((r) => r.id === contexto.rodeoOrigenId)?.establecimiento_id;
  const base = {
    fecha: contexto.fecha,
    establecimiento_origen: establecimientoId,
    establecimiento_destino: establecimientoId,
    titular_origen: contexto.titularId,
    titular_destino: contexto.titularId,
    rodeo_id: contexto.rodeoOrigenId,
    usuario_id: contexto.usuarioId,
    observaciones: 'Destete (Trabajo de Manga)',
  };
  if (manejo.destete_machos_cantidad > 0) {
    const { error } = await supabase.from('movimientos').insert({
      ...base,
      tipo_movimiento: 'cambio_categoria',
      categoria_origen: 'ternero_al_pie',
      categoria_destino: 'ternero',
      rodeo_destino_id: manejo.rodeoNovillitoId,
      cantidad_cabezas: manejo.destete_machos_cantidad,
      kilos_promedio: manejo.destete_kilos_ternero,
    });
    if (error) throw new Error('movimiento de machos: ' + error.message);
  }
  if (manejo.destete_hembras_cantidad > 0) {
    const { error } = await supabase.from('movimientos').insert({
      ...base,
      tipo_movimiento: 'cambio_categoria',
      categoria_origen: 'ternera_al_pie',
      categoria_destino: 'ternera',
      rodeo_destino_id: manejo.rodeoVaquillonaId,
      cantidad_cabezas: manejo.destete_hembras_cantidad,
      kilos_promedio: manejo.destete_kilos_ternera,
    });
    if (error) throw new Error('movimiento de hembras: ' + error.message);
  }
}

// ejecutarDesteteTambien va en false al editar un trabajo ya cargado: el
// destete original ya generó sus movimientos de stock y no se rehace (ver
// bloquearDesteteSiCorresponde).
async function guardarManejo(trabajoMangaId, manejo, contexto, { ejecutarDesteteTambien = true } = {}) {
  const { error: errorManejo } = await supabase
    .from('trabajo_manga_manejo')
    .insert({
      trabajo_manga_id: trabajoMangaId,
      aparte: manejo.aparte,
      capada: manejo.capada,
      pesada_control_kilos: manejo.pesada_control_kilos,
      destete: manejo.destete,
      destete_machos_cantidad: manejo.destete_machos_cantidad,
      destete_hembras_cantidad: manejo.destete_hembras_cantidad,
      destete_kilos_ternero: manejo.destete_kilos_ternero,
      destete_kilos_ternera: manejo.destete_kilos_ternera,
    });
  if (errorManejo) throw errorManejo;

  if (manejo.pesada_control_kilos != null) {
    const { error } = await supabase.from('rodeo_pesadas_historial').insert({
      rodeo_id: contexto.rodeoOrigenId,
      fecha: contexto.fecha,
      kilos_promedio: manejo.pesada_control_kilos,
      trabajo_manga_id: trabajoMangaId,
    });
    if (error) throw error;
  }

  if (manejo.destete && ejecutarDesteteTambien) {
    await ejecutarDestete(trabajoMangaId, manejo, contexto);
  }
}

// Al editar hay que reemplazar las filas hijas, no acumularlas: se borran
// las que había y se vuelven a insertar con lo que quedó en el formulario.
// El manejo se saltea cuando el trabajo tenía un destete (esa fila guarda
// las cantidades destetadas, que no se tocan).
async function borrarHijosDelTrabajo(trabajoId, { incluirManejo }) {
  const tablas = [
    'trabajo_manga_propietarios', 'trabajo_manga_sanidad', 'trabajo_manga_vacunas',
    'trabajo_manga_otras_sanidades', 'trabajo_manga_reproduccion', 'trabajo_manga_inseminacion_toros',
  ];
  if (incluirManejo) tablas.push('trabajo_manga_manejo');
  for (const tabla of tablas) {
    const { error } = await supabase.from(tabla).delete().eq('trabajo_manga_id', trabajoId);
    if (error) return error;
  }
  if (incluirManejo) {
    const { error } = await supabase.from('rodeo_pesadas_historial').delete().eq('trabajo_manga_id', trabajoId);
    if (error) return error;
  }
  return null;
}

function activarBloquesManejo() {
  inicializarBotonToggle('manga-check-manejo', (activo) => {
    el('manga-bloque-manejo').classList.toggle('oculto', !activo);
  });
  el('manga-check-destete').addEventListener('change', () => {
    el('manga-bloque-destete').classList.toggle('oculto', !el('manga-check-destete').checked);
  });
}

function limpiarManejo() {
  desactivarBoton('manga-check-manejo');
  el('manga-bloque-manejo').classList.add('oculto');
  el('manga-aparte').checked = false;
  el('manga-capada').checked = false;
  el('manga-pesada-control').value = '';
  el('manga-check-destete').checked = false;
  el('manga-bloque-destete').classList.add('oculto');
  el('manga-destete-machos').value = '';
  el('manga-destete-kilos-ternero').value = '';
  el('manga-destete-rodeo-novillito').value = '';
  el('manga-destete-rodeo-novillito-nuevo-wrap').classList.add('oculto');
  el('manga-destete-rodeo-novillito-nombre').value = '';
  el('manga-destete-hembras').value = '';
  el('manga-destete-kilos-ternera').value = '';
  el('manga-destete-rodeo-vaquillona').value = '';
  el('manga-destete-rodeo-vaquillona-nuevo-wrap').classList.add('oculto');
  el('manga-destete-rodeo-vaquillona-nombre').value = '';
}

// ─── Diferencias pendientes: lista con acceso directo a resolverlas ───
// Dos formas de resolver: corregir la cantidad trabajada (si fue un
// error de tipeo, ej. "500" en vez de "50") o cargar el movimiento real
// que explica la diferencia (mortandad, faltante, etc.) — para esto
// último se precarga "Cargar movimiento" vía evento, mismo patrón que
// usa historial.js para pedir la edición de un movimiento.

function nombreCategoria(categoriaId) {
  return CATEGORIAS.find((c) => c.id === categoriaId)?.nombre || categoriaId;
}

// Aplica la corrección de verdad (solo se llama para el owner directo, o
// al aprobar la propuesta de otro rol) — vuelve a chequear el stock
// porque puede haber cambiado desde que se listó el pendiente.
async function aplicarRectificacion(trabajo, nueva) {
  let stockActual;
  try {
    stockActual = await stockDelRodeo(trabajo.rodeo_id);
  } catch (error) {
    alert('No se pudo verificar el stock del rodeo: ' + error.message);
    return false;
  }
  const sigueDiferente = nueva !== stockActual;
  const { error } = await supabase
    .from('trabajos_manga')
    .update({
      cantidad_trabajada: nueva,
      diferencia_pendiente: sigueDiferente,
      resuelto_por_movimiento_id: null,
      resuelto_at: sigueDiferente ? null : new Date().toISOString(),
    })
    .eq('id', trabajo.id);
  if (error) {
    alert('No se pudo guardar: ' + error.message);
    return false;
  }
  if (sigueDiferente) {
    alert(`Guardado, pero ${nueva} todavía no coincide con el stock actual del rodeo (${stockActual}). Sigue pendiente.`);
  }
  return true;
}

// El owner rectifica directo (es quien aprobaría, no tiene sentido
// aprobarse a sí mismo). Cualquier otro rol deja una propuesta pendiente
// que un owner tiene que aprobar o rechazar (ver Rectificaciones
// pendientes de aprobar, más abajo) — no toca trabajos_manga todavía.
async function editarCantidadTrabajada(trabajo) {
  const nuevaTexto = prompt(`Cantidad trabajada correcta para ${trabajo.codigo} (rodeo ${trabajo.rodeoCodigo}):`, trabajo.cantidad_trabajada);
  if (nuevaTexto === null) return;
  const nueva = Number(nuevaTexto);
  if (!Number.isInteger(nueva) || nueva <= 0) {
    alert('Tiene que ser un entero mayor a 0.');
    return;
  }

  const { perfil, session } = getEstado();
  if (perfil?.rol !== 'owner') {
    const { error } = await supabase.from('rectificaciones_pendientes').insert({
      trabajo_manga_id: trabajo.id,
      cantidad_anterior: trabajo.cantidad_trabajada,
      cantidad_propuesta: nueva,
      propuesto_por: session.user.id,
    });
    if (error) {
      alert('No se pudo enviar la rectificación: ' + error.message);
      return;
    }
    alert('Rectificación enviada. Queda pendiente de que un owner la apruebe.');
    return;
  }

  if (await aplicarRectificacion(trabajo, nueva)) await refrescarDiferenciasPendientes();
}

function pedirMovimientoParaDiferencia(trabajo) {
  const rodeoCache = obtenerRodeosCache().find((r) => r.id === trabajo.rodeo_id);
  document.dispatchEvent(new CustomEvent('hacienda:precargar-mortandad', {
    detail: {
      establecimientoId: rodeoCache?.establecimiento_id || null,
      categoriaId: trabajo.categoria_id,
      rodeoId: trabajo.rodeo_id,
      cantidad: Math.abs(trabajo.cantidad_trabajada - trabajo.stockActualAlListar),
    },
  }));
}

// Se muestra en dos pantallas a la vez (Trabajo de Manga Y Cargar
// Movimiento — ahí es literalmente donde se resuelve con un movimiento
// real), para que la alerta sea imposible de no ver.
const CONTENEDORES_PENDIENTES = [
  { bloque: 'manga-pendientes-bloque', lista: 'manga-pendientes-lista' },
  { bloque: 'mov-pendientes-bloque', lista: 'mov-pendientes-lista' },
];

function crearItemPendiente(trabajo) {
  const div = document.createElement('div');
  div.className = 'pendiente-item';
  const texto = document.createElement('div');
  texto.className = 'pendiente-texto';
  texto.textContent =
    `${trabajo.codigo} — ${trabajo.fecha} — rodeo ${trabajo.rodeoCodigo} (${nombreCategoria(trabajo.categoria_id)}): ` +
    `se trabajaron ${trabajo.cantidad_trabajada}, el rodeo tiene ${trabajo.stockActualAlListar} ahora.`;
  div.appendChild(texto);

  const botones = document.createElement('div');
  botones.className = 'pendiente-botones';

  const btnRectificar = document.createElement('button');
  btnRectificar.type = 'button';
  btnRectificar.textContent = 'RECTIFICAR CANTIDAD';
  btnRectificar.addEventListener('click', () => editarCantidadTrabajada(trabajo));
  botones.appendChild(btnRectificar);

  const btnMovimiento = document.createElement('button');
  btnMovimiento.type = 'button';
  btnMovimiento.className = 'boton-secundario';
  btnMovimiento.textContent = 'Cargar movimiento';
  btnMovimiento.addEventListener('click', () => pedirMovimientoParaDiferencia(trabajo));
  botones.appendChild(btnMovimiento);

  div.appendChild(botones);
  return div;
}

function renderDiferenciasPendientes(pendientes) {
  for (const { bloque: idBloque, lista: idLista } of CONTENEDORES_PENDIENTES) {
    const bloque = el(idBloque);
    const contenedor = el(idLista);
    if (!bloque || !contenedor) continue;
    bloque.classList.toggle('oculto', !pendientes.length);
    contenedor.innerHTML = '';
    for (const trabajo of pendientes) contenedor.appendChild(crearItemPendiente(trabajo));
  }
}

export async function refrescarDiferenciasPendientes() {
  if (!navigator.onLine) return;
  const { data, error } = await supabase
    .from('trabajos_manga')
    .select('id, codigo, fecha, rodeo_id, categoria_id, cantidad_trabajada')
    .eq('diferencia_pendiente', true)
    .eq('anulado', false)
    .order('fecha', { ascending: false });
  if (error) { console.warn('No se pudieron cargar las diferencias pendientes:', error); return; }

  const pendientes = [];
  for (const trabajo of data) {
    let stockActualAlListar = null;
    try {
      stockActualAlListar = await stockDelRodeo(trabajo.rodeo_id);
    } catch (error) {
      console.warn('No se pudo verificar el stock de un pendiente:', error);
      continue;
    }
    const rodeoCache = obtenerRodeosCache().find((r) => r.id === trabajo.rodeo_id);
    pendientes.push({ ...trabajo, stockActualAlListar, rodeoCodigo: rodeoCache?.codigo || trabajo.rodeo_id });
  }
  renderDiferenciasPendientes(pendientes);
}

// ─── Consulta rápida de trabajos de manga por establecimiento (mismo
// criterio que mov-consulta-establecimiento en movimientos.js: evitar que
// dos personas carguen el mismo Trabajo de Manga sin saberlo) ───────────
function poblarSelectConsultaManga() {
  const select = el('manga-consulta-establecimiento');
  select.innerHTML = '';
  for (const e of ESTABLECIMIENTOS) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nombre;
    select.appendChild(opt);
  }
  select.value = 'el_tara';
}

function itemConsultaManga(fila) {
  const hora = fila.creado_at ? new Date(fila.creado_at).toLocaleString('es-AR') : '';
  const div = document.createElement('div');
  div.className = 'consulta-item';
  div.textContent =
    `${fila.fecha} — rodeo ${fila.rodeo || fila.rodeo_id} (${fila.categoria_nombre || ''}) · ${fila.cantidad_trabajada} trabajadas` +
    ` — cargado por ${fila.usuario_nombre || '—'} (${hora})`;
  return div;
}

// La vista historial_trabajos_manga no trae establecimiento (un trabajo
// se ata a un rodeo, no a un establecimiento directo) — se filtra acá
// cruzando con el rodeo en caché en vez de sumar un join a la vista.
export async function refrescarConsultaManga() {
  const establecimientoId = el('manga-consulta-establecimiento')?.value;
  const contenedor = el('manga-consulta-lista');
  if (!establecimientoId || !contenedor) return;
  if (!navigator.onLine) {
    contenedor.innerHTML = '<div style="color:#666;">Sin conexión — no se puede consultar ahora.</div>';
    return;
  }
  contenedor.textContent = 'Cargando…';
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('historial_trabajos_manga')
    .select('*')
    .eq('anulado', false)
    .eq('fecha', hoy)
    .order('creado_at', { ascending: false })
    .limit(30);
  if (error) {
    contenedor.innerHTML = `<div class="mensaje error">No se pudo consultar: ${error.message}</div>`;
    return;
  }
  const rodeosPorId = new Map(obtenerRodeosCache().map((r) => [r.id, r]));
  const filas = data.filter((f) => rodeosPorId.get(f.rodeo_id)?.establecimiento_id === establecimientoId);
  contenedor.innerHTML = '';
  if (!filas.length) {
    contenedor.innerHTML = '<div style="color:#666;">Sin trabajos de manga cargados hoy en ese establecimiento.</div>';
    return;
  }
  for (const fila of filas) contenedor.appendChild(itemConsultaManga(fila));
}

// ─── Rectificaciones pendientes de aprobar (solo owner) ────────────────
// Cuando encargado/administrativo propone una rectificación, queda acá
// hasta que un owner la apruebe (aplica el cambio) o la rechace (no toca
// trabajos_manga, el trabajo sigue con su diferencia_pendiente de antes).

function crearItemRectificacion(r) {
  const div = document.createElement('div');
  div.className = 'pendiente-item';
  const texto = document.createElement('div');
  texto.className = 'pendiente-texto';
  texto.textContent =
    `${r.codigo} (rodeo ${r.rodeo || r.rodeo_id}): ${r.propuesto_nombre || 'alguien'} propone cambiar ` +
    `${r.cantidad_anterior} → ${r.cantidad_propuesta}.`;
  div.appendChild(texto);

  const botones = document.createElement('div');
  botones.className = 'pendiente-botones';

  const btnAprobar = document.createElement('button');
  btnAprobar.type = 'button';
  btnAprobar.textContent = 'Aprobar';
  btnAprobar.addEventListener('click', () => aprobarRectificacion(r));
  botones.appendChild(btnAprobar);

  const btnRechazar = document.createElement('button');
  btnRechazar.type = 'button';
  btnRechazar.className = 'boton-secundario';
  btnRechazar.textContent = 'Rechazar';
  btnRechazar.addEventListener('click', () => rechazarRectificacion(r));
  botones.appendChild(btnRechazar);

  div.appendChild(botones);
  return div;
}

function renderRectificacionesPendientes(pendientes) {
  const bloque = el('manga-rectificaciones-bloque');
  const contenedor = el('manga-rectificaciones-lista');
  if (!bloque || !contenedor) return;
  bloque.classList.toggle('oculto', !pendientes.length);
  contenedor.innerHTML = '';
  for (const r of pendientes) contenedor.appendChild(crearItemRectificacion(r));
}

async function aprobarRectificacion(r) {
  const ok = await aplicarRectificacion({ id: r.trabajo_manga_id, rodeo_id: r.rodeo_id }, r.cantidad_propuesta);
  if (!ok) return;
  const { error } = await supabase.from('rectificaciones_pendientes').update({
    estado: 'aprobada',
    resuelto_por: getEstado().session.user.id,
    resuelto_at: new Date().toISOString(),
  }).eq('id', r.id);
  if (error) {
    alert('Se aplicó el cambio pero no se pudo marcar la rectificación como aprobada: ' + error.message);
  }
  await Promise.all([refrescarDiferenciasPendientes(), refrescarRectificacionesPendientes()]);
}

async function rechazarRectificacion(r) {
  const motivo = prompt('Motivo del rechazo (opcional):');
  if (motivo === null) return;
  const { error } = await supabase.from('rectificaciones_pendientes').update({
    estado: 'rechazada',
    resuelto_por: getEstado().session.user.id,
    resuelto_at: new Date().toISOString(),
    motivo_rechazo: motivo || null,
  }).eq('id', r.id);
  if (error) {
    alert('No se pudo rechazar: ' + error.message);
    return;
  }
  await refrescarRectificacionesPendientes();
}

export async function refrescarRectificacionesPendientes() {
  if (!navigator.onLine) return;
  const { perfil } = getEstado();
  if (perfil?.rol !== 'owner') {
    renderRectificacionesPendientes([]);
    return;
  }
  const { data, error } = await supabase.from('rectificaciones_pendientes_detalle').select('*').eq('estado', 'pendiente');
  if (error) { console.warn('No se pudieron cargar las rectificaciones pendientes:', error); return; }
  renderRectificacionesPendientes(data);
}

function mostrarMensaje(texto, tipo) {
  const contenedor = el('manga-mensaje');
  contenedor.textContent = texto;
  contenedor.className = tipo; // 'error' | 'ok' | 'advertencia'
}

// ─── Editar un trabajo ya cargado (desde Reportes > Trabajo de Manga) ───
// Se reusa este formulario entero en vez de armar uno aparte allá. A
// diferencia de los movimientos (que se corrigen creando uno nuevo y
// marcando el viejo como reemplazado), acá se actualiza la misma fila: el
// código T-000xxx tiene que seguir siendo el mismo porque las
// rectificaciones pendientes y las pesadas apuntan a él.
let editandoTrabajoId = null;
// Si el trabajo original tenía un destete, esa sección queda bloqueada:
// generó movimientos reales de stock que no guardan referencia al trabajo,
// así que no hay forma segura de deshacerlos ni rehacerlos desde acá.
let editandoTeniaDestete = false;

// Pone un botón-interruptor (SANIDAD/REPRODUCCION/MANEJO) en el estado
// pedido usando su propio click, para que corra el handler que muestra u
// oculta el bloque en vez de duplicar esa lógica.
function ponerToggle(idBoton, activo) {
  if (estaActivo(idBoton) !== Boolean(activo)) el(idBoton).click();
}

function ponerCheckbox(idCheck, valor) {
  const check = el(idCheck);
  check.checked = Boolean(valor);
  check.dispatchEvent(new Event('change'));
}

function ponerSeleccionCatalogo(clave, idLista, ids) {
  seleccionMultipleCatalogo[clave] = new Set(ids || []);
  renderChips(idLista, clave);
}

async function precargarParaEditarManga(trabajo) {
  resetFormulario();
  editandoTrabajoId = trabajo.id;
  editandoTeniaDestete = Boolean(trabajo.manejo?.destete);

  el('manga-fecha').value = trabajo.fecha;

  // El rodeo determina establecimiento y categoría (ver
  // actualizarCategoriaSegunRodeo), así que primero se elige el
  // establecimiento para poblar la lista, y recién después el rodeo.
  const rodeo = obtenerRodeosCache().find((r) => r.id === trabajo.rodeo_id);
  if (rodeo) establecerSeleccion('manga-establecimiento', rodeo.establecimiento_id);
  poblarSelectRodeoManga();
  el('manga-rodeo').value = trabajo.rodeo_id;
  actualizarCategoriaSegunRodeo();
  establecerSeleccion('manga-categoria', trabajo.categoria_id);

  establecerSeleccionMultiple('manga-propietarios', trabajo.propietariosIds);
  el('manga-cantidad').value = trabajo.cantidad_trabajada;
  el('manga-observaciones').value = trabajo.observaciones || '';

  const s = trabajo.sanidad;
  if (s) {
    ponerToggle('manga-check-sanidad', true);
    ponerCheckbox('manga-desparasitada', s.desparasitada);
    if (s.droga_id) el('manga-droga').value = s.droga_id;
    el('manga-cobre').checked = Boolean(s.cobre);
    el('manga-aftosa').checked = Boolean(s.aftosa);
    el('manga-brucelosis').checked = Boolean(s.brucelosis);
    el('manga-carbunclo').checked = Boolean(s.carbunclo);
    ponerCheckbox('manga-check-vacunas', trabajo.vacunasIds?.length);
    ponerSeleccionCatalogo('vacunas', 'manga-vacunas', trabajo.vacunasIds);
    ponerCheckbox('manga-check-otras', trabajo.otrasSanidadesIds?.length);
    ponerSeleccionCatalogo('otras', 'manga-otras', trabajo.otrasSanidadesIds);
  }

  const r = trabajo.reproduccion;
  if (r) {
    ponerToggle('manga-check-reproduccion', true);
    el('manga-estado-corporal').value = r.estado_corporal ?? '';
    ponerCheckbox('manga-check-inseminacion', r.inseminacion);
    ponerSeleccionCatalogo('toros', 'manga-toros', trabajo.torosIds);
    el('manga-tacto').checked = Boolean(r.tacto);
    el('manga-raspaje').checked = Boolean(r.raspaje);
    el('manga-ecografia').checked = Boolean(r.ecografia);
    el('manga-resincronizacion').checked = Boolean(r.resincronizacion);
  }

  const m = trabajo.manejo;
  if (m) {
    ponerToggle('manga-check-manejo', true);
    el('manga-aparte').checked = Boolean(m.aparte);
    el('manga-capada').checked = Boolean(m.capada);
    el('manga-pesada-control').value = m.pesada_control_kilos ?? '';
    ponerCheckbox('manga-check-destete', m.destete);
    if (m.destete) {
      el('manga-destete-machos').value = m.destete_machos_cantidad ?? '';
      el('manga-destete-kilos-ternero').value = m.destete_kilos_ternero ?? '';
      el('manga-destete-hembras').value = m.destete_hembras_cantidad ?? '';
      el('manga-destete-kilos-ternera').value = m.destete_kilos_ternera ?? '';
    }
  }
  bloquearDesteteSiCorresponde();

  el('manga-editando-texto').textContent = `Estás editando el trabajo ${trabajo.codigo} (${trabajo.fecha}).`;
  el('manga-editando-aviso').classList.remove('oculto');
  el('manga-submit').textContent = 'Guardar corrección';
  location.hash = 'manga';
  el('manga-form').scrollIntoView({ block: 'start' });
}

// Deshabilita los campos del destete (y el checkbox que lo activa) cuando
// se está editando un trabajo que ya lo había ejecutado.
function bloquearDesteteSiCorresponde() {
  const bloquear = editandoTrabajoId !== null && editandoTeniaDestete;
  el('manga-destete-bloqueado').classList.toggle('oculto', !bloquear);
  const campos = [
    'manga-check-destete', 'manga-destete-machos', 'manga-destete-kilos-ternero',
    'manga-destete-rodeo-novillito', 'manga-destete-hembras', 'manga-destete-kilos-ternera',
    'manga-destete-rodeo-vaquillona',
  ];
  for (const id of campos) el(id).disabled = bloquear;
}

function cancelarEdicionManga() {
  editandoTrabajoId = null;
  editandoTeniaDestete = false;
  el('manga-editando-aviso').classList.add('oculto');
  el('manga-submit').textContent = 'Guardar trabajo de manga';
  bloquearDesteteSiCorresponde();
  resetFormulario();
}

function resetFormulario() {
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('manga-establecimiento');
  el('manga-rodeo').innerHTML = '<option value="">Elegir...</option>';
  actualizarCategoriaSegunRodeo();
  limpiarSeleccion('manga-propietarios');
  el('manga-cantidad').value = '';
  el('manga-observaciones').value = '';
  limpiarSanidad();
  limpiarReproduccion();
  limpiarManejo();
}

async function onSubmit(evento) {
  evento.preventDefault();
  const fecha = el('manga-fecha').value;
  const establecimientoId = obtenerSeleccion('manga-establecimiento');
  const categoriaId = obtenerSeleccion('manga-categoria');
  const rodeoId = el('manga-rodeo').value;
  const propietarios = obtenerSeleccionMultiple('manga-propietarios');
  const cantidad = Number(el('manga-cantidad').value);
  const observaciones = el('manga-observaciones').value.trim() || null;

  if (!fecha) { mostrarMensaje('Falta la fecha.', 'error'); return; }
  if (fecha > new Date().toISOString().slice(0, 10)) { mostrarMensaje('La fecha no puede ser futura.', 'error'); return; }
  if (!establecimientoId) { mostrarMensaje('Elegí un establecimiento.', 'error'); return; }
  if (!rodeoId) { mostrarMensaje('Elegí un rodeo.', 'error'); return; }
  if (!categoriaId) { mostrarMensaje('Elegí una categoría.', 'error'); return; }
  if (!propietarios.length) { mostrarMensaje('Elegí al menos un propietario.', 'error'); return; }
  if (!Number.isInteger(cantidad) || cantidad <= 0) { mostrarMensaje('La cantidad trabajada debe ser un entero mayor a 0.', 'error'); return; }
  if (estaActivo('manga-check-reproduccion') && el('manga-estado-corporal').value) {
    const ec = Number(el('manga-estado-corporal').value);
    if (ec < 1 || ec > 5) { mostrarMensaje('El estado corporal debe estar entre 1 y 5.', 'error'); return; }
  }

  const manejo = leerManejo();
  // Al corregir un trabajo que ya tenía destete no se revalida nada de eso:
  // el destete no se rehace (sus movimientos ya están hechos) y además los
  // rodeos destino no quedaron guardados en ningún lado — solo existían en
  // el formulario el día que se cargó, así que este control sería
  // imposible de cumplir y dejaría el trabajo sin poder corregirse nunca.
  const revalidarDestete = manejo?.destete && !(editandoTrabajoId && editandoTeniaDestete);
  if (revalidarDestete) {
    if (propietarios.length !== 1) { mostrarMensaje('Para Destete, elegí un solo propietario (los animales destetados pasan a nombre de uno solo).', 'error'); return; }
    const machos = manejo.destete_machos_cantidad || 0;
    const hembras = manejo.destete_hembras_cantidad || 0;
    if (machos <= 0 && hembras <= 0) { mostrarMensaje('En Destete, cargá al menos machos o hembras.', 'error'); return; }
    if (machos > 0 && (!manejo.destete_kilos_ternero || !manejo.rodeoNovillitoId || manejo.rodeoNovillitoId === '__nuevo__')) {
      mostrarMensaje('Para los machos destetados, cargá los kilos y elegí (o creá) el rodeo destino.', 'error');
      return;
    }
    if (hembras > 0 && (!manejo.destete_kilos_ternera || !manejo.rodeoVaquillonaId || manejo.rodeoVaquillonaId === '__nuevo__')) {
      mostrarMensaje('Para las hembras destetadas, cargá los kilos y elegí (o creá) el rodeo destino.', 'error');
      return;
    }
  }

  if (!navigator.onLine) { mostrarMensaje('Necesitás conexión a internet para guardar un trabajo de manga.', 'error'); return; }

  let stockActual;
  try {
    stockActual = await stockDelRodeo(rodeoId);
  } catch (error) {
    mostrarMensaje('No se pudo verificar el stock del rodeo: ' + error.message, 'error');
    return;
  }
  const diferenciaPendiente = cantidad !== stockActual;

  // Mismo criterio: si el destete no se vuelve a ejecutar, no tiene sentido
  // exigir que hoy haya terneros al pie suficientes (ya se destetaron).
  if (revalidarDestete) {
    try {
      if (manejo.destete_machos_cantidad > 0) {
        const stockTernero = await stockDelRodeoPorCategoria(rodeoId, 'ternero_al_pie');
        if (manejo.destete_machos_cantidad > stockTernero) {
          mostrarMensaje(`No hay ${manejo.destete_machos_cantidad} terneros al pie en ese rodeo (hay ${stockTernero}).`, 'error');
          return;
        }
      }
      if (manejo.destete_hembras_cantidad > 0) {
        const stockTernera = await stockDelRodeoPorCategoria(rodeoId, 'ternera_al_pie');
        if (manejo.destete_hembras_cantidad > stockTernera) {
          mostrarMensaje(`No hay ${manejo.destete_hembras_cantidad} terneras al pie en ese rodeo (hay ${stockTernera}).`, 'error');
          return;
        }
      }
    } catch (error) {
      mostrarMensaje('No se pudo verificar el stock de terneros/as: ' + error.message, 'error');
      return;
    }
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { mostrarMensaje('No hay sesión activa.', 'error'); return; }

  const datosTrabajo = {
    fecha,
    rodeo_id: rodeoId,
    categoria_id: categoriaId,
    cantidad_trabajada: cantidad,
    stock_al_momento: stockActual,
    diferencia_pendiente: diferenciaPendiente,
    observaciones,
  };

  let trabajo;
  if (editandoTrabajoId) {
    // Se actualiza la misma fila (no se crea una nueva como con los
    // movimientos): el código T-000xxx tiene que seguir siendo el mismo
    // porque las rectificaciones y las pesadas apuntan a él.
    const { data, error } = await supabase
      .from('trabajos_manga')
      .update({ ...datosTrabajo, editado_por: session.user.id, editado_at: new Date().toISOString() })
      .eq('id', editandoTrabajoId)
      .select()
      .single();
    if (error) { mostrarMensaje('No se pudo guardar la corrección: ' + error.message, 'error'); return; }
    trabajo = data;
    const errorLimpieza = await borrarHijosDelTrabajo(editandoTrabajoId, { incluirManejo: !editandoTeniaDestete });
    if (errorLimpieza) {
      mostrarMensaje('No se pudieron reemplazar los datos viejos del trabajo: ' + errorLimpieza.message, 'error');
      return;
    }
  } else {
    const { data, error } = await supabase
      .from('trabajos_manga')
      .insert({ ...datosTrabajo, usuario_id: session.user.id })
      .select()
      .single();
    if (error) { mostrarMensaje('No se pudo guardar: ' + error.message, 'error'); return; }
    trabajo = data;
  }

  const { error: errorProp } = await supabase
    .from('trabajo_manga_propietarios')
    .insert(propietarios.map((titularId) => ({ trabajo_manga_id: trabajo.id, titular_id: titularId })));
  if (errorProp) { mostrarMensaje('Se guardó el trabajo, pero no se pudieron guardar los propietarios: ' + errorProp.message, 'advertencia'); return; }

  const sanidad = leerSanidad();
  if (sanidad) {
    try {
      await guardarSanidad(trabajo.id, sanidad);
    } catch (error) {
      mostrarMensaje('Se guardó el trabajo, pero no se pudo guardar la sanidad: ' + error.message, 'advertencia');
      return;
    }
  }

  const reproduccion = leerReproduccion();
  if (reproduccion) {
    try {
      await guardarReproduccion(trabajo.id, reproduccion);
    } catch (error) {
      mostrarMensaje('Se guardó el trabajo, pero no se pudo guardar la reproducción: ' + error.message, 'advertencia');
      return;
    }
  }

  // Si el trabajo que se está editando tenía un destete, su fila de manejo
  // no se borró ni se reescribe: quedaría sin las cantidades destetadas, y
  // esos movimientos de stock ya están hechos.
  if (manejo && !(editandoTrabajoId && editandoTeniaDestete)) {
    try {
      await guardarManejo(
        trabajo.id, manejo,
        { rodeoOrigenId: rodeoId, fecha, titularId: propietarios[0], usuarioId: session.user.id },
        { ejecutarDesteteTambien: !editandoTrabajoId }
      );
    } catch (error) {
      mostrarMensaje('Se guardó el trabajo, pero no se pudo guardar el manejo de rodeo: ' + error.message, 'advertencia');
      return;
    }
  }

  const eraEdicion = Boolean(editandoTrabajoId);
  if (diferenciaPendiente) {
    mostrarMensaje(
      `⚠️ Guardado, pero la cantidad trabajada (${cantidad}) no coincide con el stock del rodeo (${stockActual}). ` +
      'Queda marcado como pendiente hasta que se cargue el movimiento que explique la diferencia (mortandad, faltante, etc.).',
      'advertencia'
    );
  } else {
    mostrarMensaje(eraEdicion ? `✅ Trabajo ${trabajo.codigo} corregido.` : '✅ Trabajo de manga guardado.', 'ok');
  }
  // cancelarEdicionManga limpia el formulario Y sale del modo edición; en
  // una carga normal alcanza con limpiarlo.
  if (eraEdicion) cancelarEdicionManga();
  else resetFormulario();
  refrescarDiferenciasPendientes();
}

export async function initTrabajoManga() {
  await Promise.all([cargarTitulares(), cargarRodeos(), cargarCatalogo('drogas'), cargarCatalogo('vacunas'), cargarCatalogo('otras'), cargarCatalogo('toros')]);
  crearGrupoBotones('manga-establecimiento', ESTABLECIMIENTOS);
  crearGrupoBotones('manga-categoria', CATEGORIAS);
  crearGrupoBotonesMultiple('manga-propietarios', obtenerTitularesCache());
  el('manga-establecimiento').addEventListener('cambio', poblarSelectRodeoManga);
  el('manga-rodeo').addEventListener('change', actualizarCategoriaSegunRodeo);
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  activarBloquesSanidad();
  poblarSelectCatalogo('manga-droga', 'drogas', '+ Nueva droga...');
  inicializarAgregarCatalogo('manga-vacunas-agregar', 'manga-vacunas', 'vacunas', '+ Nueva vacuna...');
  inicializarAgregarCatalogo('manga-otras-agregar', 'manga-otras', 'otras', '+ Nueva...');
  activarBloquesReproduccion();
  inicializarAgregarCatalogo('manga-toros-agregar', 'manga-toros', 'toros', '+ Nuevo toro...');
  activarBloquesManejo();
  inicializarSelectorRodeoDestino('novillito', 'ternero');
  inicializarSelectorRodeoDestino('vaquillona', 'ternera');
  el('manga-form').addEventListener('submit', onSubmit);
  el('manga-editando-cancelar').addEventListener('click', cancelarEdicionManga);
  // Lo dispara Reportes > Trabajo de Manga al tocar "Editar" — vía evento
  // para no armar un import circular entre los dos módulos.
  document.addEventListener('hacienda:editar-trabajo-manga', (evento) => precargarParaEditarManga(evento.detail));
  refrescarDiferenciasPendientes();

  poblarSelectConsultaManga();
  el('manga-consulta-establecimiento').addEventListener('change', refrescarConsultaManga);
  el('manga-consulta-actualizar').addEventListener('click', refrescarConsultaManga);
  refrescarConsultaManga();
}
