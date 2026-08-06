import { initAuth, onAuthChange, iniciarSesion, cerrarSesion, getEstado } from './auth.js';
import { initSync, onSyncChange, reintentarErrores } from './sync.js';
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
  initMovimientos();
  initDashboard();
  initHistorial();
  initRouter(rol);
}

function actualizarBannerSync({ pendientes, conError }) {
  const banner = el('sync-estado');
  if (conError) {
    banner.textContent = `${conError} movimiento(s) con error de sincronización. Tocá para reintentar.`;
    banner.className = 'banner-sync error clickeable';
  } else if (pendientes) {
    banner.textContent = `${pendientes} movimiento(s) pendiente(s) de sincronizar...`;
    banner.className = 'banner-sync advertencia';
  } else {
    banner.textContent = 'Todo sincronizado.';
    banner.className = 'banner-sync ok';
  }
}

let reintentando = false;

function wireSyncBanner() {
  el('sync-estado').addEventListener('click', async () => {
    if (reintentando) return;
    reintentando = true;
    const banner = el('sync-estado');
    const original = banner.textContent;
    banner.textContent = 'Reintentando...';
    try {
      const erroresRestantes = await reintentarErrores();
      if (erroresRestantes.length) {
        alert('Todavía no se pudieron sincronizar. Error de Supabase:\n\n' + erroresRestantes.join('\n'));
      }
    } finally {
      reintentando = false;
      if (banner.textContent === 'Reintentando...') banner.textContent = original;
    }
  });
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

function wireTabBar() {
  el('tabbar-granos').addEventListener('click', () => {
    if (getEstado().perfil?.rol !== 'owner') {
      alert('No tenés permisos para acceder a Granos.');
      return;
    }
    window.location.href = '/';
  });
  el('tabbar-posgranaria').addEventListener('click', () => {
    if (getEstado().perfil?.rol !== 'owner') {
      alert('No tenés permisos para acceder a Pos. Granaria.');
      return;
    }
    alert('Pos. Granaria: próximamente 🚧');
  });
}

const ICONO_OJO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICONO_OJO_TACHADO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

function wireMostrarClave() {
  const input = el('login-password');
  const boton = el('login-mostrar-clave');
  boton.innerHTML = ICONO_OJO;
  boton.addEventListener('click', () => {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    boton.innerHTML = mostrar ? ICONO_OJO_TACHADO : ICONO_OJO;
  });
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
  // Versión única compartida con Granos: /version.json en la raíz del sitio
  // (funciona igual desde /stock/ porque es una ruta absoluta).
  fetch('/version.json').then((r) => r.json()).then((d) => {
    el('version-footer').textContent = `v.${d.version}`;
  }).catch(() => {});
  wireTabBar();
  wireLogin();
  wireMostrarClave();
  wireAuth();
  wireSyncBanner();
  onSyncChange(actualizarBannerSync);
  await initAuth();
  initSync();
}

main();
