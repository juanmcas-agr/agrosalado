// Grupos de botones "tap-to-select": reemplazan <select> para pocas
// opciones, quedan "pintados" al elegir. Usado en movimientos.js y
// dashboard.js.

export function crearGrupoBotones(id, opciones) {
  const contenedor = document.getElementById(id);
  contenedor.classList.add('grupo-botones');
  contenedor.innerHTML = '';
  for (const o of opciones) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-opcion';
    boton.dataset.value = o.id;
    boton.textContent = o.nombre;
    boton.addEventListener('click', () => {
      contenedor.querySelectorAll('.boton-opcion').forEach((b) => b.classList.remove('seleccionado'));
      boton.classList.add('seleccionado');
      contenedor.dispatchEvent(new Event('cambio'));
    });
    contenedor.appendChild(boton);
  }
}

export function obtenerSeleccion(id) {
  const boton = document.getElementById(id).querySelector('.boton-opcion.seleccionado');
  return boton ? boton.dataset.value : '';
}

export function establecerSeleccion(id, valor) {
  const contenedor = document.getElementById(id);
  contenedor.querySelectorAll('.boton-opcion').forEach((b) => {
    b.classList.toggle('seleccionado', b.dataset.value === valor);
  });
  contenedor.dispatchEvent(new Event('cambio'));
}

export function limpiarSeleccion(id) {
  document.getElementById(id).querySelectorAll('.boton-opcion').forEach((b) => b.classList.remove('seleccionado'));
}
