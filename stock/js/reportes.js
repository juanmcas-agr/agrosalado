// Reportes: pestaña nueva con 4 sub-secciones (Trabajo de Manga / Feed
// Lot / Historia de Rodeo / Índices). Este milestone (M4) solo arma el
// esqueleto — cada sub-sección se completa en su propio milestone.
function el(id) {
  return document.getElementById(id);
}

const SUBSECCIONES = ['manga', 'feedlot', 'rodeo', 'indices'];

function mostrarSubseccion(nombre) {
  for (const s of SUBSECCIONES) {
    el(`reportes-${s}`).classList.toggle('oculto', s !== nombre);
  }
  document.querySelectorAll('.reportes-tab').forEach((boton) => {
    boton.classList.toggle('activo', boton.dataset.subseccion === nombre);
  });
}

export function initReportes() {
  document.querySelectorAll('.reportes-tab').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSubseccion(boton.dataset.subseccion));
  });
  mostrarSubseccion('manga');
}

// Llamado por router.js al navegar a #reportes — de momento no hay datos
// que recargar (cada sub-sección se conecta a su fuente en su propio
// milestone), pero se deja el punto de entrada ya wireado.
export function refrescarReportes() {}
