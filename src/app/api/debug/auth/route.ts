import { currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({
    userId: user?.id ?? null,
    publicMetadata: user?.publicMetadata ?? null,
  });
}
