import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('spotify_access_token')?.value;

  if (!token) {
    return NextResponse.json({ item: null });
  }

  const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 204 || response.status > 400) {
    return NextResponse.json({ item: null });
  }

  const data = await response.json();
  return NextResponse.json(data);
}