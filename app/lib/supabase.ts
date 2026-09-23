import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Brak zmiennych środowiskowych dla Supabase w pliku .env.local!');
}

// Tworzymy i eksportujemy klienta, który automatycznie zna adres i klucz naszej bazy
export const supabase = createClient(supabaseUrl, supabaseAnonKey);