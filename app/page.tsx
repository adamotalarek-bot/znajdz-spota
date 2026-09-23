"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/app/lib/supabase';

export default function SetupPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  
  const [nick, setNick] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedNick = localStorage.getItem('spot_user_nick');
    if (savedNick) {
      router.push('/mapa');
    } else {
      setIsChecking(false);
    }
  }, [router]);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      setAvatarUrl(URL.createObjectURL(file));
    }
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNick = nick.trim();
    if (!cleanNick) {
      alert("Podaj swój nick!");
      return;
    }

    setLoading(true);

    // Pobieramy lub tworzymy unikalny identyfikator urządzenia
    let deviceId = localStorage.getItem('spot_device_id');
    if (!deviceId) {
      deviceId = 'dev-' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('spot_device_id', deviceId);
    }

    // SPRAWDZENIE UNIKALNOŚCI NICKU W BAZIE
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .ilike('nick', cleanNick)
      .maybeSingle();

    if (existingUser && existingUser.device_id !== deviceId) {
      setLoading(false);
      alert(`Przepraszamy, nick "@${cleanNick}" jest już zajęty przez innego użytkownika! Wybierz inny.`);
      return;
    }

    let finalAvatarUrl = '';
    if (avatarFile) {
      const fileExt = avatarFile.name.split('.').pop();
      const fileName = `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      const filePath = `public/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('spot-images').upload(filePath, avatarFile);
      if (!uploadError) {
        const { data } = supabase.storage.from('spot-images').getPublicUrl(filePath);
        if (data?.publicUrl) finalAvatarUrl = data.publicUrl;
      }
    }

    // Zapisujemy lub aktualizujemy nick w tabeli unikalnych użytkowników
    await supabase.from('users').upsert(
      { device_id: deviceId, nick: cleanNick },
      { onConflict: 'device_id' }
    );

    localStorage.setItem('spot_user_nick', cleanNick);
    if (finalAvatarUrl) localStorage.setItem('spot_user_avatar', finalAvatarUrl);
    localStorage.setItem('spot_user_shared', shareLocation ? 'true' : 'false');

    router.push('/mapa');
  };

  if (isChecking) {
    return <div className="h-screen w-full bg-slate-950 flex items-center justify-center"><div className="w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="fixed inset-0 w-full h-[100dvh] bg-slate-950 flex items-center justify-center p-5 font-sans">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute top-[60%] -right-[20%] w-[60%] h-[60%] bg-rose-600/10 blur-[100px] rounded-full mix-blend-screen" />
      </div>

      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 w-full max-w-sm rounded-[32px] p-7 shadow-2xl z-10 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-blue-500/30">
            <span className="text-2xl">📍</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Witaj w Spota!</h1>
          <p className="text-sm text-slate-400 mt-1">Stwórz swój profil, aby dołączyć do mapy.</p>
        </div>

        <form onSubmit={handleStart} className="flex flex-col gap-5">
          <div className="flex flex-col items-center">
            <div className="relative w-24 h-24 rounded-full border-2 border-dashed border-slate-600 bg-slate-800/50 flex items-center justify-center overflow-hidden mb-2 transition-all hover:border-blue-500">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Twój awatar" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-slate-500">
                  <span className="text-3xl mb-1">📷</span>
                </div>
              )}
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleAvatarSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <p className="text-[10px] text-slate-400 text-center px-4">
              To zdjęcie będzie pulsować na mapie jako <strong className="text-blue-400">Twoja ikona lokalizacji</strong>.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Twój unikalny Nick
            </label>
            <input 
              type="text" 
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              placeholder="np. KoneserPiwka99"
              className="w-full p-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-blue-500 transition-all placeholder:text-slate-600 font-medium"
              required
            />
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-start gap-3">
            <div className="pt-0.5">
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={shareLocation} 
                  onChange={() => setShareLocation(!shareLocation)} 
                  className="sr-only peer" 
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
              </label>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">Tryb widmo / Widoczność</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                Gdy to włączysz, inni użytkownicy w wybranym promieniu zobaczą Twoją ikonę na żywo.
              </p>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-4 rounded-xl text-sm shadow-lg shadow-blue-600/30 transition-all active:scale-95 mt-2"
          >
            {loading ? 'Sprawdzanie nicku...' : 'Wejdź na mapę 🚀'}
          </button>
        </form>
      </div>
    </div>
  );
}