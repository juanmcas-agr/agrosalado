// Router de hash — staff ya tiene sub-navegación (Catálogo/Viajes);
// transportista sigue con una sola pantalla por ahora, se amplía en los
// próximos milestones (liquidaciones/cerrar-mes).
import { cargarCatalogo, initCatalogo } from './catalogo.js';
import { cargarPantallaViajesStaff, initViajesStaff } from './adminViajes.js';
import { cargarPantallaMisViajes, initMisViajes } from './viajes.js';

const PANTALLAS_STAFF = ['catalogo', 'viajes'];
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
  if (modoActual === 'staff') {
    document.querySelectorAll('.staff-tab').forEach((btn) => {
      btn.classList.toggle('activo', btn.dataset.subpantalla === pantalla);
    });
    if (pantalla === 'catalogo') cargarCatalogo();
    if (pantalla === 'viajes') cargarPantallaViajesStaff();
  }
  if (modoActual === 'transportista' && pantalla === 'mis-viajes') cargarPantallaMisViajes();
}

export function initRouter(modo) {
  modoActual = modo;
  if (modo === 'staff') {
    initCatalogo();
    initViajesStaff();
    document.querySelectorAll('.staff-tab').forEach((btn) => {
      btn.addEventListener('click', () => { location.hash = btn.dataset.subpantalla; });
    });
  } else {
    initMisViajes();
  }
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
