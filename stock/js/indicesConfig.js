// Configuración de los índices reproductivos de Hacienda (M8 del plan de
// Reportes/Índices). Mismo patrón que TIPOS_MOVIMIENTO en config.js: acá
// vive qué índices existen, su fecha gatillo anual y el texto de ayuda del
// "(?)" — agregar un índice nuevo es (en general) una entrada acá, no una
// migración.
//
// mes/dia: fecha gatillo anual (recordatorio + reconfirmación, M10/M11).
// unidadPrincipal: sufijo mostrado junto al valor cargado.

export const INDICES = {
  vacas_servicio: {
    nombre: 'Vacas en servicio',
    mes: 10,
    dia: 1,
    labelPrincipal: 'Cantidad de vacas en servicio',
    unidadPrincipal: 'cabezas',
    ayuda: 'Cantidad de vacas puestas en servicio (con toro o inseminación) para la '
      + 'temporada de parición que arranca en agosto del año siguiente. Se carga una '
      + 'vez por temporada, el 1° de octubre.',
  },
  vacas_prenadas: {
    nombre: 'Vacas preñadas (tacto)',
    mes: 3,
    dia: 1,
    labelPrincipal: 'Cantidad de vacas preñadas',
    unidadPrincipal: 'cabezas',
    ayuda: 'Resultado del tacto o ecografía de preñez sobre las vacas puestas en '
      + 'servicio el octubre anterior. Se carga una vez por año, el 1° de marzo. '
      + 'El % de preñez (más abajo) se calcula contra "Vacas en servicio" del año '
      + 'anterior — el servicio que generó estas preñeces.',
  },
  paricion_control_1: {
    nombre: 'Parición — primer control (1/8)',
    mes: 8,
    dia: 1,
    labelPrincipal: 'Terneros nacidos hasta la fecha',
    unidadPrincipal: 'cabezas',
    ayuda: 'Primer control de la temporada de parición, al arrancar agosto: cuántos '
      + 'terneros nacieron hasta ese momento.',
  },
  paricion_control_2: {
    nombre: 'Parición — segundo control (1/9)',
    mes: 9,
    dia: 1,
    labelPrincipal: 'Terneros nacidos hasta la fecha',
    unidadPrincipal: 'cabezas',
    ayuda: 'Segundo control de la temporada de parición, al arrancar septiembre: '
      + 'cuántos terneros nacieron hasta ese momento.',
  },
  paricion_control_3: {
    nombre: 'Parición — cierre (1/10)',
    mes: 10,
    dia: 1,
    labelPrincipal: 'Terneros nacidos hasta la fecha',
    unidadPrincipal: 'cabezas',
    ayuda: 'Cierre de la temporada de parición, al arrancar octubre: total de '
      + 'terneros nacidos en la temporada.',
  },
  destete: {
    nombre: 'Destete',
    mes: 3,
    dia: 1,
    labelPrincipal: 'Cantidad destetada',
    unidadPrincipal: 'cabezas',
    labelSecundario: 'Peso promedio al destete',
    unidadSecundario: 'kg',
    autoCalculable: true,
    ayuda: 'Suma automática de los Destete cargados en Trabajo de Manga entre el '
      + '1° de agosto del año anterior y el 1° de marzo de este año (la temporada '
      + 'de parición que cierra en esa fecha). El sistema sugiere el total de '
      + 'cabezas y el peso promedio — corroborá o corregí el número si hace falta.',
  },
};

export function ordenIndices() {
  return Object.keys(INDICES);
}

// Fecha gatillo (ISO) de un índice para un año dado.
export function fechaGatilloDelAnio(tipoIndice, anio) {
  const { mes, dia } = INDICES[tipoIndice];
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Ventana de fechas (fecha real de Trabajo de Manga, no de "anio" del
// índice) que se suma para el Destete automático de un año dado: desde el
// 1/8 del año anterior (arranque de la temporada de parición que cierra
// acá) hasta el propio gatillo del 1/3.
export function ventanaDestete(anioDestete) {
  return { desde: `${anioDestete - 1}-08-01`, hasta: fechaGatilloDelAnio('destete', anioDestete) };
}

// "Hoy" en horario ART, misma aritmética que rangoDeHoyArt() en
// netlify/functions/resumen-diario-hacienda.js — copiada tal cual (no
// reimplementada) para que cliente y servidor nunca discrepen cerca de la
// medianoche. La usan el formulario de carga (default de año) y, más
// adelante, el cartel de recordatorio (M10).
export function hoyArtISO() {
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ahoraArt.toISOString().slice(0, 10);
}
