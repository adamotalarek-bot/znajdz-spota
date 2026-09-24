import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const baseUrl = 'http://127.0.0.1:3000';
  
  // TWARDO WPISANY ADRES
  const redirectUri = 'http://127.0.0.1:3000/api/spotify/callback';

  if (error || !code) {
    return NextResponse.redirect(new URL(`/mapa?spotify_error=${error || 'auth_denied'}`, baseUrl));
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      const res = NextResponse.redirect(new URL('/mapa?spotify_success=true', baseUrl));
      const cookieStore = await cookies();
      cookieStore.set('spotify_access_token', data.access_token, { maxAge: 3600, path: '/' });
      if (data.refresh_token) {
        cookieStore.set('spotify_refresh_token', data.refresh_token, { path: '/' });
      }
      return res;
    } else {
      return NextResponse.redirect(new URL('/mapa?spotify_error=token_failed', baseUrl));
    }
  } catch (e) {
    return NextResponse.redirect(new URL('/mapa?spotify_error=server_error', baseUrl));
  }
}