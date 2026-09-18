import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Modo de prueba con datos falsos (ver js/testing/mockSupabase.js). El
// candado de hostname es lo que importa: aunque el archivo se publique
// junto con el resto, ?mocksupabase=1 no hace NADA en la app real — solo
// corre sirviendo el sitio localmente. Así el mock dejó de vivir pegado
// adentro de este archivo, que era un accidente esperando pasar: bastaba
// olvidarse de sacarlo antes de commitear para publicar Hacienda
// apuntando a datos inventados.
const EN_LOCALHOST = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (EN_LOCALHOST && new URLSearchParams(location.search).get('mocksupabase') === '1') {
  const { activarMockSupabase } = await import('./testing/mockSupabase.js');
  activarMockSupabase(supabase);
}
