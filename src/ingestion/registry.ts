import type { SourceDefinition } from './types';
import { netsuiteSpend } from './sources/netsuiteSpend';
import { salesforceLeads } from './sources/salesforceLeads';

export function getSources(): SourceDefinition[] {
  return [netsuiteSpend, salesforceLeads] as SourceDefinition[];
}
