import { refrescarDashboard } from './dashboard.js';
import { cargarHistorial, cargarHistorialManga } from './historial.js';
import { refrescarDiferenciasPendientes } from './trabajoManga.js';
import { refrescarReportes } from './reportes.js';

const PANTALLAS = ['cargar', 'manga', 'dashboard', 'historial', 'reportes'];

function el(id) {
  return document.getElementById(id);
}

function pantallaPorDefecto(rol) {
  return rol === 'owner' ? 'dashboard' : 'cargar';
}

function renderRoute(rol) {
  let pantalla = location.hash.slice(1);
  if (!PANTALLAS.includes(pantalla)) {
    pantalla = pantallaPorDefecto(rol);
    location.hash = pantalla;
    return; // el cambio de hash vuelve a disparar renderRoute
  }

  for (const nombre of PANTALLAS) {
    el(`pantalla-${nombre}`).classList.toggle('oculto', nombre !== pantalla);
  }
  document.querySelectorAll('[data-ir]').forEach((btn) => {
    btn.classList.toggle('activo', btn.dataset.ir === pantalla);
  });

  if (pantalla === 'dashboard') refrescarDashboard();
  if (pantalla === 'historial') { cargarHistorial(); cargarHistorialManga(); }
  if (pantalla === 'manga' || pantalla === 'cargar') refrescarDiferenciasPendientes();
  if (pantalla === 'reportes') refrescarReportes();
}

export function initRouter(rol) {
  document.querySelectorAll('[data-ir]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = btn.dataset.ir; });
  });
  window.addEventListener('hashchange', () => renderRoute(rol));
  renderRoute(rol);
}
