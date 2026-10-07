/* ============================================================================
 * supabase.ts — единственное место, где создаётся клиент Supabase.
 *
 * Ключи берутся из .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
 * anon-key публичный: доступ к данным закрыт RLS-политиками,
 * которые разрешают работу только роли authenticated.
 * ========================================================================== */

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * true, если переменные окружения похожи на настоящие.
 * Если false — приложение покажет экран с инструкцией вместо падения.
 */
export const isSupabaseConfigured = /^https?:\/\/.+/.test(url) && anonKey.length > 20;

export const supabase = createClient<Database>(
  isSupabaseConfigured ? url : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? anonKey : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Приложение использует HashRouter, magic-link и OAuth-редиректы не нужны.
      detectSessionInUrl: false
    }
  }
);
