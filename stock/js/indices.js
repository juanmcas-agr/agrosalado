// Cartel de recordatorio de Índices reproductivos (M10 del plan de
// Reportes/Índices): revisa, en los mismos disparadores que sync.js
// (online/visibilitychange) más al iniciar la app, si algún índice está
// pendiente de carga o de reconfirmación, y muestra un cartel persistente
// y NO bloqueante cerca de #sync-estado — no impide seguir usando el
// resto de la app. Clic en el cartel lleva a Reportes > Índices.
import { supabase } from './supabaseClient.js';
import { INDICES, ordenIndices, fechaGatilloDelAnio, hoyArtISO } from './indicesConfig.js';

function el(id) {
  return document.getElementById(id);
}

// El "año relevante" de un índice es el de su gatillo más reciente que ya
// llegó: antes del gatillo de este año se evalúa contra el del año pasado
// (que ya debería estar resuelto de su propio ciclo, así que no molesta
// antes de tiempo); desde el gatillo de este año (inclusive) pasa a
// evaluarse contra el de este año. El cartel reaparece solo, un año
// después, porque la fila de ese año todavía no existe — no hace falta
// lógica de "reset" (ver decisión de diseño del plan).
function anioRelevante(tipo, hoyIso) {
  const anioActual = Number(hoyIso.slice(0, 4));
  return hoyIso >= fechaGatilloDelAnio(tipo, anioActual) ? anioActual : anioActual - 1;
}

// Doble condición del plan: pendiente si no está corroborado, O si hoy es
// justo el día del gatillo y la corroboración que tiene es de ANTES de
// hoy (fuerza reconfirmar el mismo día del gatillo aunque ya se hubiera
// cargado/corroborado de antemano).
function estaPendiente(tipo, anio, hoyIso, fila) {
  const gatillo = fechaGatilloDelAnio(tipo, anio);
  if (!fila || !fila.corroborado) return true;
  if (hoyIso !== gatillo) return false;
  const corroboradoIso = fila.corroborado_at ? fila.corroborado_at.slice(0, 10) : null;
  return !corroboradoIso || corroboradoIso < gatillo;
}

async function calcularPendientes() {
  const hoyIso = hoyArtISO();
  const anios = ordenIndices().map((tipo) => anioRelevante(tipo, hoyIso));
  const anioMin = Math.min(...anios);
  const anioMax = Math.max(...anios);

  const { data, error } = await supabase.from('indices_valores')
    .select('tipo_indice, anio, corroborado, corroborado_at')
    .gte('anio', anioMin).lte('anio', anioMax);
  if (error) throw error;

  const porTipoAnio = {};
  for (const fila of data) porTipoAnio[`${fila.tipo_indice}_${fila.anio}`] = fila;

  const pendientes = [];
  for (const tipo of ordenIndices()) {
    const anio = anioRelevante(tipo, hoyIso);
    const fila = porTipoAnio[`${tipo}_${anio}`] || null;
    if (estaPendiente(tipo, anio, hoyIso, fila)) {
      pendientes.push({ tipo, anio, nombre: INDICES[tipo].nombre });
    }
  }
  return pendientes;
}

function renderCartel(pendientes) {
  const banner = el('indices-recordatorio');
  if (!banner) return;
  if (!pendientes.length) {
    banner.classList.add('oculto');
    banner.textContent = '';
    return;
  }
  const nombres = pendientes.map((p) => `${p.nombre} (${p.anio})`).join(', ');
  banner.textContent = `Índices pendientes de cargar/corroborar: ${nombres}. Tocá para ir a Reportes > Índices.`;
  banner.classList.remove('oculto');
}

// Se llama al iniciar, en los disparadores de conectividad, y desde
// Reportes > Índices después de guardar/corroborar — así el cartel
// desaparece solo, sin recargar la página.
export async function revisarRecordatorioIndices() {
  try {
    renderCartel(await calcularPendientes());
  } catch (error) {
    console.error('No se pudo calcular el recordatorio de índices:', error);
  }
}

export function initIndicesRecordatorio() {
  el('indices-recordatorio').addEventListener('click', () => {
    location.hash = 'reportes';
    document.dispatchEvent(new CustomEvent('hacienda:ver-indices'));
  });
  window.addEventListener('online', () => revisarRecordatorioIndices());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisarRecordatorioIndices();
  });
  revisarRecordatorioIndices();
}
