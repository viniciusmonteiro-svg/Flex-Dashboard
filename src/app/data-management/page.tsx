import { requireAuth } from '@/lib/requireAuth';
import { DataManagementClient } from './DataManagementClient';

export const metadata = {
  title: 'Data Management — Marketing Dashboard',
};

export default async function DataManagementPage() {
  await requireAuth();
  return <DataManagementClient />;
}
