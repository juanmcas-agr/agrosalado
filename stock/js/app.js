import { initAuth, onAuthChange, iniciarSesion, cerrarSesion, getEstado } from './auth.js';
import { initSync, onSyncChange } from './sync.js';
import { initMovimientos } from './movimientos.js';
import { initDashboard } from './dashboard.js';
import { initHistorial } from './historial.js';
import { initRouter } from './router.js';

function el(id) {
  return document.getElementById(id);
}

let appIniciada = false;

function iniciarPantallasDeLaApp(rol) {
  if (appIniciada) return;
  appIniciada = true;
  if (rol === 'encargado' || rol === 'administrativo') initMovimientos();
  initDashboard();
  initHistorial();
  initRouter(rol);
}

function actualizarBannerSync({ pendientes, conError }) {
  const banner = el('sync-estado');
  if (conError) {
    banner.textContent = `${conError} movimiento(s) con error de sincronización. Tocá para reintentar.`;
    banner.className = 'error';
  } else if (pendientes) {
    banner.textContent = `${pendientes} movimiento(s) pendiente(s) de sincronizar...`;
    banner.className = 'advertencia';
  } else {
    banner.textContent = 'Todo sincronizado.';
    banner.className = 'ok';
  }
}

function mostrarLogin(mensajeError) {
  el('pantalla-login').classList.remove('oculto');
  el('app-shell').classList.add('oculto');
  if (mensajeError) {
    el('login-mensaje').textContent = mensajeError;
    el('login-mensaje').className = 'error';
  }
}

function mostrarApp(perfil) {
  el('pantalla-login').classList.add('oculto');
  el('app-shell').classList.remove('oculto');
  el('usuario-nombre').textContent = `${perfil.nombre_completo} (${perfil.rol})`;
  iniciarPantallasDeLaApp(perfil.rol);
}

function wireLogin() {
  el('login-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const email = el('login-email').value.trim();
    const password = el('login-password').value;
    el('login-mensaje').textContent = '';
    try {
      await iniciarSesion(email, password);
    } catch (error) {
      el('login-mensaje').textContent = 'No se pudo iniciar sesión. Revisá el email y la contraseña.';
      el('login-mensaje').className = 'error';
      console.error(error);
    }
  });

  el('logout-boton').addEventListener('click', async () => {
    await cerrarSesion();
    location.hash = '';
  });
}

function wireAuth() {
  onAuthChange((estado) => {
    if (!estado.listo) return;
    if (!estado.session) {
      mostrarLogin();
      return;
    }
    if (!estado.perfil) {
      mostrarLogin('Tu usuario no tiene un perfil asignado en el sistema. Contactá al administrador.');
      return;
    }
    mostrarApp(estado.perfil);
  });
}

async function main() {
  wireLogin();
  wireAuth();
  onSyncChange(actualizarBannerSync);
  await initAuth();
  initSync();
}

main();
