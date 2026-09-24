import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userNick = searchParams.get('nick') || 'Anonim';

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  
  // TWARDO WPISANY ADRES - całkowicie ignorujemy plik .env.local
  const redirectUri = 'http://127.0.0.1:3000/api/spotify/callback';

  const scope = 'user-read-currently-playing user-read-playback-state';

  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=${encodeURIComponent(
    scope
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(userNick)}`;

  return NextResponse.redirect(authUrl);
}