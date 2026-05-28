import { requireAuth } from '@/lib/requireAuth';
import SalesforceClient from './SalesforceClient';

export default async function SalesforcePage() {
  await requireAuth();
  return <SalesforceClient />;
}
