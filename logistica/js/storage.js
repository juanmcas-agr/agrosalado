// Subida de documentos (carta de porte / ticket de pesada) al bucket
// privado logistica-documentos. Bucket privado = nunca hay URL pública
// directa, todo se ve vía signed URL con vencimiento corto.
import { supabase } from './supabaseClient.js';

const BUCKET = 'logistica-documentos';
const EXTENSIONES_VALIDAS = ['png', 'jpg', 'jpeg', 'pdf'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10 MB

function validarArchivo(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!EXTENSIONES_VALIDAS.includes(ext)) {
    throw new Error(`Formato no permitido (.${ext || '?'}). Solo PNG, JPG, JPEG o PDF.`);
  }
  if (file.size > TAMANO_MAXIMO_BYTES) {
    throw new Error('El archivo no puede pesar más de 10 MB.');
  }
  return ext;
}

// Sube (o reemplaza, upsert) un documento bajo viajes/{transportistaId}/
// {viajeId}/{tipo}.{ext} y devuelve el path guardado — eso es lo que se
// guarda en viajes.carta_porte_path/ticket_pesada_path, no una URL (el
// bucket es privado, la URL hay que generarla de nuevo cada vez que se
// quiera ver el archivo).
export async function subirDocumento(transportistaId, viajeId, tipo, file) {
  const ext = validarArchivo(file);
  const path = `viajes/${transportistaId}/${viajeId}/${tipo}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

// URL temporaria para ver/descargar un documento ya subido.
export async function urlFirmadaDocumento(path, segundos = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) throw error;
  return data.signedUrl;
}
