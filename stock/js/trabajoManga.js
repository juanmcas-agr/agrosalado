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
import { cargarRodeos, rodeosDeCategoria, stockDelRodeo } from './rodeos.js';
import { crearGrupoBotones, crearGrupoBotonesMultiple, obtenerSeleccion, obtenerSeleccionMultiple, establecerSeleccion, limpiarSeleccion } from './botones.js';

function el(id) {
  return document.getElementById(id);
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

  if (!navigator.onLine) { mostrarMensaje('Necesitás conexión a internet para guardar un trabajo de manga.', 'error'); return; }

  let stockActual;
  try {
    stockActual = await stockDelRodeo(rodeoId);
  } catch (error) {
    mostrarMensaje('No se pudo verificar el stock del rodeo: ' + error.message, 'error');
    return;
  }
  const diferenciaPendiente = cantidad !== stockActual;

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
}

export async function initTrabajoManga() {
  await Promise.all([cargarTitulares(), cargarRodeos()]);
  crearGrupoBotones('manga-categoria', CATEGORIAS);
  crearGrupoBotonesMultiple('manga-propietarios', obtenerTitularesCache());
  el('manga-categoria').addEventListener('cambio', poblarSelectRodeoManga);
  el('manga-fecha').value = new Date().toISOString().slice(0, 10);
  el('manga-form').addEventListener('submit', onSubmit);
}
