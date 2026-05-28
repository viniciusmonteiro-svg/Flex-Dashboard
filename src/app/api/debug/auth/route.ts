import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const { userId, sessionClaims } = await auth();
  return NextResponse.json({
    userId,
    publicMetadata: sessionClaims?.publicMetadata ?? null,
    sessionClaims: sessionClaims ?? null,
  });
}
