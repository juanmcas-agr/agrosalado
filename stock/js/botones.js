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

// Variante de selección múltiple (ej. "propietario(s)" en Trabajo de
// Manga, donde un rodeo puede tener varios a la vez) — cada click solo
// prende/apaga ESE botón, no toca los demás.
export function crearGrupoBotonesMultiple(id, opciones) {
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
      boton.classList.toggle('seleccionado');
      contenedor.dispatchEvent(new Event('cambio'));
    });
    contenedor.appendChild(boton);
  }
}

export function obtenerSeleccionMultiple(id) {
  return Array.from(document.getElementById(id).querySelectorAll('.boton-opcion.seleccionado')).map((b) => b.dataset.value);
}

// Botón individual on/off (ej. las secciones "SANIDAD"/"REPRODUCCION"/
// "MANEJO DE RODEO" de Trabajo de Manga, que despliegan sub-campos) —
// mismo look que los grupos de botones, más consistente que un checkbox
// suelto para algo que actúa como interruptor de sección.
export function inicializarBotonToggle(id, alCambiar) {
  const boton = document.getElementById(id);
  boton.addEventListener('click', () => {
    boton.classList.toggle('seleccionado');
    if (alCambiar) alCambiar(boton.classList.contains('seleccionado'));
  });
}

export function estaActivo(id) {
  return document.getElementById(id).classList.contains('seleccionado');
}

export function desactivarBoton(id) {
  document.getElementById(id).classList.remove('seleccionado');
}
