import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Expuesto en window para poder mockear/inspeccionar desde la consola del
// navegador al probar la app (mismo criterio que las otras 3 apps).
window.supabaseClient = supabase;
