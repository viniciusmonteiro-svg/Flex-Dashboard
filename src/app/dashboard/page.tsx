import { requireAuth } from '@/lib/requireAuth';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  await requireAuth();
  return <DashboardClient />;
}
