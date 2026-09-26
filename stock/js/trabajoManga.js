// Trabajo de Manga: bitácora de sanidad/reproducción/manejo sobre un
// rodeo — NO es un movimiento de stock (salvo Destete, que además dispara
// movimientos reales de cambio_categoria — ver M11).
//
// Se carga de arriba hacia abajo: establecimiento → rodeo → lo que hay
// adentro de ese rodeo → quiénes de esos titulares entraron a la manga →
// cuántas se encerraron y, de esas, cuántas se trabajaron, por categoría.
//
// Hasta la migración 045 esto era distinto: un trabajo era de UNA
// categoría y anotaba UNA cantidad trabajada, que se comparaba contra el
// stock del rodeo; si no coincidía quedaba una "diferencia pendiente"
// que alguien tenía que ir a resolver después (y si el ingreso se
// cargaba después del trabajo, saltaban todas juntas). Ahora la
// diferencia no es una alerta: es un dato del propio trabajo.
import { supabase } from './supabaseClient.js';
import { CATEGORIAS, ESTABLECIMIENTOS } from './config.js';
import { getEstado } from './auth.js';
import { cargarTitulares, obtenerTitularesCache } from './titulares.js';
import { cargarRodeos, rodeosDeEstablecimiento, obtenerRodeosCache, crearRodeo, stockDelRodeoPorCategoria, stockDetalladoDelRodeo, composicionDelRodeo, hayComposicionCargada, cargarComposicionRodeos } from './rodeos.js';
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
      // Igual que en Cargar movimiento: el nombre del rodeo no dice qué
      // tiene adentro, así que lo dice la opción.
      const composicion = hayComposicionCargada() ? composicionDelRodeo(r.id) : [];
      opt.textContent = hayComposicionCargada()
        ? `${r.codigo} — ${composicion.length ? composicion.map((c) => `${nombreCategoria(c.categoriaId)} ${c.cabezas}`).join(' · ') : 'sin stock'}`
        : r.codigo;
      select.appendChild(opt);
    }
  }
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

// ─── Lo que hay adentro del rodeo elegido ───────────────────────────────
// De acá sale todo lo que viene después en el formulario: qué titulares
// se pueden elegir y qué categorías se pueden cargar. Se pide en vivo
// (no a la caché de composición, que es una foto para dibujar los
// selectores) porque de estos números salen las cantidades que se cargan.
let stockDelRodeoElegido = [];  // [{ categoriaId, titularId, cabezas }]

function nombreTitular(titularId) {
  return obtenerTitularesCache().find((t) => t.id === titularId)?.nombre || titularId;
}

function sumarPorCategoria(filas) {
  const porCategoria = new Map();
  for (const f of filas) porCategoria.set(f.categoriaId, (porCategoria.get(f.categoriaId) || 0) + f.cabezas);
  return [...porCategoria].map(([categoriaId, cabezas]) => ({ categoriaId, cabezas }))
    .sort((a, b) => b.cabezas - a.cabezas);
}

async function alCambiarRodeoManga() {
  const rodeoId = el('manga-rodeo').value;
  stockDelRodeoElegido = [];
  if (rodeoId) {
    try {
      stockDelRodeoElegido = await stockDetalladoDelRodeo(rodeoId);
    } catch (error) {
      console.warn('No se pudo traer el stock del rodeo:', error);
    }
  }
  renderStockDelRodeo();
  actualizarPropietariosDisponibles();
  renderCategoriasDelRodeo();
}

function renderStockDelRodeo() {
  const bloque = el('manga-stock-bloque');
  const detalle = el('manga-stock-detalle');
  detalle.innerHTML = '';
  if (!el('manga-rodeo').value) { bloque.classList.add('oculto'); return; }
  bloque.classList.remove('oculto');

  if (!stockDelRodeoElegido.length) {
    const p = document.createElement('div');
    p.className = 'ayuda';
    p.textContent = navigator.onLine
      ? 'Este rodeo no tiene stock cargado.'
      : 'Sin conexión no se puede mostrar el stock del rodeo.';
    detalle.appendChild(p);
    return;
  }

  // Una línea por categoría, con el detalle de titulares abajo: es el
  // orden en que se mira ("¿cuántas vacas hay? ¿de quién son?").
  for (const { categoriaId, cabezas } of sumarPorCategoria(stockDelRodeoElegido)) {
    const fila = document.createElement('div');
    fila.className = 'manga-stock-fila';
    const titulo = document.createElement('strong');
    titulo.textContent = `${nombreCategoria(categoriaId)}: ${cabezas}`;
    fila.appendChild(titulo);
    const porTitular = stockDelRodeoElegido.filter((f) => f.categoriaId === categoriaId)
      .sort((a, b) => b.cabezas - a.cabezas);
    if (porTitular.length > 1 || porTitular[0]?.titularId) {
      const quienes = document.createElement('span');
      quienes.className = 'manga-stock-titulares';
      quienes.textContent = porTitular.map((f) => `${nombreTitular(f.titularId)} ${f.cabezas}`).join(' · ');
      fila.appendChild(quienes);
    }
    detalle.appendChild(fila);
  }
}

// Solo se pueden elegir como propietarios los titulares que realmente
// tienen animales en ese rodeo — no tiene sentido anotar un trabajo a
// nombre de alguien que no tiene ni una cabeza ahí.
function actualizarPropietariosDisponibles() {
  const grupo = el('manga-propietarios');
  const ayuda = el('manga-propietarios-ayuda');
  const hayRodeo = Boolean(el('manga-rodeo').value);
  const conStock = new Set(stockDelRodeoElegido.map((f) => f.titularId));
  // Sin rodeo elegido (o sin haber podido traer el stock) se deja todo
  // habilitado: es preferible dejar cargar a trabar el formulario.
  const filtrar = hayRodeo && conStock.size > 0;

  grupo.querySelectorAll('.boton-opcion').forEach((boton) => {
    const disponible = !filtrar || conStock.has(boton.dataset.value);
    boton.disabled = !disponible;
    boton.classList.toggle('deshabilitado', !disponible);
    if (!disponible) boton.classList.remove('seleccionado');
  });

  ayuda.textContent = filtrar ? 'Solo aparecen los que tienen hacienda en este rodeo.' : '';
  ayuda.classList.toggle('oculto', !filtrar);
}

// Una fila por categoría con stock: cuántas se encerraron y, de esas,
// cuántas se trabajaron. Las categorías que se ofrecen dependen de los
// propietarios elegidos — si trabajás solo las de Doña Julia, no tiene
// sentido que aparezcan categorías donde ella no tiene nada.
function renderCategoriasDelRodeo(precargadas) {
  const contenedor = el('manga-categorias');
  const vacio = el('manga-categorias-vacio');
  // Al redibujar (ej. al cambiar de propietario) no se pierde lo tipeado.
  const previos = precargadas || leerCategoriasCargadas();
  contenedor.innerHTML = '';

  if (!el('manga-rodeo').value) {
    vacio.textContent = 'Elegí primero el rodeo.';
    vacio.classList.remove('oculto');
    return;
  }

  const elegidos = obtenerSeleccionMultiple('manga-propietarios');
  const filas = elegidos.length
    ? stockDelRodeoElegido.filter((f) => elegidos.includes(f.titularId))
    : stockDelRodeoElegido;
  const porCategoria = sumarPorCategoria(filas);
  // Una categoría que se está corrigiendo (o que se acaba de comprar)
  // tiene que aparecer aunque el rodeo ya no tenga stock de ella.
  for (const c of previos) {
    if (!porCategoria.some((p) => p.categoriaId === c.categoriaId)) {
      porCategoria.push({ categoriaId: c.categoriaId, cabezas: 0 });
    }
  }

  if (!porCategoria.length) {
    vacio.textContent = navigator.onLine
      ? 'Ese rodeo no tiene stock de los propietarios elegidos.'
      : 'Sin conexión no se puede saber qué hay en el rodeo.';
    vacio.classList.remove('oculto');
    return;
  }
  vacio.classList.add('oculto');

  for (const { categoriaId, cabezas } of porCategoria) {
    const fila = document.createElement('div');
    fila.className = 'manga-categoria-fila';

    const etiqueta = document.createElement('div');
    etiqueta.className = 'manga-categoria-nombre';
    etiqueta.textContent = `${nombreCategoria(categoriaId)} — hay ${cabezas}`;
    fila.appendChild(etiqueta);

    for (const [campo, titulo] of [['encerradas', 'Encerradas'], ['trabajadas', 'Trabajadas']]) {
      const label = document.createElement('label');
      label.textContent = titulo;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.dataset.categoria = categoriaId;
      input.dataset.campo = campo;
      const previo = previos.find((c) => c.categoriaId === categoriaId);
      if (previo && previo[campo]) input.value = previo[campo];
      label.appendChild(input);
      fila.appendChild(label);
    }
    contenedor.appendChild(fila);
  }
}

// Lo cargado en las filas de arriba, ignorando las que quedaron en cero
// (encerrar cero animales de una categoría es no haberla trabajado).
function leerCategoriasCargadas() {
  const porCategoria = new Map();
  for (const input of el('manga-categorias').querySelectorAll('input[data-categoria]')) {
    const actual = porCategoria.get(input.dataset.categoria) || { categoriaId: input.dataset.categoria, encerradas: 0, trabajadas: 0 };
    actual[input.dataset.campo] = Number(input.value) || 0;
    porCategoria.set(input.dataset.categoria, actual);
  }
  return [...porCategoria.values()].filter((c) => c.encerradas > 0 || c.trabajadas > 0);
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

// Los destinos posibles son los rodeos del MISMO establecimiento que el
// rodeo madre: desde la migración 045 un rodeo no tiene categoría, así
// que los destetados pueden ir a un rodeo que ya existe (incluso al de
// las madres) en vez de obligar a crear uno nuevo por categoría.
function poblarSelectRodeoDestino(idSelect) {
  const select = el(idSelect);
  const valorPrevio = select.value;
  select.innerHTML = '<option value="">Elegir...</option>';
  const establecimientoId = obtenerRodeosCache().find((r) => r.id === el('manga-rodeo').value)?.establecimiento_id;
  for (const r of (establecimientoId ? rodeosDeEstablecimiento(establecimientoId) : [])) {
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

function inicializarSelectorRodeoDestino(prefijo) {
  const idSelect = `manga-destete-rodeo-${prefijo}`;
  const idWrap = `${idSelect}-nuevo-wrap`;
  const idNombre = `${idSelect}-nombre`;
  const idFecha = `${idSelect}-fecha`;
  const idCrear = `${idSelect}-crear`;

  poblarSelectRodeoDestino(idSelect);
  // Los destinos dependen del rodeo madre, que se elige más arriba.
  el('manga-rodeo').addEventListener('change', () => poblarSelectRodeoDestino(idSelect));

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
        establecimientoId,
        fechaCreacion: el(idFecha).value || undefined,
        usuarioId: getEstado().session.user.id,
      });
      poblarSelectRodeoDestino(idSelect);
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
    'trabajo_manga_propietarios', 'trabajo_manga_categorias', 'trabajo_manga_sanidad', 'trabajo_manga_vacunas',
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

// ─── Diferencias pendientes: se fueron (migración 045) ─────────────────
// Acá vivían la lista de "diferencias pendientes de resolver" y el
// circuito de rectificación con aprobación del owner. Existían porque un
// trabajo anotaba UNA cantidad trabajada y se la comparaba contra el
// stock del rodeo. Ahora el trabajo anota cuántas se encerraron y cuántas
// se trabajaron, así que la diferencia ya es parte del dato cargado y no
// hay nada que ir a resolver después.

function nombreCategoria(categoriaId) {
  return CATEGORIAS.find((c) => c.id === categoriaId)?.nombre || categoriaId;
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

  // El rodeo se puebla a partir del establecimiento, y de lo que hay
  // adentro del rodeo salen los propietarios y las categorías — así que
  // el orden importa y hay que esperar al stock antes de marcar nada.
  const rodeo = obtenerRodeosCache().find((r) => r.id === trabajo.rodeo_id);
  if (rodeo) establecerSeleccion('manga-establecimiento', rodeo.establecimiento_id);
  poblarSelectRodeoManga();
  el('manga-rodeo').value = trabajo.rodeo_id;
  await alCambiarRodeoManga();

  establecerSeleccionMultiple('manga-propietarios', trabajo.propietariosIds);
  // Las cantidades del trabajo mandan sobre lo que haya en el rodeo hoy:
  // un trabajo viejo puede tener categorías que ese rodeo ya no tiene.
  renderCategoriasDelRodeo(trabajo.categorias);
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

// Llega desde Cargar movimiento, al responder que SÍ a "¿les hiciste
// sanidad?" después de guardar una Compra (ver ofrecerCargarSanidadDelIngreso
// en movimientos.js). Deja el trabajo casi armado —mismo rodeo, misma
// categoría, mismo propietario, misma cantidad y fecha que el ingreso— y
// abre la sección SANIDAD, que es lo que se acaba de responder que se
// hizo. Todo sigue siendo editable: si se trabajaron menos cabezas que
// las que entraron, se corrige acá.
async function precargarParaSanidadDeIngreso({ establecimientoId, rodeoId, categoriaId, cantidad, fecha, titularId }) {
  cancelarEdicionManga();
  if (fecha) el('manga-fecha').value = fecha;
  // Mismo orden que precargarParaEditarManga: establecimiento → rodeo →
  // stock del rodeo → propietarios y categorías.
  if (establecimientoId) establecerSeleccion('manga-establecimiento', establecimientoId);
  poblarSelectRodeoManga();
  if (rodeoId) el('manga-rodeo').value = rodeoId;
  await alCambiarRodeoManga();
  if (titularId) establecerSeleccionMultiple('manga-propietarios', [titularId]);
  // Las que entraron quedan como encerradas Y trabajadas: es lo más
  // probable (se las encerró para hacerles la sanidad al bajarlas), y si
  // fueron menos se corrige acá mismo.
  renderCategoriasDelRodeo(categoriaId && cantidad
    ? [{ categoriaId, encerradas: cantidad, trabajadas: cantidad }]
    : null);
  ponerToggle('manga-check-sanidad', true);
  location.hash = 'manga';
}

function resetFormulario() {
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  limpiarSeleccion('manga-establecimiento');
  el('manga-rodeo').innerHTML = '<option value="">Elegir...</option>';
  stockDelRodeoElegido = [];
  renderStockDelRodeo();
  limpiarSeleccion('manga-propietarios');
  actualizarPropietariosDisponibles();
  renderCategoriasDelRodeo();
  el('manga-observaciones').value = '';
  limpiarSanidad();
  limpiarReproduccion();
  limpiarManejo();
}

async function onSubmit(evento) {
  evento.preventDefault();
  const fecha = el('manga-fecha').value;
  const establecimientoId = obtenerSeleccion('manga-establecimiento');
  const rodeoId = el('manga-rodeo').value;
  const propietarios = obtenerSeleccionMultiple('manga-propietarios');
  const categorias = leerCategoriasCargadas();
  const encerradasTotal = categorias.reduce((n, c) => n + c.encerradas, 0);
  const trabajadasTotal = categorias.reduce((n, c) => n + c.trabajadas, 0);
  const observaciones = el('manga-observaciones').value.trim() || null;

  if (!fecha) { mostrarMensaje('Falta la fecha.', 'error'); return; }
  if (fecha > new Date().toISOString().slice(0, 10)) { mostrarMensaje('La fecha no puede ser futura.', 'error'); return; }
  if (!establecimientoId) { mostrarMensaje('Elegí un establecimiento.', 'error'); return; }
  if (!rodeoId) { mostrarMensaje('Elegí un rodeo.', 'error'); return; }
  if (!propietarios.length) { mostrarMensaje('Elegí al menos un propietario.', 'error'); return; }
  if (!categorias.length) { mostrarMensaje('Cargá cuántas se encerraron, al menos en una categoría.', 'error'); return; }
  for (const c of categorias) {
    if (!Number.isInteger(c.encerradas) || !Number.isInteger(c.trabajadas)) {
      mostrarMensaje('Las cantidades tienen que ser números enteros.', 'error');
      return;
    }
    if (c.trabajadas > c.encerradas) {
      mostrarMensaje(`En ${nombreCategoria(c.categoriaId)} no se pueden trabajar más (${c.trabajadas}) de las que se encerraron (${c.encerradas}).`, 'error');
      return;
    }
  }
  if (encerradasTotal <= 0) { mostrarMensaje('Cargá cuántas se encerraron.', 'error'); return; }
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

  // categoria_id queda null: un trabajo ya no es de UNA categoría, el
  // detalle va a trabajo_manga_categorias. Los totales se siguen
  // guardando acá para que el historial, los reportes y el Excel lean de
  // donde leían siempre (ver migración 045).
  const datosTrabajo = {
    fecha,
    rodeo_id: rodeoId,
    categoria_id: null,
    cantidad_encerrada: encerradasTotal,
    cantidad_trabajada: trabajadasTotal,
    stock_al_momento: null,
    diferencia_pendiente: false,
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

  const { error: errorCategorias } = await supabase
    .from('trabajo_manga_categorias')
    .insert(categorias.map((c) => ({
      trabajo_manga_id: trabajo.id,
      categoria_id: c.categoriaId,
      encerradas: c.encerradas,
      trabajadas: c.trabajadas,
    })));
  if (errorCategorias) { mostrarMensaje('Se guardó el trabajo, pero no se pudieron guardar las cantidades por categoría: ' + errorCategorias.message, 'advertencia'); return; }

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
  const resumen = encerradasTotal === trabajadasTotal
    ? `${trabajadasTotal} encerradas y trabajadas`
    : `${encerradasTotal} encerradas, ${trabajadasTotal} trabajadas`;
  mostrarMensaje(
    eraEdicion ? `✅ Trabajo ${trabajo.codigo} corregido (${resumen}).` : `✅ Trabajo de manga guardado (${resumen}).`,
    'ok'
  );
  // cancelarEdicionManga limpia el formulario Y sale del modo edición; en
  // una carga normal alcanza con limpiarlo.
  if (eraEdicion) cancelarEdicionManga();
  else resetFormulario();
  // El trabajo no mueve stock, pero el destete sí — y la composición de
  // los rodeos se lee en los selectores de todas las pantallas.
  cargarComposicionRodeos();
}

export async function initTrabajoManga() {
  await Promise.all([cargarTitulares(), cargarRodeos(), cargarCatalogo('drogas'), cargarCatalogo('vacunas'), cargarCatalogo('otras'), cargarCatalogo('toros')]);
  crearGrupoBotones('manga-establecimiento', ESTABLECIMIENTOS);
  crearGrupoBotonesMultiple('manga-propietarios', obtenerTitularesCache());
  el('manga-establecimiento').addEventListener('cambio', poblarSelectRodeoManga);
  el('manga-rodeo').addEventListener('change', alCambiarRodeoManga);
  // Cambiar de propietario cambia qué categorías tienen stock a nombre de
  // los elegidos, así que las filas se rehacen.
  el('manga-propietarios').addEventListener('cambio', () => renderCategoriasDelRodeo());
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  activarBloquesSanidad();
  poblarSelectCatalogo('manga-droga', 'drogas', '+ Nueva droga...');
  inicializarAgregarCatalogo('manga-vacunas-agregar', 'manga-vacunas', 'vacunas', '+ Nueva vacuna...');
  inicializarAgregarCatalogo('manga-otras-agregar', 'manga-otras', 'otras', '+ Nueva...');
  activarBloquesReproduccion();
  inicializarAgregarCatalogo('manga-toros-agregar', 'manga-toros', 'toros', '+ Nuevo toro...');
  activarBloquesManejo();
  inicializarSelectorRodeoDestino('novillito');
  inicializarSelectorRodeoDestino('vaquillona');
  el('manga-form').addEventListener('submit', onSubmit);
  el('manga-editando-cancelar').addEventListener('click', cancelarEdicionManga);
  // Lo dispara Reportes > Trabajo de Manga al tocar "Editar" — vía evento
  // para no armar un import circular entre los dos módulos.
  document.addEventListener('hacienda:editar-trabajo-manga', (evento) => precargarParaEditarManga(evento.detail));
  document.addEventListener('hacienda:precargar-manga', (evento) => precargarParaSanidadDeIngreso(evento.detail));

  poblarSelectConsultaManga();
  el('manga-consulta-establecimiento').addEventListener('change', refrescarConsultaManga);
  el('manga-consulta-actualizar').addEventListener('click', refrescarConsultaManga);
  refrescarConsultaManga();
}
