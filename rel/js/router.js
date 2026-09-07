// Router de hash, mismo criterio que Hacienda (stock/js/router.js).
import { initMatriz, refrescarMatriz } from './matriz.js';
import { refrescarCarga } from './carga.js';

const PANTALLAS = ['matriz', 'carga'];

function el(id) {
  return document.getElementById(id);
}

function renderRoute() {
  let pantalla = location.hash.slice(1);
  if (!PANTALLAS.includes(pantalla)) {
    pantalla = 'matriz';
    location.hash = pantalla;
    return; // el cambio de hash vuelve a disparar renderRoute
  }

  for (const nombre of PANTALLAS) {
    el(`pantalla-${nombre}`).classList.toggle('oculto', nombre !== pantalla);
  }

  if (pantalla === 'matriz') refrescarMatriz();
  if (pantalla === 'carga') refrescarCarga();
}

export function initRouter() {
  initMatriz();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
