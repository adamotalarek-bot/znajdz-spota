import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(new URL('/mapa?spotify_error=auth_denied', request.url));
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri!,
    }),
  });

  const data = await response.json();

  if (data.access_token) {
    const res = NextResponse.redirect(new URL('/mapa?spotify_success=true', request.url));
    // Zapisujemy token w ciasteczku na 1 godzinę
    res.cookies.set('spotify_access_token', data.access_token, { maxAge: 3600, path: '/' });
    if (data.refresh_token) {
      res.cookies.set('spotify_refresh_token', data.refresh_token, { path: '/' });
    }
    return res;
  }

  return NextResponse.redirect(new URL('/mapa?spotify_error=token_failed', request.url));
}