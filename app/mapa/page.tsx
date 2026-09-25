"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Map, Marker, Overlay } from 'pigeon-maps';
import { supabase } from '@/app/lib/supabase';

interface Spot {
  id: number;
  name: string;
  lat: number;
  lng: number;
  vibe: string[];
  images?: string[];
  reviews?: { rating: number }[];
  burning_until?: string | null;
}

interface Review {
  id: number;
  spot_id: number;
  rating: number;
  comment: string;
  user_nick: string;
  created_at: string;
}

interface EventItem {
  id: number;
  spot_id: number;
  title: string;
  time: string;
  creator_nick: string;
  participants: string[];
  created_at: string;
  extended_minutes?: number;
}

interface LiveUser {
  id: string;
  nick: string;
  avatar: string | null;
  lat: number;
  lng: number;
  isVisible: boolean;
  radius: number; 
  nowPlaying?: string | null;
  hasVipFrame?: boolean; // Zmienna dla statusu VIP na żywo
}

interface Friendship {
  id: number;
  sender_nick: string;
  receiver_nick: string;
  status: 'pending' | 'accepted';
}

interface ChatMessage {
  id: number;
  sender_nick: string;
  receiver_nick: string;
  content: string;
  created_at: string;
}

// NOWY TYP: dane dla modala profilu (własny lub cudzy)
interface ProfileModalUser {
  nick: string;
  avatar: string | null;
  isSelf: boolean;
  isFriend: boolean;
  isVip: boolean;
  nowPlaying?: string | null;
  distance?: number | null;
}

// TYPY DLA SYSTEMU REKLAM NAGRADZANYCH (różne rodzaje nagród za jedną reklamę)
type AdRewardType = 'coins' | 'super_radar' | 'event_boost' | 'gallery_unlock' | 'post_spot_bonus';

interface PendingAdReward {
  type: AdRewardType;
  eventId?: number;
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

// KONFIGURACJA REKLAM NAGRADZANYCH (Rewarded Ads)
// To na razie "atrapa" symulująca oglądanie reklamy (odliczanie czasu).
// Docelowo w miejscu oznaczonym komentarzem TODO w handleWatchAd podłącz prawdziwy SDK
// (np. Google AdSense Rewarded Web, Monetag, Adsterra) i wywołaj finishAdReward()
// dopiero w callbacku tej sieci (np. onAdComplete / onReward).
const AD_REWARD_COINS = 5;
const AD_DURATION_SECONDS = 15;
const AD_COOLDOWN_MS = 5 * 60 * 1000; // 5 minut przerwy między reklamami

function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const φ1 = lat1 * rad;
  const φ2 = lat2 * rad;
  const Δφ = (lat2 - lat1) * rad;
  const Δλ = (lon2 - lon1) * rad;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function isEventActive(event: EventItem) {
  if (!event.time) return true;
  const [hours, minutes] = event.time.split(':').map(Number);
  
  const baseDate = new Date(event.created_at || Date.now());
  const eventDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hours, minutes);
  const expirationTime = new Date(eventDate.getTime() + 60 * 60 * 1000);
  
  return new Date() <= expirationTime;
}

export default function MapaMobilePage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);

  const [selectedAnchor, setSelectedAnchor] = useState<[number, number] | null>(null);
  const [previewSpot, setPreviewSpot] = useState<Spot | null>(null);
  const [activeSpot, setActiveSpot] = useState<Spot | null>(null);   
  const [reviewSpot, setReviewSpot] = useState<Spot | null>(null);   
  const [creatingEventSpot, setCreatingEventSpot] = useState<Spot | null>(null);
  const [activeEvent, setActiveEvent] = useState<EventItem | null>(null);

  // NOWY STAN: modal profilu (własnego lub cudzego)
  const [profileModalUser, setProfileModalUser] = useState<ProfileModalUser | null>(null);
  
  const [spotName, setSpotName] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);

  const [eventTitle, setEventTitle] = useState('');
  const [eventTime, setEventTime] = useState('');
  
  const [userNick, setUserNick] = useState<string>('Anonim');
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [visibilityRadius, setVisibilityRadius] = useState<number>(100);
  
  // STANY DLA EKONOMII I VIP
  const [userCoins, setUserCoins] = useState<number>(0);
  const [hasVipFrame, setHasVipFrame] = useState<boolean>(false);

  // STANY DLA REKLAM NAGRADZANYCH
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adCountdown, setAdCountdown] = useState(AD_DURATION_SECONDS);
  const [lastAdWatchedAt, setLastAdWatchedAt] = useState<number>(0);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'friends' | 'store'>('profile');
  const [tempNick, setTempNick] = useState('');
  const [tempShare, setTempShare] = useState(false);
  const [tempRadius, setTempRadius] = useState(100);
  const [tempAvatarFile, setTempAvatarFile] = useState<File | null>(null);
  const [tempAvatarUrl, setTempAvatarUrl] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [currentSong, setCurrentSong] = useState<string | null>(null);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);

  const [friendInputNick, setFriendInputNick] = useState('');
  const [friendsList, setFriendsList] = useState<string[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Friendship[]>([]);
  
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatFriend, setActiveChatFriend] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newChatMessage, setNewChatMessage] = useState('');
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const activeChatFriendRef = useRef<string | null>(null);

  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  
  const [spotReviews, setSpotReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

  const [sheetHeight, setSheetHeight] = useState<number>(40);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const [mapHeight, setMapHeight] = useState<number>(0);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState<number>(DEFAULT_ZOOM);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  
  const sessionId = useRef(`user-${Math.random().toString(36).substring(2, 10)}`);
  const realtimeChannel = useRef<any>(null);
  const [liveUsers, setLiveUsers] = useState<LiveUser[]>([]);

  useEffect(() => {
    activeChatFriendRef.current = activeChatFriend;
    if (activeChatFriend) {
      fetchChatMessages(userNick, activeChatFriend);
    }
  }, [activeChatFriend, userNick]);

  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    setMapHeight(window.innerHeight);
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('spotify_success') === 'true') {
      setIsSpotifyConnected(true);
      localStorage.setItem('spotify_connected', 'true');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (localStorage.getItem('spotify_connected') === 'true') {
      setIsSpotifyConnected(true);
    }

    const savedNick = localStorage.getItem('spot_user_nick');
    if (savedNick) {
      setUserNick(savedNick);
      fetchFriendships(savedNick);
      fetchUserProfile(savedNick); // Pobieranie monet z Supabase przy starcie
    }
    
    const savedAvatar = localStorage.getItem('spot_user_avatar');
    if (savedAvatar) setUserAvatar(savedAvatar);

    const savedShare = localStorage.getItem('spot_user_shared');
    if (savedShare === 'true') setShareLocation(true);
    
    const savedRadius = localStorage.getItem('spot_user_radius');
    if (savedRadius) setVisibilityRadius(parseInt(savedRadius, 10));

    const savedLastAd = localStorage.getItem('spot_last_ad_watched');
    if (savedLastAd) setLastAdWatchedAt(parseInt(savedLastAd, 10));
    
    fetchSpots();
    fetchEvents();

    const channel = supabase.channel('live-map', {
      config: { presence: { key: sessionId.current } }
    });

    channel.on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      const users: LiveUser[] = [];
      
      for (const id in presenceState) {
        if (id !== sessionId.current) {
          const data = presenceState[id][0] as unknown as LiveUser;
          if (data && data.isVisible && data.lat && data.lng) {
            users.push({ ...data, id });
          }
        }
      }
      setLiveUsers(users);
    }).subscribe();

    realtimeChannel.current = channel;

    const eventsChannel = supabase
      .channel('events-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newEvent = payload.new as EventItem;
            setEvents((prev) => {
              if (prev.some((e) => e.id === newEvent.id)) return prev;
              return [...prev, newEvent];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedEvent = payload.new as EventItem;
            setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
            setActiveEvent((prev) => (prev && prev.id === updatedEvent.id ? updatedEvent : prev));
          } else if (payload.eventType === 'DELETE') {
            const oldEvent = payload.old as EventItem;
            setEvents((prev) => prev.filter((e) => e.id !== oldEvent.id));
          }
        }
      )
      .subscribe();

    const friendshipsChannel = supabase
      .channel('friendships-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => {
          const currentNick = localStorage.getItem('spot_user_nick');
          if (currentNick) fetchFriendships(currentNick);
        }
      )
      .subscribe();

    const messagesChannel = supabase
      .channel('messages-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          const currentNick = localStorage.getItem('spot_user_nick');
          const currentActiveFriend = activeChatFriendRef.current;

          if (
            currentActiveFriend &&
            ((newMsg.sender_nick === currentNick && newMsg.receiver_nick === currentActiveFriend) ||
             (newMsg.receiver_nick === currentNick && newMsg.sender_nick === currentActiveFriend))
          ) {
            setChatMessages((prev) => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
        }
      )
      .subscribe();

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(loc);
          setMapCenter(loc);
          setMapZoom(15);
        },
        (err) => console.warn("Brak GPS na start:", err.message),
        { enableHighAccuracy: true, timeout: 5000 }
      );

      const watchId = navigator.geolocation.watchPosition(
        (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
        (err) => console.warn("Błąd śledzenia GPS:", err.message),
        { enableHighAccuracy: true }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
        channel.unsubscribe();
        eventsChannel.unsubscribe();
        friendshipsChannel.unsubscribe();
        messagesChannel.unsubscribe();
      };
    }

    return () => {
      channel.unsubscribe();
      eventsChannel.unsubscribe();
      friendshipsChannel.unsubscribe();
      messagesChannel.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSpotifyConnected) return;

    const checkSpotify = async () => {
      try {
        const res = await fetch('/api/spotify/now-playing');
        const data = await res.json();
        if (data && data.item) {
          const songName = `${data.item.name} – ${data.item.artists.map((a: any) => a.name).join(', ')}`;
          setCurrentSong(songName);
        } else {
          setCurrentSong(null);
        }
      } catch (err) {
        console.warn("Błąd pobierania ze Spotify:", err);
      }
    };

    checkSpotify();
    const interval = setInterval(checkSpotify, 10000);
    return () => clearInterval(interval);
  }, [isSpotifyConnected]);

  // WYSYŁANIE STATUSU VIP NA ŻYWO (dodane do zależności)
  useEffect(() => {
    if (realtimeChannel.current && userLocation) {
      if (shareLocation) {
        realtimeChannel.current.track({
          nick: userNick,
          avatar: userAvatar,
          lat: userLocation[0],
          lng: userLocation[1],
          isVisible: true,
          radius: visibilityRadius,
          nowPlaying: currentSong,
          hasVipFrame: hasVipFrame // <-- Wstrzyknięcie VIP-a do transmisji
        });
      } else {
        realtimeChannel.current.track({ isVisible: false });
      }
    }
  }, [userLocation, shareLocation, userNick, userAvatar, visibilityRadius, currentSong, hasVipFrame]);

  // Aktualizuj otwarty modal profilu na żywo, gdy zmieni się np. słuchana piosenka
  useEffect(() => {
    if (!profileModalUser) return;
    if (profileModalUser.isSelf) {
      setProfileModalUser((prev) =>
        prev ? { ...prev, avatar: userAvatar, isVip: hasVipFrame, nowPlaying: currentSong } : prev
      );
    } else {
      const updatedLive = liveUsers.find((u) => u.nick === profileModalUser.nick);
      if (updatedLive) {
        setProfileModalUser((prev) =>
          prev ? { ...prev, nowPlaying: updatedLive.nowPlaying, avatar: updatedLive.avatar, isVip: !!updatedLive.hasVipFrame } : prev
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong, hasVipFrame, userAvatar, liveUsers]);

  // ODLICZANIE CZASU TRWANIA REKLAMY (atrapa, do podmiany na callback prawdziwego SDK)
  useEffect(() => {
    if (!isWatchingAd) return;

    if (adCountdown <= 0) {
      finishAdReward();
      return;
    }

    const timer = setTimeout(() => setAdCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWatchingAd, adCountdown]);

  // FUNKCJE SKLEPU I PROFILU
  const fetchUserProfile = async (nick: string) => {
    const { data } = await supabase
      .from('users')
      .select('coins, has_vip_frame')
      .ilike('nick', nick)
      .maybeSingle();

    if (data) {
      setUserCoins(data.coins || 0);
      setHasVipFrame(data.has_vip_frame || false);
    }
  };

  const handleAddCoins = async () => {
    if (userNick === 'Anonim') {
      alert('Najpierw zapisz swój profil!');
      return;
    }
    const newCoins = userCoins + 100;
    const { error } = await supabase.from('users').update({ coins: newCoins }).eq('nick', userNick);
    if (!error) {
      setUserCoins(newCoins);
      alert('Kupiono 100 Monet SPOTA! 🪙 (Test)');
    }
  };

  const handleBuyVip = async () => {
    if (userNick === 'Anonim') {
      alert('Najpierw zapisz swój profil!');
      return;
    }
    if (hasVipFrame) {
      alert('Posiadasz już złotą ramkę VIP!');
      return;
    }
    if (userCoins < 50) {
      alert('Brakuje Ci monet! Kup je najpierw w sklepie.');
      return;
    }

    const newCoins = userCoins - 50;
    const { error } = await supabase
      .from('users')
      .update({ coins: newCoins, has_vip_frame: true })
      .eq('nick', userNick);

    if (!error) {
      setUserCoins(newCoins);
      setHasVipFrame(true);
      alert('Gratulacje! Od teraz masz złotą ramkę VIP na mapie! 🎉');
    } else {
      alert('Błąd transakcji.');
    }
  };

  // Uruchamia "oglądanie" reklamy (na razie atrapa z licznikiem)
  const handleWatchAd = () => {
    if (userNick === 'Anonim') {
      alert('Najpierw zapisz swój profil w ustawieniach (⚙️), aby zbierać monety!');
      return;
    }

    const now = Date.now();
    const elapsed = now - lastAdWatchedAt;
    if (lastAdWatchedAt > 0 && elapsed < AD_COOLDOWN_MS) {
      const remainingMin = Math.ceil((AD_COOLDOWN_MS - elapsed) / 60000);
      alert(`Kolejną reklamę będziesz mógł obejrzeć za ok. ${remainingMin} min. 🕒`);
      return;
    }

    setAdCountdown(AD_DURATION_SECONDS);
    setIsWatchingAd(true);

    // TODO: Gdy podłączysz prawdziwą sieć reklamową (np. Google AdSense Rewarded Web,
    // Monetag, Adsterra), zamiast powyższego licznika wywołaj tutaj SDK sieci
    // i nasłuchuj JEJ callbacku zakończenia reklamy (np. onAdComplete),
    // wywołując finishAdReward() dopiero w tym callbacku, a nie po prostym czasie.
  };

  // Wywoływana po zakończeniu reklamy (przez atrapę lub docelowo przez SDK sieci reklamowej)
  const finishAdReward = async () => {
    setIsWatchingAd(false);

    const now = Date.now();
    setLastAdWatchedAt(now);
    localStorage.setItem('spot_last_ad_watched', now.toString());

    const newCoins = userCoins + AD_REWARD_COINS;
    const { error } = await supabase.from('users').update({ coins: newCoins }).eq('nick', userNick);

    if (!error) {
      setUserCoins(newCoins);
      alert(`Dzięki za obejrzenie reklamy! Otrzymujesz ${AD_REWARD_COINS} monet 🪙`);
    } else {
      alert('Błąd podczas przyznawania monet. Spróbuj ponownie.');
    }
  };

  const fetchFriendships = async (nick: string) => {
    const { data, error } = await supabase
      .from('friendships')
      .select('*')
      .or(`sender_nick.eq.${nick},receiver_nick.eq.${nick}`);

    if (!error && data) {
      const accepted: string[] = [];
      const pending: Friendship[] = [];

      data.forEach((f: Friendship) => {
        if (f.status === 'accepted') {
          const friend = f.sender_nick === nick ? f.receiver_nick : f.sender_nick;
          accepted.push(friend);
        } else if (f.status === 'pending' && f.receiver_nick === nick) {
          pending.push(f);
        }
      });

      setFriendsList(accepted);
      setPendingRequests(pending);
    }
  };

  const fetchChatMessages = async (me: string, friend: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_nick.eq.${me},receiver_nick.eq.${friend}),and(sender_nick.eq.${friend},receiver_nick.eq.${me})`)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setChatMessages(data as ChatMessage[]);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatMessage.trim() || !activeChatFriend) return;

    const msg = {
      sender_nick: userNick,
      receiver_nick: activeChatFriend,
      content: newChatMessage.trim(),
    };

    setNewChatMessage('');
    await supabase.from('messages').insert([msg]);
  };

  // WSPÓLNA LOGIKA WYSYŁANIA ZAPROSZENIA (używana w formularzu i w Modalu Profilu)
  const sendFriendRequestTo = async (target: string) => {
    const cleanTarget = target.trim();
    if (!cleanTarget) return;
    if (userNick === 'Anonim') {
      alert("Najpierw ustaw swój nick w ustawieniach (⚙️)!");
      return;
    }
    if (cleanTarget === userNick) {
      alert("Nie możesz dodać samego siebie do znajomych!");
      return;
    }

    const { data: existing } = await supabase
      .from('friendships')
      .select('*')
      .or(`and(sender_nick.eq.${userNick},receiver_nick.eq.${cleanTarget}),and(sender_nick.eq.${cleanTarget},receiver_nick.eq.${userNick})`);

    if (existing && existing.length > 0) {
      alert("Zaproszenie do tego użytkownika już istnieje lub jesteście już znajomymi!");
      return;
    }

    const { error } = await supabase.from('friendships').insert([
      { sender_nick: userNick, receiver_nick: cleanTarget, status: 'pending' }
    ]);

    if (error) {
      alert(`Błąd: ${error.message}`);
      return;
    }

    alert(`Wysłano zaproszenie do @${cleanTarget}!`);
    fetchFriendships(userNick);
  };

  const sendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = friendInputNick.trim();
    if (!target) return;
    await sendFriendRequestTo(target);
    setFriendInputNick('');
  };

  const acceptFriendRequest = async (friendshipId: number) => {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);

    if (!error) {
      fetchFriendships(userNick);
    }
  };

  const removeFriendship = async (friendshipId: number) => {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (!error) {
      fetchFriendships(userNick);
    }
  };

  // Otwiera czat z danym znajomym (np. z poziomu Modalu Profilu)
  const openChatWithFriend = (nick: string) => {
    setProfileModalUser(null);
    closeAllPanels();
    setIsSettingsOpen(false);
    setIsChatOpen(true);
    setActiveChatFriend(nick);
  };

  useEffect(() => {
    if (activeSpot) {
      fetchReviews(activeSpot.id);
    } else {
      setSpotReviews([]);
    }
  }, [activeSpot]);

  const fetchSpots = async () => {
    const { data, error } = await supabase.from('spots').select('*, reviews(rating)');
    if (!error && data) {
      setSpots(data as Spot[]);
    }
  };

  const fetchEvents = async () => {
    const { data, error } = await supabase.from('events').select('*');
    if (!error && data) {
      const active = (data as EventItem[]).filter(isEventActive);
      setEvents(active);
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
    setCreatingEventSpot(null);
    setActiveEvent(null);
    setProfileModalUser(null);
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

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setTempAvatarFile(file);
      setTempAvatarUrl(URL.createObjectURL(file));
    }
  };

  const saveUserSettings = async () => {
    const cleanNick = tempNick.trim();
    if (!cleanNick) {
      alert("Nick nie może być pusty!");
      return;
    }

    setIsSavingSettings(true);
    let deviceId = localStorage.getItem('spot_device_id');
    if (!deviceId) {
      deviceId = 'dev-' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('spot_device_id', deviceId);
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .ilike('nick', cleanNick)
      .maybeSingle();

    if (existingUser && existingUser.device_id !== deviceId) {
      setIsSavingSettings(false);
      alert(`Przepraszamy, nick "@${cleanNick}" jest już zajęty przez innego użytkownika!`);
      return;
    }

    const oldNick = userNick;

    let finalAvatarUrl = userAvatar;
    if (tempAvatarFile) {
      const fileExt = tempAvatarFile.name.split('.').pop();
      const fileName = `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      const filePath = `public/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('spot-images').upload(filePath, tempAvatarFile);
      if (!uploadError) {
        const { data } = supabase.storage.from('spot-images').getPublicUrl(filePath);
        if (data?.publicUrl) finalAvatarUrl = data.publicUrl;
      }
    }

    await supabase.from('users').upsert(
      { device_id: deviceId, nick: cleanNick },
      { onConflict: 'device_id' }
    );

    if (oldNick && oldNick !== cleanNick && oldNick !== 'Anonim') {
      await supabase
        .from('friendships')
        .update({ sender_nick: cleanNick })
        .eq('sender_nick', oldNick);

      await supabase
        .from('friendships')
        .update({ receiver_nick: cleanNick })
        .eq('receiver_nick', oldNick);

      await supabase.from('messages').update({ sender_nick: cleanNick }).eq('sender_nick', oldNick);
      await supabase.from('messages').update({ receiver_nick: cleanNick }).eq('receiver_nick', oldNick);
    }

    setUserNick(cleanNick);
    setShareLocation(tempShare);
    setVisibilityRadius(tempRadius);
    
    localStorage.setItem('spot_user_nick', cleanNick);
    localStorage.setItem('spot_user_shared', tempShare ? 'true' : 'false');
    localStorage.setItem('spot_user_radius', tempRadius.toString());
    
    if (finalAvatarUrl) {
      setUserAvatar(finalAvatarUrl);
      localStorage.setItem('spot_user_avatar', finalAvatarUrl);
    }

    fetchFriendships(cleanNick);
    fetchUserProfile(cleanNick); // Odśwież monety w razie zmiany nicku
    setIsSavingSettings(false);
    setIsSettingsOpen(false);
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
    fetchSpots();
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingEventSpot || !eventTitle.trim() || !eventTime) {
      alert("Uzupełnij godzinę i tematykę spotkania!");
      return;
    }

    setLoading(true);
    const newEvent = {
      spot_id: creatingEventSpot.id,
      title: eventTitle.trim(),
      time: eventTime,
      creator_nick: userNick,
      participants: [] as string[],
    };

    const { data, error } = await supabase.from('events').insert([newEvent]).select();
    setLoading(false);

    if (error) {
      alert(`Błąd podczas tworzenia eventu: ${error.message}`);
      return;
    }

    if (data && data.length > 0) {
      const created = data[0] as EventItem;
      if (isEventActive(created)) {
        setEvents((prev) => [...prev, created]);
      }
      setEventTitle('');
      setEventTime('');
      closeAllPanels();
    }
  };

  const handleJoinEvent = async (event: EventItem) => {
    if (userNick === 'Anonim') {
      alert("Ustaw swój nick w ustawieniach (⚙️), zanim dołączysz do eventu!");
      return;
    }
    if (event.participants.includes(userNick)) return;

    setLoading(true);
    const updatedParticipants = [...event.participants, userNick];

    const { data, error } = await supabase
      .from('events')
      .update({ participants: updatedParticipants })
      .eq('id', event.id)
      .select();

    setLoading(false);

    if (error) {
      alert(`Błąd: ${error.message}`);
      return;
    }

    if (data && data.length > 0) {
      const updated = data[0] as EventItem;
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setActiveEvent(updated);
    }
  };

  const handleLeaveEvent = async (event: EventItem) => {
    setLoading(true);
    const updatedParticipants = event.participants.filter((p) => p !== userNick);

    const { data, error } = await supabase
      .from('events')
      .update({ participants: updatedParticipants })
      .eq('id', event.id)
      .select();

    setLoading(false);

    if (error) {
      alert(`Błąd: ${error.message}`);
      return;
    }

    if (data && data.length > 0) {
      const updated = data[0] as EventItem;
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setActiveEvent(updated);
    }
  };

  const getAverageRating = (spot: Spot) => {
    if (!spot.reviews || spot.reviews.length === 0) return null;
    const sum = spot.reviews.reduce((acc, curr) => acc + curr.rating, 0);
    return (sum / spot.reviews.length).toFixed(1);
  };

  const getEventForSpot = (spotId: number) => {
    const spotEvents = events.filter((e) => e.spot_id === spotId && isEventActive(e));
    if (spotEvents.length === 0) return null;
    return spotEvents[spotEvents.length - 1];
  };

  const activeEventsList = events.filter(isEventActive);
  const isSheetOpen = activeSpot || selectedAnchor || reviewSpot || previewSpot || creatingEventSpot || activeEvent;

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
            {userLocation && liveUsers.map((liveUser) => {
              const distance = getDistanceInMeters(userLocation[0], userLocation[1], liveUser.lat, liveUser.lng);
              const userRadius = liveUser.radius || 100;
              
              if (distance > userRadius) return null; 

              const isFriend = friendsList.includes(liveUser.nick);
              const isVip = liveUser.hasVipFrame; // Sprawdzanie czy znajomy ma VIP

              return (
                <Overlay key={liveUser.id} anchor={[liveUser.lat, liveUser.lng]} offset={[14, 14]}>
                  <div 
                    className="relative flex items-center justify-center w-7 h-7 pointer-events-auto group cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProfileModalUser({
                        nick: liveUser.nick,
                        avatar: liveUser.avatar,
                        isSelf: false,
                        isFriend,
                        isVip: !!isVip,
                        nowPlaying: liveUser.nowPlaying,
                        distance,
                      });
                    }}
                  >
                    <div className={`absolute w-full h-full rounded-full animate-ping opacity-50 ${isFriend ? 'bg-amber-400' : 'bg-emerald-500'}`}></div>
                    
                    {liveUser.nowPlaying && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProfileModalUser({
                            nick: liveUser.nick,
                            avatar: liveUser.avatar,
                            isSelf: false,
                            isFriend,
                            isVip: !!isVip,
                            nowPlaying: liveUser.nowPlaying,
                            distance,
                          });
                        }}
                        className="absolute -top-7 bg-emerald-900/90 border border-emerald-500 text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-md pointer-events-auto flex items-center gap-1 animate-pulse cursor-pointer active:scale-95 transition-transform"
                      >
                        <span>🎵</span> {liveUser.nowPlaying}
                      </button>
                    )}

                    {liveUser.avatar ? (
                      <img 
                        src={liveUser.avatar} 
                        alt={liveUser.nick}
                        className={`relative w-7 h-7 rounded-full border-2 object-cover shadow-lg ${isVip ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]' : isFriend ? 'border-amber-400' : 'border-emerald-400'}`} 
                      />
                    ) : (
                      <div className={`relative flex items-center justify-center w-7 h-7 border-2 border-white rounded-full shadow-md text-[9px] font-bold text-white ${isVip ? 'bg-yellow-500 shadow-[0_0_15px_rgba(250,204,21,0.6)] border-yellow-300' : isFriend ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                        {liveUser.nick.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                </Overlay>
              );
            })}

            {userLocation && (
              <Overlay anchor={userLocation} offset={userAvatar ? [16, 16] : [12, 12]}>
                <div
                  className={`relative flex items-center justify-center pointer-events-auto cursor-pointer ${userAvatar ? 'w-8 h-8' : 'w-6 h-6'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setProfileModalUser({
                      nick: userNick,
                      avatar: userAvatar,
                      isSelf: true,
                      isFriend: false,
                      isVip: hasVipFrame,
                      nowPlaying: currentSong,
                      distance: null,
                    });
                  }}
                >
                  {shareLocation && (
                    <div className="absolute w-full h-full bg-emerald-500 rounded-full animate-ping opacity-60 pointer-events-none"></div>
                  )}
                  {!shareLocation && (
                    <div className="absolute w-full h-full bg-blue-500 rounded-full animate-ping opacity-60 pointer-events-none"></div>
                  )}

                  {currentSong && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProfileModalUser({
                          nick: userNick,
                          avatar: userAvatar,
                          isSelf: true,
                          isFriend: false,
                          isVip: hasVipFrame,
                          nowPlaying: currentSong,
                          distance: null,
                        });
                      }}
                      className="absolute -top-7 bg-emerald-900/90 border border-emerald-500 text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-md flex items-center gap-1 animate-pulse cursor-pointer active:scale-95 transition-transform"
                    >
                      <span>🎵</span> {currentSong}
                    </button>
                  )}

                  {userAvatar ? (
                    <img 
                      src={userAvatar} 
                      alt="Twój awatar" 
                      className={`relative w-8 h-8 rounded-full border-[2.5px] object-cover shadow-lg ${hasVipFrame ? 'border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.8)]' : shareLocation ? 'border-emerald-400 shadow-emerald-500/50' : 'border-white shadow-blue-500/50'}`} 
                    />
                  ) : (
                    <div className={`relative w-3.5 h-3.5 border-2 rounded-full shadow-md ${hasVipFrame ? 'bg-yellow-400 border-yellow-200 shadow-[0_0_15px_rgba(250,204,21,0.8)]' : shareLocation ? 'border-white bg-emerald-500 shadow-emerald-500/50' : 'border-white bg-blue-500 shadow-blue-500/50'}`}></div>
                  )}
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

            {activeEventsList.map((eventItem) => {
              const spot = spots.find((s) => s.id === eventItem.spot_id);
              if (!spot) return null;

              return (
                <Overlay key={`event-${eventItem.id}`} anchor={[spot.lat, spot.lng]} offset={[19, 58]}>
                  <div
                    className="relative flex flex-col items-center pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeAllPanels();
                      setActiveEvent(eventItem);
                      setSheetHeight(50);
                    }}
                  >
                    <div className="mb-1.5 bg-amber-500 text-slate-900 text-[10px] font-black px-2.5 py-1 rounded-full shadow-lg shadow-amber-500/40 whitespace-nowrap animate-bounce border border-amber-300">
                      🎉 EVENT · {eventItem.time}
                    </div>
                    <div className="relative w-8 h-8 flex items-center justify-center">
                      <div className="absolute w-full h-full bg-amber-400 rounded-full animate-ping opacity-70" />
                      <div className="relative w-8 h-8 bg-amber-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-sm">
                        🎉
                      </div>
                    </div>
                  </div>
                </Overlay>
              );
            })}

            {selectedAnchor && (
              <Marker width={42} anchor={selectedAnchor} color="#f43f5e" />
            )}
          </Map>
        )}
      </div>

      <button
        onClick={() => {
          if (userLocation) {
            setMapCenter(userLocation);
            setMapZoom(15);
          }
        }}
        className={`absolute right-4 z-20 w-12 h-12 bg-slate-900/90 backdrop-blur-md border border-slate-800 text-slate-300 rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-all duration-300 ${isSheetOpen ? 'bottom-[35vh]' : 'bottom-32'}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={shareLocation ? "text-emerald-400" : "text-blue-400"}>
          <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
        </svg>
      </button>

      <button
        onClick={() => {
          setIsChatOpen(true);
          closeAllPanels();
        }}
        className={`absolute left-4 z-20 w-12 h-12 bg-blue-600 border border-blue-500 text-white rounded-full shadow-lg shadow-blue-600/30 flex items-center justify-center active:scale-95 transition-all duration-300 ${isSheetOpen ? 'bottom-[35vh]' : 'bottom-32'}`}
      >
        <span className="text-xl">💬</span>
      </button>

      <header className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center pointer-events-none">
        
        {/* DODANY POKAZ MONET / SKLEP */}
        <div className="flex gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 bg-slate-900/95 backdrop-blur-md border border-slate-800 px-3.5 py-2 rounded-full shadow-lg">
            <span className="text-white font-black text-sm tracking-tight">SPOTA</span>
          </div>
          <div 
            onClick={() => {
              setTempNick(userNick);
              setTempAvatarUrl(userAvatar);
              setTempShare(shareLocation);
              setTempRadius(visibilityRadius);
              setTempAvatarFile(null);
              setSettingsTab('store'); // Otwieranie od razu na zakładce sklep
              setIsSettingsOpen(true);
              closeAllPanels();
            }}
            className="flex items-center gap-1.5 bg-slate-900/95 backdrop-blur-md border border-amber-500/30 px-3 py-2 rounded-full shadow-lg cursor-pointer hover:border-amber-500 transition-all active:scale-95"
          >
            <span className="text-sm">🪙</span>
            <span className="text-xs font-bold text-amber-400">{userCoins}</span>
          </div>
        </div>
        
        <button 
          onClick={() => {
            setTempNick(userNick);
            setTempAvatarUrl(userAvatar);
            setTempShare(shareLocation);
            setTempRadius(visibilityRadius);
            setTempAvatarFile(null);
            setSettingsTab('profile');
            setIsSettingsOpen(true);
            closeAllPanels();
          }}
          className="flex items-center gap-2 bg-slate-900/95 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-full shadow-lg pointer-events-auto active:scale-95 transition-all"
        >
          {userAvatar && (
            <img src={userAvatar} alt="Awatar" className={`w-4 h-4 rounded-full object-cover border ${hasVipFrame ? 'border-yellow-400' : shareLocation ? 'border-emerald-400' : 'border-slate-700'}`} />
          )}
          <span className={`text-xs font-semibold ${hasVipFrame ? 'text-yellow-400 drop-shadow-md' : shareLocation ? 'text-emerald-400' : 'text-slate-300'}`}>@{userNick}</span>
          {pendingRequests.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          )}
          <span className="text-[10px] opacity-70">⚙️</span>
        </button>
      </header>

      {/* POWIADOMIENIA O ZAPROSZENIACH NA GŁÓWNYM EKRANIE */}
      {!isSheetOpen && !isSettingsOpen && !isChatOpen && pendingRequests.length > 0 && (
        <div className="absolute top-20 left-4 right-4 z-20 flex flex-col gap-3 pointer-events-none">
          {pendingRequests.map((req) => (
            <div 
              key={req.id} 
              className="bg-slate-900/95 backdrop-blur-xl border border-amber-500/50 p-3.5 rounded-2xl shadow-2xl shadow-amber-500/20 flex justify-between items-center animate-in slide-in-from-top-4 duration-300 pointer-events-auto"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-lg shadow-inner">
                  👤
                </div>
                <div>
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Nowe zaproszenie</p>
                  <p className="text-sm font-black text-white">@{req.sender_nick}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => acceptFriendRequest(req.id)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
                >
                  Przyjmij
                </button>
                <button 
                  onClick={() => removeFriendship(req.id)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs px-3 py-2 rounded-xl border border-slate-700 active:scale-95 transition-all"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isSheetOpen && !isSettingsOpen && !isChatOpen && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2.5 w-max">
          {userLocation ? (
            <button
              onClick={() => {
                closeAllPanels();
                setSelectedAnchor(userLocation);
                setSheetHeight(75);
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm px-6 py-3.5 rounded-full shadow-lg shadow-blue-600/30 flex items-center gap-2.5 active:scale-95 transition-all pointer-events-auto border border-blue-500"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
              Dodaj spot tutaj
            </button>
          ) : (
            <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 text-slate-400 text-xs px-5 py-3 rounded-full shadow-2xl flex items-center gap-2 pointer-events-none">
              <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
              Szukam GPS...
            </div>
          )}
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 text-slate-400 text-[10px] px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
            lub dotknij mapy w dowolnym miejscu
          </div>
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
            
            {previewSpot && (() => {
              const spotEvent = getEventForSpot(previewSpot.id);
              return (
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

                {spotEvent && (
                  <div className="mb-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs px-3 py-2 rounded-xl flex items-center gap-1.5">
                    🎉 Trwa tu event: <span className="font-bold">{spotEvent.title}</span> o {spotEvent.time}
                  </div>
                )}

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

                  {spotEvent ? (
                    <button
                      onClick={() => {
                        setActiveEvent(spotEvent);
                        setPreviewSpot(null);
                        setSheetHeight(50);
                      }}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3.5 px-4 rounded-xl text-sm flex justify-between shadow-lg shadow-amber-500/20"
                    >
                      <span>🎉 Zobacz event</span><span>→</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setCreatingEventSpot(previewSpot);
                        setPreviewSpot(null);
                        setSheetHeight(75);
                        setEventTitle('');
                        setEventTime('');
                      }}
                      className="w-full bg-amber-600/15 hover:bg-amber-600/25 text-amber-400 font-semibold py-3.5 px-4 rounded-xl text-sm border border-amber-500/30 flex justify-between transition-all"
                    >
                      <span>🎉 Stwórz event</span><span>→</span>
                    </button>
                  )}
                </div>
              </div>
              );
            })()}

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

            {creatingEventSpot && (
              <form onSubmit={handleCreateEvent} className="flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-1">
                  <h2 className="font-bold text-lg text-white flex items-center gap-2">
                    🎉 Nowy event: {creatingEventSpot.name}
                  </h2>
                  <button type="button" onClick={closeAllPanels} className="bg-slate-800 border border-slate-700 p-1.5 rounded-full text-slate-400">✕</button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Godzina spotkania</label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="w-full p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Tematyka spotkania</label>
                  <input
                    type="text"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="np. Ognisko integracyjne 🔥"
                    className="w-full p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="text-xs text-slate-500 bg-slate-800/40 border border-slate-800 rounded-xl p-3">
                  Event zniknie automatycznie po upływie godziny od wyznaczonej godziny rozpoczęcia.
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-3.5 rounded-xl text-sm mt-2 shadow-lg shadow-amber-500/20"
                >
                  {loading ? 'Tworzenie...' : 'Stwórz event 🚀'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreviewSpot(creatingEventSpot);
                    setCreatingEventSpot(null);
                    setSheetHeight(40);
                  }}
                  className="w-full mt-1 bg-transparent text-slate-400 font-semibold py-2 px-4 rounded-xl text-sm"
                >
                  Wróć
                </button>
              </form>
            )}

            {activeEvent && (() => {
              const eventSpot = spots.find((s) => s.id === activeEvent.spot_id);
              const isJoined = activeEvent.participants.includes(userNick);
              return (
                <div className="animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-white leading-tight flex items-center gap-2">
                      🎉 {activeEvent.title}
                    </h2>
                    <button onClick={closeAllPanels} className="bg-slate-800 border border-slate-700 p-1.5 rounded-full text-slate-400">✕</button>
                  </div>

                  {eventSpot && (
                    <p className="text-xs text-slate-500 mb-4 -mt-2">📍 {eventSpot.name}</p>
                  )}

                  <div className="flex flex-col gap-2.5 mb-5">
                    <div className="flex items-center justify-between bg-slate-800/50 border border-slate-800 rounded-xl px-4 py-3">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">🕒 Godzina</span>
                      <span className="text-sm font-bold text-amber-400">{activeEvent.time}</span>
                    </div>
                    <div className="flex items-center justify-between bg-slate-800/50 border border-slate-800 rounded-xl px-4 py-3">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">👤 Organizator</span>
                      <span className="text-sm font-bold text-slate-200">@{activeEvent.creator_nick}</span>
                    </div>
                    <div className="flex items-center justify-between bg-slate-800/50 border border-slate-800 rounded-xl px-4 py-3">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">🙋 Uczestnicy</span>
                      <span className="text-sm font-bold text-emerald-400">{activeEvent.participants.length}</span>
                    </div>
                  </div>

                  {activeEvent.participants.length > 0 && (
                    <div className="mb-5">
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Kto idzie</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activeEvent.participants.map((nick, idx) => (
                          <span key={idx} className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                            @{nick}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isJoined ? (
                    <button
                      onClick={() => handleLeaveEvent(activeEvent)}
                      disabled={loading}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-emerald-400 font-bold py-3.5 rounded-xl text-sm border border-emerald-500/30 transition-all"
                    >
                      {loading ? 'Zapisywanie...' : '✅ Bierzesz udział (kliknij, aby zrezygnować)'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleJoinEvent(activeEvent)}
                      disabled={loading}
                      className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-3.5 rounded-xl text-sm shadow-lg shadow-amber-500/20 transition-all"
                    >
                      {loading ? 'Zapisywanie...' : '🙋 Wezmę udział'}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      if (eventSpot) setPreviewSpot(eventSpot);
                      setActiveEvent(null);
                      setSheetHeight(40);
                    }}
                    className="w-full mt-2.5 bg-transparent text-slate-400 font-semibold py-2 px-4 rounded-xl text-sm"
                  >
                    ← Wróć do spota
                  </button>
                </div>
              );
            })()}

          </div>
        </div>
      )}

      {/* NOWY MODAL PROFILU (własny i cudzy) */}
      {profileModalUser && (
        <div
          className="fixed inset-0 z-[65] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setProfileModalUser(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-[28px] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-1">
              <button
                onClick={() => setProfileModalUser(null)}
                className="bg-slate-800 border border-slate-700 w-8 h-8 rounded-full text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col items-center text-center mb-5">
              <div
                className={`relative w-24 h-24 mb-3 rounded-full border-[3px] bg-slate-800 flex items-center justify-center overflow-hidden ${
                  profileModalUser.isVip
                    ? 'border-yellow-400 shadow-[0_0_25px_rgba(250,204,21,0.7)]'
                    : profileModalUser.isFriend
                    ? 'border-amber-400'
                    : 'border-emerald-400'
                }`}
              >
                {profileModalUser.avatar ? (
                  <img src={profileModalUser.avatar} alt={profileModalUser.nick} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-black text-white">
                    {profileModalUser.nick.substring(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <h2 className={`text-xl font-black flex items-center gap-1.5 ${profileModalUser.isVip ? 'text-yellow-400' : 'text-white'}`}>
                @{profileModalUser.nick}
                {profileModalUser.isVip && <span>⭐</span>}
              </h2>
              <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                {profileModalUser.isSelf && (
                  <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">
                    To Ty
                  </span>
                )}
                {!profileModalUser.isSelf && profileModalUser.isFriend && (
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
                    ⭐ Znajomy
                  </span>
                )}
                {typeof profileModalUser.distance === 'number' && (
                  <span className="text-[10px] font-bold text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-full">
                    📍 {Math.round(profileModalUser.distance)} m od Ciebie
                  </span>
                )}
              </div>
            </div>

            <div className="mb-5">
              {profileModalUser.nowPlaying ? (
                <div className="bg-emerald-900/30 border border-emerald-500/40 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-lg animate-pulse shrink-0">
                    🎵
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                      {profileModalUser.isSelf ? 'Teraz słuchasz' : 'Teraz słucha'}
                    </p>
                    <p className="text-sm font-bold text-white truncate">{profileModalUser.nowPlaying}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4 text-center text-slate-500 text-xs">
                  {profileModalUser.isSelf ? 'Nic teraz nie gra 🎧' : 'Nic teraz nie słucha muzyki'}
                </div>
              )}
            </div>

            {!profileModalUser.isSelf && (
              <div className="flex flex-col gap-2.5">
                {profileModalUser.isFriend ? (
                  <button
                    onClick={() => openChatWithFriend(profileModalUser.nick)}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl text-sm shadow-lg shadow-blue-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    💬 Napisz
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      await sendFriendRequestTo(profileModalUser.nick);
                      setProfileModalUser(null);
                    }}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3.5 rounded-xl text-sm shadow-lg shadow-amber-500/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    ➕ Zaproś do znajomych
                  </button>
                )}
              </div>
            )}

            {profileModalUser.isSelf && (
              <button
                onClick={() => {
                  setProfileModalUser(null);
                  setTempNick(userNick);
                  setTempAvatarUrl(userAvatar);
                  setTempShare(shareLocation);
                  setTempRadius(visibilityRadius);
                  setTempAvatarFile(null);
                  setSettingsTab('profile');
                  setIsSettingsOpen(true);
                }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3.5 rounded-xl text-sm border border-slate-700 transition-all active:scale-95"
              >
                ⚙️ Edytuj profil
              </button>
            )}
          </div>
        </div>
      )}

      {/* MODAL USTAWIEN Z ZAKŁADKĄ SKLEPU */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-[28px] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                ⚙️ Ustawienia
              </h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="bg-slate-800 border border-slate-700 w-8 h-8 rounded-full text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="flex bg-slate-950 p-1 rounded-xl mb-5 border border-slate-800">
              <button
                onClick={() => setSettingsTab('profile')}
                className={`flex-1 py-2 text-[11px] font-bold rounded-lg transition-all ${settingsTab === 'profile' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Profil
              </button>
              <button
                onClick={() => setSettingsTab('friends')}
                className={`flex-1 py-2 text-[11px] font-bold rounded-lg transition-all relative ${settingsTab === 'friends' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Znajomi
                {pendingRequests.length > 0 && (
                  <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>
              {/* NOWA ZAKŁADKA */}
              <button
                onClick={() => setSettingsTab('store')}
                className={`flex-1 py-2 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${settingsTab === 'store' ? 'bg-amber-500 text-slate-900' : 'text-amber-500/70 hover:text-amber-400'}`}
              >
                🪙 Sklep
              </button>
            </div>

            {settingsTab === 'store' ? (
              <div className="animate-in fade-in duration-200 flex flex-col gap-4">
                
                <div className="bg-slate-950 p-5 rounded-2xl border border-amber-500/30 flex flex-col items-center justify-center text-center shadow-lg shadow-amber-500/10">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-1">Twój portfel SPOTA</p>
                  <div className="text-5xl font-black text-white flex items-center gap-2 drop-shadow-md">
                    🪙 {userCoins}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-600/20 to-blue-900/10 border border-blue-500/40 p-4 rounded-xl flex justify-between items-center gap-3">
                  <div>
                    <p className="text-sm font-bold text-white flex items-center gap-1.5">🎬 Obejrzyj reklamę</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight max-w-[160px]">
                      {AD_DURATION_SECONDS} sekund reklamy = {AD_REWARD_COINS} monet za darmo!
                    </p>
                  </div>
                  <button
                    onClick={handleWatchAd}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-lg shadow-blue-600/30 whitespace-nowrap"
                  >
                    ▶️ Obejrzyj
                  </button>
                </div>

                <div className="bg-slate-800/40 border border-slate-700 p-4 rounded-xl flex justify-between items-center">
                  <div>
                    <p className="text-sm font-bold text-white">Doładuj 100 Monet</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight max-w-[150px]">Przycisk testowy – kliknij aby dodać darmowe monety!</p>
                  </div>
                  <button 
                    onClick={handleAddCoins} 
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-xl active:scale-95 transition-all shadow-lg shadow-blue-600/30"
                  >
                    + Dodaj
                  </button>
                </div>

                <div className="bg-gradient-to-br from-amber-500/20 to-yellow-600/10 border border-amber-500/50 p-5 rounded-xl flex flex-col gap-3 relative overflow-hidden mt-2">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/20 blur-2xl rounded-full" />
                  
                  <div className="flex justify-between items-start z-10">
                    <div>
                      <p className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
                        ⭐ Złota Ramka VIP
                      </p>
                      <p className="text-[10px] text-slate-300 mt-1 max-w-[180px] leading-relaxed">
                        Wyróżnij się z tłumu! Otrzymasz piękną, animowaną złotą ramkę wokół swojego awatara.
                      </p>
                    </div>
                    <div className="text-lg font-black text-amber-400 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-amber-500/30 shadow-lg shadow-amber-500/20">
                      50 🪙
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleBuyVip}
                    disabled={hasVipFrame}
                    className={`w-full text-xs font-bold py-3 rounded-xl transition-all z-10 mt-1 ${hasVipFrame ? 'bg-slate-800 text-slate-500 border border-slate-700' : 'bg-amber-500 hover:bg-amber-400 text-slate-900 shadow-lg shadow-amber-500/30 active:scale-95'}`}
                  >
                    {hasVipFrame ? '✅ Posiadasz ten status' : 'Kup teraz za 50 monet'}
                  </button>
                </div>

              </div>
            ) : settingsTab === 'profile' ? (
              <div className="animate-in fade-in duration-200">
                <div className="mb-4 flex flex-col items-center">
                  <div className={`relative w-20 h-20 mb-2 rounded-full border-2 bg-slate-800 flex items-center justify-center overflow-hidden ${hasVipFrame ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]' : 'border-slate-700'}`}>
                    {tempAvatarUrl ? (
                      <img src={tempAvatarUrl} alt="Podgląd" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">👤</span>
                    )}
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleAvatarSelect}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                  <p className="text-[10px] text-blue-400 font-medium">Kliknij, by zmienić zdjęcie</p>
                </div>

                <div className="mb-4">
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Twój unikalny Nick</label>
                  <input type="text" value={tempNick} onChange={(e) => setTempNick(e.target.value)} placeholder="Podaj nowy nick..." className="w-full p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-blue-500 text-center" />
                </div>

                {/* ODŚWIEŻONY WIDŻET SPOTIFY */}
                <div className={`mb-4 p-4 rounded-2xl border flex flex-col gap-3 relative overflow-hidden ${isSpotifyConnected ? 'bg-gradient-to-br from-emerald-500/15 to-emerald-900/10 border-emerald-500/40' : 'bg-slate-950 border-slate-800'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={`text-xl ${isSpotifyConnected && currentSong ? 'animate-pulse' : ''}`}>🎧</span>
                      <div>
                        <p className="text-xs font-bold text-slate-200">Spotify</p>
                        <p className="text-[10px] text-slate-400">{isSpotifyConnected ? 'Połączono ze Spotify ✓' : 'Pokazuj czego słuchasz'}</p>
                      </div>
                    </div>
                    <a 
                      href={`/api/spotify/login?nick=${encodeURIComponent(userNick)}`} 
                      className={`text-xs font-bold px-3.5 py-2 rounded-xl transition-all ${isSpotifyConnected ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                    >
                      {isSpotifyConnected ? 'Połączono' : 'Połącz'}
                    </a>
                  </div>

                  {isSpotifyConnected && (
                    <div className="bg-slate-950/60 border border-emerald-500/20 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                      <span className={`text-sm ${currentSong ? 'animate-pulse' : ''}`}>🎵</span>
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Teraz gra</p>
                        <p className="text-xs font-semibold text-white truncate">{currentSong || 'Nic teraz nie gra'}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className={`bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-start gap-3 ${tempShare ? 'mb-3' : 'mb-4'}`}>
                  <div className="pt-0.5">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={tempShare} onChange={() => setTempShare(!tempShare)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">Tryb widmo / Widoczność</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">Zaznacz, aby inni użytkownicy mogli zobaczyć Cię na żywo.</p>
                  </div>
                </div>

                {tempShare && (
                  <div className="mb-4 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Zasięg widoczności
                      </label>
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                        {tempRadius} metrów
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="10" 
                      max="1000" 
                      step="10" 
                      value={tempRadius}
                      onChange={(e) => setTempRadius(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 outline-none"
                    />
                  </div>
                )}

                <button onClick={saveUserSettings} disabled={isSavingSettings} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-3.5 rounded-xl text-sm shadow-lg shadow-blue-600/30 transition-all active:scale-95">
                  {isSavingSettings ? 'Zapisywanie...' : 'Zapisz profil'}
                </button>
              </div>
            ) : (
              <div className="animate-in fade-in duration-200 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
                <form onSubmit={sendFriendRequest} className="flex gap-2">
                  <input type="text" value={friendInputNick} onChange={(e) => setFriendInputNick(e.target.value)} placeholder="Wpisz nick..." className="flex-1 p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-xs outline-none focus:border-blue-500" />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 rounded-xl text-xs">Dodaj</button>
                </form>

                {pendingRequests.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-2">
                      Oczekujące zaproszenia ({pendingRequests.length})
                    </p>
                    <div className="flex flex-col gap-2">
                      {pendingRequests.map((req) => (
                        <div key={req.id} className="bg-slate-950 border border-amber-500/30 p-3 rounded-xl flex justify-between items-center">
                          <span className="text-xs font-bold text-white">@{req.sender_nick}</span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => acceptFriendRequest(req.id)}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg"
                            >
                              Przyjmij
                            </button>
                            <button
                              onClick={() => removeFriendship(req.id)}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] px-2 py-1.5 rounded-lg"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Twoi znajomi ({friendsList.length})</p>
                  {friendsList.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {friendsList.map((friendNick, idx) => (
                        <div key={idx} className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-xs font-bold text-white">@{friendNick}</span>
                          </div>
                          <span className="text-[10px] text-amber-400 font-semibold bg-amber-400/10 px-2 py-0.5 rounded-md">
                            ⭐ Znajomy
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 bg-slate-950/50 rounded-xl border border-slate-800 border-dashed text-slate-500 text-xs">
                      Brak znajomych. Wpisz czyjeś konto powyżej, aby zaprosić!
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isChatOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md flex flex-col animate-in slide-in-from-bottom duration-300">
          <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/80">
            {activeChatFriend ? (
              <button 
                onClick={() => setActiveChatFriend(null)}
                className="text-slate-400 hover:text-white font-bold text-sm flex items-center gap-2"
              >
                <span>←</span> Wróć do listy
              </button>
            ) : (
              <h2 className="text-xl font-black text-white">💬 Twoje czaty</h2>
            )}

            <button 
              onClick={() => {
                setIsChatOpen(false);
                setActiveChatFriend(null);
              }}
              className="bg-slate-800 border border-slate-700 w-8 h-8 rounded-full text-slate-400 hover:text-white flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-950 relative">
            {!activeChatFriend ? (
              <div className="p-4 flex flex-col gap-3">
                {friendsList.length > 0 ? (
                  friendsList.map((friendNick, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => setActiveChatFriend(friendNick)}
                      className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex justify-between items-center cursor-pointer hover:border-blue-500 transition-all active:scale-[0.98]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-800 rounded-full border border-slate-700 flex items-center justify-center text-lg shadow-inner">
                          👤
                        </div>
                        <div>
                          <span className="text-sm font-bold text-white">@{friendNick}</span>
                          <p className="text-[10px] text-emerald-400 mt-0.5">Kliknij, aby otworzyć czat</p>
                        </div>
                      </div>
                      <span className="text-blue-500">→</span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-slate-500 text-sm">
                    Brak znajomych. Dodaj ich w ustawieniach (⚙️), by móc czatować!
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col min-h-full pb-20">
                <div className="flex-1 p-4 flex flex-col gap-4">
                  <div className="text-center text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">
                    Rozmowa z @{activeChatFriend}
                  </div>
                  
                  {chatMessages.map((msg, idx) => {
                    const isMe = msg.sender_nick === userNick;
                    return (
                      <div key={idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${isMe ? 'bg-blue-600 text-white rounded-br-none shadow-blue-600/20 shadow-lg' : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-bl-none shadow-md'}`}>
                          {msg.content}
                        </div>
                        <span className="text-[9px] text-slate-500 mt-1 px-1">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={chatMessagesEndRef} />
                </div>

                <form 
                  onSubmit={handleSendMessage}
                  className="fixed bottom-0 left-0 right-0 p-3 bg-slate-900 border-t border-slate-800 flex gap-2 items-center"
                >
                  <input
                    type="text"
                    value={newChatMessage}
                    onChange={(e) => setNewChatMessage(e.target.value)}
                    placeholder="Napisz wiadomość..."
                    className="flex-1 p-3.5 bg-slate-950 border border-slate-700 rounded-2xl text-white text-sm outline-none focus:border-blue-500"
                  />
                  <button 
                    type="submit" 
                    disabled={!newChatMessage.trim()}
                    className="bg-blue-600 disabled:bg-slate-800 text-white font-bold p-3.5 w-12 h-12 rounded-full shadow-lg shadow-blue-600/30 flex items-center justify-center transition-all active:scale-95"
                  >
                    ➤
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL ODTWARZANIA REKLAMY (atrapa, do podmiany na prawdziwy SDK sieci reklamowej) */}
      {isWatchingAd && (
        <div className="fixed inset-0 z-[80] bg-black flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col items-center gap-5 shadow-2xl">
            <div className="w-full aspect-video bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-700 relative overflow-hidden">
              <span className="text-4xl animate-pulse">📺</span>
              <div className="absolute top-3 left-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                REKLAMA
              </div>
            </div>

            <div className="w-full">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nagroda za obejrzenie</span>
                <span className="text-xs font-bold text-amber-400">+{AD_REWARD_COINS} 🪙</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
                  style={{ width: `${((AD_DURATION_SECONDS - adCountdown) / AD_DURATION_SECONDS) * 100}%` }}
                />
              </div>
            </div>

            <p className="text-slate-400 text-xs text-center">
              Nagroda za {adCountdown}s... nie zamykaj tego okna
            </p>
          </div>
        </div>
      )}

      {fullScreenImage && (
        <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center p-4">
          <button 
            onClick={() => setFullScreenImage(null)}
            className="absolute top-6 right-6 text-white bg-slate-800/50 p-2 rounded-full border border-slate-700 z-[70] w-10 h-10 flex items-center justify-center font-bold"
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