// Router de hash — una sola pantalla por modo por ahora; se amplía en los
// próximos milestones cuando haya varias pantallas reales por lado
// (staff: viajes/liquidaciones/reportes; transportista: mis-viajes/
// liquidaciones/cerrar-mes).
import { cargarCatalogo, initCatalogo } from './catalogo.js';

const PANTALLAS_STAFF = ['catalogo'];
const PANTALLAS_TRANSPORTISTA = ['mis-viajes'];

function el(id) {
  return document.getElementById(id);
}

let modoActual = null;

function pantallasDelModo() {
  return modoActual === 'staff' ? PANTALLAS_STAFF : PANTALLAS_TRANSPORTISTA;
}

function renderRoute() {
  const pantallas = pantallasDelModo();
  let pantalla = location.hash.slice(1);
  if (!pantallas.includes(pantalla)) {
    pantalla = pantallas[0];
    location.hash = pantalla;
    return; // el cambio de hash vuelve a disparar renderRoute
  }
  for (const nombre of pantallas) {
    el(`pantalla-${nombre}`)?.classList.toggle('oculto', nombre !== pantalla);
  }
  if (modoActual === 'staff' && pantalla === 'catalogo') cargarCatalogo();
}

export function initRouter(modo) {
  modoActual = modo;
  if (modo === 'staff') initCatalogo();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
