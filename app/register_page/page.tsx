"use client"; 

import React, { useState } from 'react';
import Link from 'next/link';

export default function ZnajdzSpotaPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Stan kontrolujący co widzimy: 'choice' (wybór) lub 'register' (formularz)
  const [view, setView] = useState<'choice' | 'register'>('choice');
  const handleRegister = (e: React.FormEvent) => {
   e.preventDefault();
   console.log("Rejestracja dla:", email);
   // TODO: Tutaj dodaj logikę rejestracji (np. Firebase, Supabase, własne API)
   alert("Próba założenia konta!");
  };

  return (
   <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6">
    <div className="w-full max-w-md bg-white p-8 rounded-3xl shadow-xl transition-all">
     
     {/* --- WIDOK 1: WYBÓR --- */}
     {view === 'choice' && (
      <div className="flex flex-col text-center">
       <h1 className="text-2xl font-bold text-gray-800 mb-2">
        Znajdź Spota! 📍
       </h1>
       <p className="text-gray-500 mb-8">
        Wybierz, jak chcesz zacząć odkrywać malownicze miejsca.
       </p>
       
       <div className="flex flex-col gap-4">
        <button 
         onClick={() => setView('register')}
         className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-md active:scale-95"
        >
         Rejestruję się
        </button>
        
        <Link 
         href="/mapa" 
         className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-4 rounded-xl transition-all text-center border border-gray-200 active:scale-95"
        >
         Wchodzę bez konta
        </Link>
       </div>

       <div className="mt-8">
        <p className="text-gray-600">Masz już konto?</p>
        <Link href="/login" className="text-blue-600 font-semibold hover:underline">
         Zaloguj się
        </Link>
       </div>
      </div>
     )}

     {/* --- WIDOK 2: FORMULARZ REJESTRACJI --- */}
     {view === 'register' && (
      <>
       <button 
        onClick={() => setView('choice')}
        className="text-sm text-blue-600 mb-4 hover:underline flex items-center gap-1"
       >
        ← Wróć do wyboru
       </button>

       <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">
        Dołącz do nas! 🚀
       </h1>
       <p className="text-center text-gray-500 mb-8">
        Stwórz konto, aby zapisywać swoje ulubione miejsca.
       </p>

       <form onSubmit={handleRegister} className="flex flex-col gap-4">
        <div>
         {/* Poprawiono klasę: text-black-700 -> text-gray-700 */}
         <label className="block text-gray-700 font-medium mb-1">Email</label>
         <input 
          type="email" 
          className="w-full p-4 bg-gray-100 border-none rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
          placeholder="twoj@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
         />
        </div>

        <div>
         {/* Poprawiono klasę: text-black-700 -> text-gray-700 */}
         <label className="block text-gray-700 font-medium mb-1">Hasło</label>
         <input 
          type="password" 
          className="w-full p-4 bg-gray-100 border-none rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-black"
          placeholder="Min. 8 znaków"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8} // Dodano natywną walidację długości
         />
        </div>

        <button 
         type="submit"
         className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl mt-4 transition-all shadow-md active:scale-95"
        >
         Załóż konto
        </button>
       </form>
      </>
     )}
     
     <div className="mt-6">
      <Link href="/" className="text-sm text-gray-400 block text-center hover:text-gray-600">
       ← Strona główna
      </Link>
     </div>
    </div>
   </div>
  );
}