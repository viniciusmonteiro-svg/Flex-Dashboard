import { requireAdmin } from '@/lib/requireAuth';
import UserManagementClient from './UserManagementClient';

export default async function UserManagementPage() {
  await requireAdmin();
  return <UserManagementClient />;
}
