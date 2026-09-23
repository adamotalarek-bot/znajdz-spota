"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Map, Marker, Overlay } from 'pigeon-maps';
import Link from 'next/link';
import { supabase } from '@/app/lib/supabase';

interface Spot {
  id: number;
  name: string;
  lat: number;
  lng: number;
  vibe: string[];
  images?: string[];
  reviews?: { rating: number }[]; // Dodane do obliczania średniej
}

interface Review {
  id: number;
  spot_id: number;
  rating: number;
  comment: string;
  user_nick: string;
  created_at: string;
}

const AVAILABLE_VIBES = [
  "Na piwko 🍺",
  "Na papiersoka 🚬",
  "Randka 🌅",
  "Cisza / Chill 🤫",
  "Nocne rozmowy 🌙",
  "Ognisko 🔥"
];

const DEFAULT_CENTER: [number, number] = [52.2297, 21.0122];
const DEFAULT_ZOOM = 12;

export default function MapaMobilePage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  
  // Stany otwartych paneli
  const [selectedAnchor, setSelectedAnchor] = useState<[number, number] | null>(null);
  const [previewSpot, setPreviewSpot] = useState<Spot | null>(null);
  const [activeSpot, setActiveSpot] = useState<Spot | null>(null);   
  const [reviewSpot, setReviewSpot] = useState<Spot | null>(null);   
  
  // Zmienne Formularzy i opinii
  const [spotName, setSpotName] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [userNick, setUserNick] = useState<string>('Anonim');
  
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  
  // Lista opinii dla otwartego spota
  const [spotReviews, setSpotReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

  // Stany suwaka
  const [sheetHeight, setSheetHeight] = useState<number>(40);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Stany GPS i mapy
  const [mapHeight, setMapHeight] = useState<number>(0);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState<number>(DEFAULT_ZOOM);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  useEffect(() => {
    setMapHeight(window.innerHeight);
    const savedNick = localStorage.getItem('spot_user_nick');
    if (savedNick) setUserNick(savedNick);
    
    fetchSpots();

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(loc);
          setMapCenter(loc);
          setMapZoom(14);
        },
        (err) => console.warn("Brak GPS na start:", err.message),
        { enableHighAccuracy: true, timeout: 5000 }
      );

      const watchId = navigator.geolocation.watchPosition(
        (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
        (err) => console.warn("Błąd śledzenia GPS:", err.message),
        { enableHighAccuracy: true }
      );

      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // Pobieramy opinie od razu po otwarciu "Zobacz opis"
  useEffect(() => {
    if (activeSpot) {
      fetchReviews(activeSpot.id);
    } else {
      setSpotReviews([]);
    }
  }, [activeSpot]);

  const fetchSpots = async () => {
    // Pobieramy od razu oceny, aby obliczać średnią w nagłówku!
    const { data, error } = await supabase.from('spots').select('*, reviews(rating)');
    if (!error && data) {
      setSpots(data as Spot[]);
    }
  };

  const fetchReviews = async (spotId: number) => {
    setLoadingReviews(true);
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('spot_id', spotId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setSpotReviews(data as Review[]);
    }
    setLoadingReviews(false);
  };

  const closeAllPanels = () => {
    setActiveSpot(null);
    setSelectedAnchor(null);
    setReviewSpot(null);
    setPreviewSpot(null);
  };

  const handleMapClick = ({ latLng }: { latLng: [number, number] }) => {
    closeAllPanels();
    setSelectedAnchor(latLng);
    setSheetHeight(75);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    dragStartY.current = e.touches[0].clientY;
    dragStartHeight.current = sheetHeight;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const deltaY = e.touches[0].clientY - dragStartY.current;
    const vhDelta = (deltaY / window.innerHeight) * 100;
    const newHeight = Math.min(95, Math.max(20, dragStartHeight.current - vhDelta));
    setSheetHeight(newHeight);
  };

  const handleTouchEnd = () => setIsDragging(false);

  const toggleSheetHeight = () => setSheetHeight((prev) => (prev > 50 ? 40 : 75));

  const toggleVibe = (vibe: string) => {
    setSelectedVibes(prev => prev.includes(vibe) ? prev.filter(v => v !== vibe) : [...prev, vibe]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      if (filesArray.length > 3) {
        alert("Maksymalnie 3 zdjęcia!");
        e.target.value = '';
        setSelectedFiles([]);
        return;
      }
      setSelectedFiles(filesArray);
    }
  };

  const handleAddSpot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAnchor || !spotName) return;

    setLoading(true);
    const uploadedUrls: string[] = [];

    for (const file of selectedFiles) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      const filePath = `public/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('spot-images').upload(filePath, file);
      if (!uploadError) {
        const { data } = supabase.storage.from('spot-images').getPublicUrl(filePath);
        if (data?.publicUrl) uploadedUrls.push(data.publicUrl);
      }
    }

    const newSpotData = {
      name: spotName,
      vibe: selectedVibes.length > 0 ? selectedVibes : ["Klasyk 📍"],
      lat: selectedAnchor[0],
      lng: selectedAnchor[1],
      images: uploadedUrls,
    };

    const { data, error } = await supabase.from('spots').insert([newSpotData]).select('*, reviews(rating)');
    setLoading(false);

    if (error) {
      alert(`Błąd: ${error.message}`);
      return;
    }

    if (data && data.length > 0) {
      setSpots((prev) => [...prev, data[0] as Spot]);
      setSpotName('');
      setSelectedVibes([]);
      setSelectedFiles([]);
      closeAllPanels();
    }
  };

  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      alert("Zaznacz gwiazdki!");
      return;
    }
    if (!reviewSpot) return;

    setLoading(true);
    const newReview = {
      spot_id: reviewSpot.id,
      rating: rating,
      comment: comment,
      user_nick: userNick
    };

    const { error } = await supabase.from('reviews').insert([newReview]);
    setLoading(false);

    if (error) {
      alert(`Błąd podczas dodawania opinii: ${error.message}`);
      return;
    }
    
    alert("Dzięki za dodanie opinii!");
    setRating(0);
    setComment('');
    closeAllPanels();
    fetchSpots(); // Odświeża spoty by zaktualizować średnią ocenę!
  };

  // --- Funkcja pomocnicza: wyciąga i liczy średnią dla spota ---
  const getAverageRating = (spot: Spot) => {
    if (!spot.reviews || spot.reviews.length === 0) return null;
    const sum = spot.reviews.reduce((acc, curr) => acc + curr.rating, 0);
    return (sum / spot.reviews.length).toFixed(1);
  };

  const isSheetOpen = activeSpot || selectedAnchor || reviewSpot || previewSpot;

  return (
    <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden bg-slate-950 font-sans select-none">
      
      <div className="absolute inset-0 z-0 touch-none">
        {mapHeight > 0 && (
          <Map
            height={mapHeight}
            center={mapCenter}
            zoom={mapZoom}
            onBoundsChanged={({ center, zoom }) => {
              setMapCenter(center);
              setMapZoom(zoom);
            }}
            zoomSnap={false} 
            touchEvents={true}
            mouseEvents={true}
            onClick={handleMapClick}
          >
            {userLocation && (
              <Overlay anchor={userLocation} offset={[12, 12]}>
                <div className="relative flex items-center justify-center w-6 h-6 pointer-events-none">
                  <div className="absolute w-full h-full bg-blue-500 rounded-full animate-ping opacity-60"></div>
                  <div className="relative w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full shadow-md shadow-blue-500/50"></div>
                </div>
              </Overlay>
            )}

            {spots.map((spot) => (
              <Marker
                key={spot.id}
                width={38}
                anchor={[spot.lat, spot.lng]}
                color="#3b82f6"
                onClick={({ event }) => {
                  if (event && event.stopPropagation) event.stopPropagation();
                  closeAllPanels();
                  setPreviewSpot(spot);
                  setSheetHeight(40);
                }}
              />
            ))}

            {selectedAnchor && (
              <Marker width={42} anchor={selectedAnchor} color="#f43f5e" />
            )}
          </Map>
        )}
      </div>

      {/* Przycisk GPS */}
      <button
        onClick={() => {
          if (userLocation) {
            setMapCenter(userLocation);
            setMapZoom(15);
          }
        }}
        className={`absolute right-4 z-20 w-12 h-12 bg-slate-900/90 backdrop-blur-md border border-slate-800 text-slate-300 rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-all duration-300 ${isSheetOpen ? 'bottom-[35vh]' : 'bottom-20'}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
          <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
        </svg>
      </button>

      <header className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center pointer-events-none">
        <div className="flex items-center gap-2 bg-slate-900/95 backdrop-blur-md border border-slate-800 px-3.5 py-2 rounded-full shadow-lg pointer-events-auto">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white font-black text-sm tracking-tight">SPOTA</span>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full font-mono">
            {spots.length}
          </span>
        </div>
        <div className="flex items-center gap-2 bg-slate-900/95 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-full shadow-lg pointer-events-auto">
          <span className="text-xs font-semibold text-slate-300">@{userNick}</span>
        </div>
      </header>

      {!isSheetOpen && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 backdrop-blur-md border border-slate-800 text-slate-300 text-xs px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 pointer-events-none whitespace-nowrap">
          <span>📍</span>
          <span>Dotknij mapy, aby dodać spot</span>
        </div>
      )}

      {isSheetOpen && (
        <div 
          className={`absolute inset-x-0 bottom-0 z-30 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 rounded-t-[28px] shadow-2xl flex flex-col pointer-events-auto ${isDragging ? '' : 'transition-all duration-300'}`}
          style={{ height: `${sheetHeight}vh` }}
        >
          <div 
            className="w-full py-4 -mt-2 flex justify-center cursor-ns-resize"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={toggleSheetHeight}
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full opacity-60" />
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-8 scrollbar-none">
            
            {/* 1. MENU: WIDOK 3 PRZYCISKÓW */}
            {previewSpot && (
              <div className="animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-bold text-white leading-tight flex items-center gap-2">
                    {previewSpot.name}
                    {getAverageRating(previewSpot) && (
                      <span className="text-sm text-yellow-400 font-bold bg-yellow-400/10 px-2 py-0.5 rounded-lg whitespace-nowrap flex items-center gap-0.5">
                        ★ {getAverageRating(previewSpot)}
                      </span>
                    )}
                  </h3>
                  <button onClick={closeAllPanels} className="bg-slate-800 border border-slate-700 p-1.5 rounded-full text-slate-400">✕</button>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  <button
                    onClick={() => {
                      setActiveSpot(previewSpot);
                      setPreviewSpot(null);
                      setSheetHeight(75);
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 px-4 rounded-xl text-sm transition-all flex justify-between"
                  >
                    <span>📖 Zobacz opis i zdjęcia</span><span>→</span>
                  </button>
                  <button
                    onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${previewSpot.lat},${previewSpot.lng}`, '_blank')}
                    className="w-full bg-slate-800 text-slate-200 font-semibold py-3.5 px-4 rounded-xl text-sm border border-slate-700 flex justify-between"
                  >
                    <span>🗺️ Pokaż drogę</span><span className="text-xs opacity-70">Google Maps</span>
                  </button>
                  <button
                    onClick={() => {
                      setReviewSpot(previewSpot);
                      setPreviewSpot(null);
                      setSheetHeight(75);
                      setRating(0);
                      setComment('');
                    }}
                    className="w-full bg-slate-800 text-slate-200 font-semibold py-3.5 px-4 rounded-xl text-sm border border-slate-700 flex justify-between"
                  >
                    <span>⭐ Oceń spot</span><span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* 2. PODGLĄD SPOTA (OPIS, ZDJĘCIA I OPINIE) */}
            {activeSpot && (
              <div className="animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-2xl font-bold text-white leading-tight flex items-center gap-2">
                    {activeSpot.name}
                    {getAverageRating(activeSpot) && (
                      <span className="text-base text-yellow-400 font-bold bg-yellow-400/10 px-2 py-0.5 rounded-lg whitespace-nowrap flex items-center gap-0.5">
                        ★ {getAverageRating(activeSpot)}
                      </span>
                    )}
                  </h2>
                  <button onClick={closeAllPanels} className="bg-slate-800 border border-slate-700 p-1.5 rounded-full text-slate-400">✕</button>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-5">
                  {Array.isArray(activeSpot.vibe) ? (
                    activeSpot.vibe.map((v, idx) => (
                      <span key={idx} className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-lg">{v}</span>
                    ))
                  ) : (
                    <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-lg">{activeSpot.vibe}</span>
                  )}
                </div>

                {activeSpot.images && activeSpot.images.length > 0 ? (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Galeria (kliknij by powiększyć)</p>
                    <div className="grid grid-cols-2 gap-3">
                      {activeSpot.images.map((url, index) => (
                        <div 
                          key={index} 
                          onClick={() => setFullScreenImage(url)}
                          className="aspect-square rounded-xl overflow-hidden border border-slate-800 cursor-pointer bg-slate-800"
                        >
                          <img src={url} alt={`Zdjęcie`} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-800 text-center text-slate-500 text-sm mb-4">
                    Brak zdjęć dla tego spota.
                  </div>
                )}
                
                {/* --- SEKCJA OPINII UŻYTKOWNIKÓW --- */}
                <div className="mt-6 mb-4">
                  <div className="flex justify-between items-center mb-3">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Opinie ({spotReviews.length})
                    </p>
                  </div>

                  {loadingReviews ? (
                    <div className="flex justify-center py-4">
                      <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                    </div>
                  ) : spotReviews.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {spotReviews.map((review) => (
                        <div key={review.id} className="bg-slate-800/40 border border-slate-700/50 p-3.5 rounded-xl">
                          <div className="flex justify-between items-start mb-1.5">
                            <span className="text-xs font-bold text-slate-300">@{review.user_nick || 'Anonim'}</span>
                            <span className="text-yellow-400 text-xs tracking-widest drop-shadow-sm">
                              {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                            </span>
                          </div>
                          {review.comment && (
                            <p className="text-sm text-slate-300 leading-relaxed">{review.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-800/30 rounded-xl border border-slate-800 border-dashed text-center">
                      <p className="text-xs text-slate-500 mb-2">Jeszcze nikt nie ocenił tego miejsca.</p>
                      <button 
                        onClick={() => {
                          setReviewSpot(activeSpot);
                          setActiveSpot(null);
                        }}
                        className="text-xs font-bold text-blue-400 hover:text-blue-300"
                      >
                        Bądź pierwszy!
                      </button>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => {
                    setPreviewSpot(activeSpot);
                    setActiveSpot(null);
                    setSheetHeight(40);
                  }}
                  className="w-full mt-2 bg-slate-800 text-slate-300 font-semibold py-3 px-4 rounded-xl text-sm border border-slate-700"
                >
                  ← Wróć do opcji
                </button>
              </div>
            )}

            {/* 3. FORMULARZ NOWEGO SPOTA */}
            {selectedAnchor && (
              <form onSubmit={handleAddSpot} className="flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-1">
                  <h2 className="font-bold text-lg text-white flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Nowy Spot
                  </h2>
                  <button type="button" onClick={closeAllPanels} className="bg-slate-800 border border-slate-700 p-1.5 rounded-full text-slate-400">✕</button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Nazwa</label>
                  <input type="text" value={spotName} onChange={(e) => setSpotName(e.target.value)} className="w-full p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-blue-500" required />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Klimat / Vibe</label>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_VIBES.map((vibe) => (
                      <button
                        key={vibe} type="button" onClick={() => toggleVibe(vibe)}
                        className={`px-3 py-1.5 text-xs rounded-xl border transition-all ${selectedVibes.includes(vibe) ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800/60 text-slate-300 border-slate-700'}`}
                      >
                        {vibe}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Zdjęcia (do 3)</label>
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} className="w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-blue-600/20 file:text-blue-400" />
                </div>

                <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-3.5 rounded-xl text-sm mt-2">
                  {loading ? 'Wgrywanie...' : 'Zapisz spot 🚀'}
                </button>
              </form>
            )}

            {/* 4. FORMULARZ OCENIANIA */}
            {reviewSpot && (
              <form onSubmit={handleAddReview} className="flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="font-bold text-lg text-white">Oceń ten spot</h2>
                  <button type="button" onClick={closeAllPanels} className="bg-slate-800 border border-slate-700 p-1.5 rounded-full text-slate-400">✕</button>
                </div>
                
                <div className="text-center bg-slate-800/50 p-4 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">Twoja ocena</p>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className={`text-4xl transition-all ${rating >= star ? 'text-yellow-400 scale-110 drop-shadow-md' : 'text-slate-700 hover:text-slate-500'}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Twój komentarz</label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Opisz, co Ci się tutaj podobało..."
                    className="w-full p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-blue-500 min-h-[100px]"
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-3.5 rounded-xl text-sm mt-2 shadow-lg shadow-yellow-500/20 transition-all"
                >
                  {loading ? 'Wysyłanie...' : 'Wyślij opinię'}
                </button>
                
                <button 
                  type="button"
                  onClick={() => {
                    setPreviewSpot(reviewSpot);
                    setReviewSpot(null);
                    setSheetHeight(40);
                  }}
                  className="w-full mt-1 bg-transparent text-slate-400 font-semibold py-2 px-4 rounded-xl text-sm"
                >
                  Wróć
                </button>
              </form>
            )}

          </div>
        </div>
      )}

      {/* PEŁNOEKRANOWA GALERIA ZDJĘĆ */}
      {fullScreenImage && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4">
          <button 
            onClick={() => setFullScreenImage(null)}
            className="absolute top-6 right-6 text-white bg-slate-800/50 p-2 rounded-full border border-slate-700 z-50 w-10 h-10 flex items-center justify-center font-bold"
          >
            ✕
          </button>
          <img 
            src={fullScreenImage} 
            alt="Powiększone zdjęcie" 
            className="max-w-full max-h-full object-contain rounded-xl"
          />
        </div>
      )}

    </div>
  );
}