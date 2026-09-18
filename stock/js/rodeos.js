// Rodeos: grupos de animales que se trackean como unidad (nacen, engordan,
// se mueven de establecimiento, van a feed lot, se venden). Mismo patrón
// que titulares.js (cache local + alta on-the-fly desde el formulario).
import { supabase } from './supabaseClient.js';

let cache = [];

export async function cargarRodeos() {
  const { data, error } = await supabase.from('rodeos').select('*').eq('activo', true).order('codigo');
  if (!error) cache = data;
  return cache;
}

export function obtenerRodeosCache() {
  return cache;
}

// Nota: los rodeos de Feed Lot (los 4 corrales fijos) nunca aparecen acá
// con una categoria_id útil para filtrar — ver rodeoDelCorral() más abajo,
// que es como se resuelve un rodeo en Feed Lot (por corral, no por
// categoría/establecimiento como el resto).
export function rodeosDe(establecimientoId, categoriaId) {
  return cache.filter((r) => r.establecimiento_id === establecimientoId && r.categoria_id === categoriaId);
}

// Para el rodeo destino de Destete (Trabajo de Manga > Manejo de rodeo):
// no se elige establecimiento por separado ahí, así que alcanza con
// filtrar por categoría.
export function rodeosDeCategoria(categoriaId) {
  return cache.filter((r) => r.categoria_id === categoriaId);
}

// Para el selector principal de Trabajo de Manga: el rodeo se elige
// primero (solo filtrado por establecimiento) y la categoría se deriva
// del rodeo elegido, no al revés — un rodeo ya tiene una única categoría
// fija en un momento dado. Excepción: los 4 corrales fijos de Feed Lot no
// tienen una categoría fija (pueden tener varias a la vez), ver
// trabajoManga.js.
export function rodeosDeEstablecimiento(establecimientoId) {
  return cache.filter((r) => r.establecimiento_id === establecimientoId);
}

// Un rodeo de Feed Lot es uno de los 4 corrales fijos ("Corral n°1".."Corral
// n°4") — nunca se crea ni se busca por categoría, siempre existen. Esto
// es lo único que hace falta para resolver a qué rodeo va/sale cualquier
// movimiento que toque Feed Lot (ver movimientos.js).
export function rodeoDelCorral(corral) {
  return cache.find((r) => r.establecimiento_id === 'feed_lot' && r.corral === corral);
}

// El código (ej. "Vaquillona San Miguel 202601") se arma acá, no en la
// base: año + secuencia salen de siguiente_secuencia_rodeo(), que es
// atómica (RPC con función security definer) para que dos altas
// simultáneas no puedan pisarse el mismo número. La secuencia es por
// (año, nombre) — no un contador global compartido por todos los
// rodeos del año — así "San Miguel" cuenta 01, 02, 03... indepen-
// dientemente de "San Juan" 01, 02, 03...
export async function crearRodeo({ nombre, categoriaId, establecimientoId, fechaCreacion, usuarioId }) {
  const fecha = fechaCreacion || new Date().toISOString().slice(0, 10);
  const anio = Number(fecha.slice(0, 4));
  const { data: secuencia, error: errorSecuencia } = await supabase.rpc('siguiente_secuencia_rodeo', { p_anio: anio, p_nombre: nombre });
  if (errorSecuencia) throw errorSecuencia;
  const codigo = `${nombre} ${anio}${String(secuencia).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('rodeos')
    .insert({
      nombre,
      anio,
      secuencia,
      codigo,
      categoria_id: categoriaId,
      establecimiento_id: establecimientoId,
      fecha_creacion: fecha,
      creado_por: usuarioId,
    })
    .select()
    .single();
  if (error) throw error;
  cache = [...cache, data];
  return data;
}

// Renombrar un rodeo: el código se re-arma con el nombre nuevo pero el
// mismo año/secuencia (esos no cambian nunca, son la identidad real del
// rodeo — el nombre es solo la parte "humana" del código).
export async function renombrarRodeo(id, nuevoNombre) {
  const rodeo = cache.find((r) => r.id === id);
  if (!rodeo) throw new Error('Rodeo no encontrado — recargá la página e intentá de nuevo.');
  const nuevoCodigo = `${nuevoNombre} ${rodeo.anio}${String(rodeo.secuencia).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('rodeos')
    .update({ nombre: nuevoNombre, codigo: nuevoCodigo })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  cache = cache.map((r) => (r.id === id ? data : r));
  return data;
}

// "Dar de baja" un rodeo sin stock: no se borra (rompería la trazabilidad
// de los movimientos que ya lo referencian, y no hay policy de delete a
// propósito), se marca activo=false — cargarRodeos() ya filtra por
// activo=true, así que a partir de acá deja de aparecer en "Cargar
// movimiento", Trabajo de Manga y este mismo panel, sin perder su
// historial.
export async function darDeBajaRodeo(id) {
  const cabezas = await stockDelRodeo(id);
  if (cabezas > 0) {
    throw new Error(`Este rodeo todavía tiene ${cabezas} cabeza(s) de stock — no se puede dar de baja.`);
  }
  const { data, error } = await supabase.from('rodeos').update({ activo: false }).eq('id', id).select().single();
  if (error) throw error;
  cache = cache.filter((r) => r.id !== id);
  return data;
}

// Cabezas actuales de un rodeo (sumando todos los titulares) — se pide en
// vivo al validar un movimiento de salida/interna, no se cachea, para no
// dar luz verde con un stock desactualizado.
export async function stockDelRodeo(rodeoId) {
  const { data, error } = await supabase.from('stock_actual').select('cabezas').eq('rodeo_id', rodeoId);
  if (error) throw error;
  return data.reduce((acc, r) => acc + Number(r.cabezas), 0);
}

// Cabezas de una categoría puntual dentro de un rodeo (ej. cuántos
// "ternero" hay en el rodeo de la madre, para validar un Destete).
export async function stockDelRodeoPorCategoria(rodeoId, categoriaId) {
  const { data, error } = await supabase.from('stock_actual').select('cabezas').eq('rodeo_id', rodeoId).eq('categoria', categoriaId);
  if (error) throw error;
  return data.reduce((acc, r) => acc + Number(r.cabezas), 0);
}

// Cabezas de una categoría Y titular puntuales dentro de un rodeo — un
// rodeo puede tener stock de más de un titular a la vez (ej. dos
// Aperturas de stock distintas al mismo corral de Feed Lot), así que
// "el rodeo tiene stock" no alcanza para validar una salida/interna:
// tiene que ser ESE titular el que tenga stock de ESA categoría ahí. Sin
// esto, se podía vender a nombre de un titular sin stock real con tal de
// que ALGÚN otro titular del mismo rodeo sí lo tuviera.
export async function stockDelRodeoPorCategoriaYTitular(rodeoId, categoriaId, titularId) {
  const { data, error } = await supabase
    .from('stock_actual')
    .select('cabezas')
    .eq('rodeo_id', rodeoId)
    .eq('categoria', categoriaId)
    .eq('titular', titularId);
  if (error) throw error;
  return data.reduce((acc, r) => acc + Number(r.cabezas), 0);
}

// Igual que la de arriba, pero además devuelve el kilo promedio ponderado
// — lo usa el Cambio de categoría "express" (ver movimientos.js) para
// saber no solo si hay stock de la categoría anterior de la cadena, sino
// cuántas cabezas y con qué peso mover exactamente.
export async function stockDetalleRodeoCategoriaYTitular(rodeoId, categoriaId, titularId) {
  const { data, error } = await supabase
    .from('stock_actual')
    .select('cabezas, kilos_promedio_ponderado')
    .eq('rodeo_id', rodeoId)
    .eq('categoria', categoriaId)
    .eq('titular', titularId);
  if (error) throw error;
  const cabezas = data.reduce((acc, r) => acc + Number(r.cabezas), 0);
  const kilosPromedioPonderado = cabezas > 0
    ? data.reduce((acc, r) => acc + Number(r.cabezas) * Number(r.kilos_promedio_ponderado), 0) / cabezas
    : null;
  return { cabezas, kilosPromedioPonderado };
}

// Titulares con cabezas reales en un rodeo (para no dejar elegir, al
// cargar un movimiento de salida/interna, una titularidad que ese rodeo
// ni siquiera tiene).
export async function titularesDelRodeo(rodeoId) {
  const { data, error } = await supabase.from('stock_actual').select('titular, cabezas').eq('rodeo_id', rodeoId);
  if (error) throw error;
  const conStock = new Set();
  for (const r of data) if (Number(r.cabezas) > 0) conStock.add(r.titular);
  return conStock;
}

// Nota: ya no hace falta "registrar entrada/salida de feed lot" — el
// corral de un rodeo de Feed Lot es fijo para siempre (uno de los 4
// corrales), nunca se asigna ni se limpia por movimiento. El "corral"
// simplemente ES el campo `corral` de esos 4 rodeos, ya disponible en
// cache/obtenerRodeosCache() sin pedir nada aparte (ver dashboard.js).
