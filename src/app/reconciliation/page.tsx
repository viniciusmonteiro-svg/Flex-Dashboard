import { requireAuth } from '@/lib/requireAuth';
import { ReconciliationClient } from './ReconciliationClient';

export const metadata = {
  title: 'Reconciliation — Marketing Dashboard',
};

export default async function ReconciliationPage() {
  await requireAuth();
  return <ReconciliationClient />;
}
