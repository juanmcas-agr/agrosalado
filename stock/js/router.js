import { refrescarDashboard } from './dashboard.js';
import { cargarHistorial } from './historial.js';

const PANTALLAS = ['cargar', 'dashboard', 'historial'];

function el(id) {
  return document.getElementById(id);
}

function pantallaPermitida(nombre, rol) {
  if (nombre === 'cargar') return rol === 'encargado' || rol === 'administrativo';
  return true; // dashboard/historial: visibles para todos los roles autenticados
}

function pantallaPorDefecto(rol) {
  return rol === 'owner' ? 'dashboard' : 'cargar';
}

function renderRoute(rol) {
  let pantalla = location.hash.slice(1);
  if (!PANTALLAS.includes(pantalla) || !pantallaPermitida(pantalla, rol)) {
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
  if (pantalla === 'historial') cargarHistorial();
}

export function initRouter(rol) {
  document.querySelectorAll('[data-ir]').forEach((btn) => {
    const visible = pantallaPermitida(btn.dataset.ir, rol);
    btn.classList.toggle('oculto', !visible);
    btn.addEventListener('click', () => { location.hash = btn.dataset.ir; });
  });
  window.addEventListener('hashchange', () => renderRoute(rol));
  renderRoute(rol);
}
