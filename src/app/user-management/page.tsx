import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import UserManagementClient from './UserManagementClient';

export default async function UserManagementPage() {
  const { sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as { role?: string })?.role;
  if (role !== 'admin') redirect('/access-denied');
  return <UserManagementClient />;
}
