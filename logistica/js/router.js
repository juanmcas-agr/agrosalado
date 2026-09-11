// Router de hash — staff con sub-navegación (Catálogo/Viajes/
// Liquidaciones/Cierres — esta última solo visible con
// acceso_logistica_sueldos u owner); transportista sigue con una sola
// pantalla por ahora.
import { cargarCatalogo, initCatalogo } from './catalogo.js';
import { cargarPantallaViajesStaff, initViajesStaff } from './adminViajes.js';
import { cargarLiquidacionesStaff, initLiquidacionesStaff } from './adminLiquidaciones.js';
import { cargarPantallaCierres, initCierres } from './adminCierres.js';
import { cargarPantallaMisViajes, initMisViajes } from './viajes.js';
import { getEstado } from './auth.js';

const PANTALLAS_STAFF = ['catalogo', 'viajes', 'liquidaciones', 'cierres'];
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
    if (pantalla === 'liquidaciones') cargarLiquidacionesStaff();
    if (pantalla === 'cierres') cargarPantallaCierres();
  }
  if (modoActual === 'transportista' && pantalla === 'mis-viajes') cargarPantallaMisViajes();
}

export function initRouter(modo) {
  modoActual = modo;
  if (modo === 'staff') {
    initCatalogo();
    initViajesStaff();
    initLiquidacionesStaff();
    initCierres();
    document.querySelectorAll('.staff-tab').forEach((btn) => {
      btn.addEventListener('click', () => { location.hash = btn.dataset.subpantalla; });
    });
    // "Cierres" toca datos de sueldo de propios — solo se muestra el
    // botón a quien realmente puede usarlo (la RLS igual lo exigiría,
    // pero así no aparece una pestaña que de entrada no sirve para nada).
    const perfil = getEstado().perfil;
    el('staff-tab-cierres').classList.toggle('oculto', perfil.rol !== 'owner' && !perfil.acceso_logistica_sueldos);
  } else {
    initMisViajes();
  }
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
