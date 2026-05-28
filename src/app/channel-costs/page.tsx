import { requireAuth } from '@/lib/requireAuth';
import ChannelCostsClient from './ChannelCostsClient';

export default async function ChannelCostsPage() {
  await requireAuth();
  return <ChannelCostsClient />;
}
