// Trabajo de Manga: bitácora de sanidad/reproducción/manejo sobre un
// rodeo — NO es un movimiento de stock (salvo Destete, que además dispara
// movimientos reales de cambio_categoria — ver M11). Esta base (M8) cubre
// solo fecha/propietario(s)/rodeo/categoría/cantidad trabajada, con
// alerta si la cantidad no coincide con el stock real del rodeo (no
// bloquea: se resuelve sola cuando el stock vuelve a coincidir tras un
// movimiento real, vía trigger resolver_diferencia_manga en la base).
import { supabase } from './supabaseClient.js';
import { CATEGORIAS } from './config.js';
import { getEstado } from './auth.js';
import { cargarTitulares, obtenerTitularesCache } from './titulares.js';
import { cargarRodeos, rodeosDeCategoria, obtenerRodeosCache, crearRodeo, stockDelRodeo, stockDelRodeoPorCategoria } from './rodeos.js';
import { crearGrupoBotones, crearGrupoBotonesMultiple, obtenerSeleccion, obtenerSeleccionMultiple, establecerSeleccion, limpiarSeleccion, inicializarBotonToggle, estaActivo, desactivarBoton } from './botones.js';

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

function poblarSelectRodeoManga() {
  const categoriaId = obtenerSeleccion('manga-categoria');
  const select = el('manga-rodeo');
  const valorPrevio = select.value;
  select.innerHTML = '<option value="">Elegir...</option>';
  if (categoriaId) {
    for (const r of rodeosDeCategoria(categoriaId)) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.codigo;
      select.appendChild(opt);
    }
  }
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
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
// — pero SÍ dispara movimientos reales de cambio_categoria (ternero→
// novillito, ternera→vaquillona) que además cambian de rodeo (cada sexo
// pasa a su propio rodeo nuevo), ver ejecutarDestete().

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
  const opcionNueva = document.createElement('option');
  opcionNueva.value = '__nuevo__';
  opcionNueva.textContent = '+ Crear rodeo nuevo...';
  select.appendChild(opcionNueva);
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
      categoria_origen: 'ternero',
      categoria_destino: 'novillito',
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
      categoria_origen: 'ternera',
      categoria_destino: 'vaquillona',
      rodeo_destino_id: manejo.rodeoVaquillonaId,
      cantidad_cabezas: manejo.destete_hembras_cantidad,
      kilos_promedio: manejo.destete_kilos_ternera,
    });
    if (error) throw new Error('movimiento de hembras: ' + error.message);
  }
}

async function guardarManejo(trabajoMangaId, manejo, contexto) {
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

  if (manejo.destete) {
    await ejecutarDestete(trabajoMangaId, manejo, contexto);
  }
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

async function editarCantidadTrabajada(trabajo) {
  const nuevaTexto = prompt(`Cantidad trabajada correcta para ${trabajo.codigo} (rodeo ${trabajo.rodeoCodigo}):`, trabajo.cantidad_trabajada);
  if (nuevaTexto === null) return;
  const nueva = Number(nuevaTexto);
  if (!Number.isInteger(nueva) || nueva <= 0) {
    alert('Tiene que ser un entero mayor a 0.');
    return;
  }
  let stockActual;
  try {
    stockActual = await stockDelRodeo(trabajo.rodeo_id);
  } catch (error) {
    alert('No se pudo verificar el stock del rodeo: ' + error.message);
    return;
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
    return;
  }
  if (sigueDiferente) {
    alert(`Guardado, pero ${nueva} todavía no coincide con el stock actual del rodeo (${stockActual}). Sigue pendiente.`);
  }
  await refrescarDiferenciasPendientes();
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

function renderDiferenciasPendientes(pendientes) {
  const bloque = el('manga-pendientes-bloque');
  const contenedor = el('manga-pendientes-lista');
  bloque.classList.toggle('oculto', !pendientes.length);
  contenedor.innerHTML = '';
  for (const trabajo of pendientes) {
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

    const btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.textContent = 'Corregir cantidad';
    btnEditar.addEventListener('click', () => editarCantidadTrabajada(trabajo));
    botones.appendChild(btnEditar);

    const btnMovimiento = document.createElement('button');
    btnMovimiento.type = 'button';
    btnMovimiento.className = 'boton-secundario';
    btnMovimiento.textContent = 'Cargar movimiento que lo explica';
    btnMovimiento.addEventListener('click', () => pedirMovimientoParaDiferencia(trabajo));
    botones.appendChild(btnMovimiento);

    div.appendChild(botones);
    contenedor.appendChild(div);
  }
}

export async function refrescarDiferenciasPendientes() {
  if (!navigator.onLine) return;
  const { data, error } = await supabase
    .from('trabajos_manga')
    .select('id, codigo, fecha, rodeo_id, categoria_id, cantidad_trabajada')
    .eq('diferencia_pendiente', true)
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

function mostrarMensaje(texto, tipo) {
  const contenedor = el('manga-mensaje');
  contenedor.textContent = texto;
  contenedor.className = tipo; // 'error' | 'ok' | 'advertencia'
}

function resetFormulario() {
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('manga-categoria');
  el('manga-rodeo').innerHTML = '<option value="">Elegir...</option>';
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
  const categoriaId = obtenerSeleccion('manga-categoria');
  const rodeoId = el('manga-rodeo').value;
  const propietarios = obtenerSeleccionMultiple('manga-propietarios');
  const cantidad = Number(el('manga-cantidad').value);
  const observaciones = el('manga-observaciones').value.trim() || null;

  if (!fecha) { mostrarMensaje('Falta la fecha.', 'error'); return; }
  if (fecha > new Date().toISOString().slice(0, 10)) { mostrarMensaje('La fecha no puede ser futura.', 'error'); return; }
  if (!categoriaId) { mostrarMensaje('Elegí una categoría.', 'error'); return; }
  if (!rodeoId) { mostrarMensaje('Elegí un rodeo.', 'error'); return; }
  if (!propietarios.length) { mostrarMensaje('Elegí al menos un propietario.', 'error'); return; }
  if (!Number.isInteger(cantidad) || cantidad <= 0) { mostrarMensaje('La cantidad trabajada debe ser un entero mayor a 0.', 'error'); return; }
  if (estaActivo('manga-check-reproduccion') && el('manga-estado-corporal').value) {
    const ec = Number(el('manga-estado-corporal').value);
    if (ec < 1 || ec > 5) { mostrarMensaje('El estado corporal debe estar entre 1 y 5.', 'error'); return; }
  }

  const manejo = leerManejo();
  if (manejo && manejo.destete) {
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

  if (manejo && manejo.destete) {
    try {
      if (manejo.destete_machos_cantidad > 0) {
        const stockTernero = await stockDelRodeoPorCategoria(rodeoId, 'ternero');
        if (manejo.destete_machos_cantidad > stockTernero) {
          mostrarMensaje(`No hay ${manejo.destete_machos_cantidad} terneros en ese rodeo (hay ${stockTernero}).`, 'error');
          return;
        }
      }
      if (manejo.destete_hembras_cantidad > 0) {
        const stockTernera = await stockDelRodeoPorCategoria(rodeoId, 'ternera');
        if (manejo.destete_hembras_cantidad > stockTernera) {
          mostrarMensaje(`No hay ${manejo.destete_hembras_cantidad} terneras en ese rodeo (hay ${stockTernera}).`, 'error');
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

  const { data: trabajo, error: errorTrabajo } = await supabase
    .from('trabajos_manga')
    .insert({
      fecha,
      rodeo_id: rodeoId,
      categoria_id: categoriaId,
      cantidad_trabajada: cantidad,
      stock_al_momento: stockActual,
      diferencia_pendiente: diferenciaPendiente,
      usuario_id: session.user.id,
      observaciones,
    })
    .select()
    .single();
  if (errorTrabajo) { mostrarMensaje('No se pudo guardar: ' + errorTrabajo.message, 'error'); return; }

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

  if (manejo) {
    try {
      await guardarManejo(trabajo.id, manejo, { rodeoOrigenId: rodeoId, fecha, titularId: propietarios[0], usuarioId: session.user.id });
    } catch (error) {
      mostrarMensaje('Se guardó el trabajo, pero no se pudo guardar el manejo de rodeo: ' + error.message, 'advertencia');
      return;
    }
  }

  if (diferenciaPendiente) {
    mostrarMensaje(
      `⚠️ Guardado, pero la cantidad trabajada (${cantidad}) no coincide con el stock del rodeo (${stockActual}). ` +
      'Queda marcado como pendiente hasta que se cargue el movimiento que explique la diferencia (mortandad, faltante, etc.).',
      'advertencia'
    );
  } else {
    mostrarMensaje('✅ Trabajo de manga guardado.', 'ok');
  }
  resetFormulario();
  refrescarDiferenciasPendientes();
}

export async function initTrabajoManga() {
  await Promise.all([cargarTitulares(), cargarRodeos(), cargarCatalogo('drogas'), cargarCatalogo('vacunas'), cargarCatalogo('otras'), cargarCatalogo('toros')]);
  crearGrupoBotones('manga-categoria', CATEGORIAS);
  crearGrupoBotonesMultiple('manga-propietarios', obtenerTitularesCache());
  el('manga-categoria').addEventListener('cambio', poblarSelectRodeoManga);
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  activarBloquesSanidad();
  poblarSelectCatalogo('manga-droga', 'drogas', '+ Nueva droga...');
  inicializarAgregarCatalogo('manga-vacunas-agregar', 'manga-vacunas', 'vacunas', '+ Nueva vacuna...');
  inicializarAgregarCatalogo('manga-otras-agregar', 'manga-otras', 'otras', '+ Nueva...');
  activarBloquesReproduccion();
  inicializarAgregarCatalogo('manga-toros-agregar', 'manga-toros', 'toros', '+ Nuevo toro...');
  activarBloquesManejo();
  inicializarSelectorRodeoDestino('novillito', 'novillito');
  inicializarSelectorRodeoDestino('vaquillona', 'vaquillona');
  el('manga-form').addEventListener('submit', onSubmit);
  refrescarDiferenciasPendientes();
}
