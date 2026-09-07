// Por ahora una sola pantalla (la matriz de ratios). Se arma como router de
// hash desde ya, mismo criterio que Hacienda (stock/js/router.js), para no
// tener que reestructurar cuando se agreguen más pantallas (carga manual,
// etc.) en los próximos milestones.
import { initMatriz, refrescarMatriz } from './matriz.js';

const PANTALLAS = ['matriz'];

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
}

export function initRouter() {
  initMatriz();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
