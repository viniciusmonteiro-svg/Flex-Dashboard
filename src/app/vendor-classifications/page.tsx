import { requireAuth } from '@/lib/requireAuth';
import VendorClassificationsClient from './VendorClassificationsClient';

export default async function VendorClassificationsPage() {
  await requireAuth();
  return <VendorClassificationsClient />;
}
