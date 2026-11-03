import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
export const forwardStepDomainSpec = defineDomain({
    name: 'forward_step_dsh_tasks',
    version: 1,
    layout: 'single',
    tables: { state: domainTable(z.object({
            schemaVersion: z.number().int(),
            revision: z.number().int(),
            projects: z.array(z.unknown()),
            tasks: z.array(z.unknown()),
            bindings: z.array(z.unknown()),
            memories: z.array(z.unknown()),
            changes: z.array(z.unknown()),
            suppressions: z.array(z.unknown()),
            sources: z.array(z.unknown()),
            learning: z.unknown(),
            processedEvents: z.array(z.string()),
        })) },
});
