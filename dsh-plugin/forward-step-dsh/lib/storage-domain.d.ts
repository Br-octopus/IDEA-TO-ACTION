export declare const forwardStepDomainSpec: {
    name: string;
    version: number;
    layout: "single";
    tables: {
        state: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            schemaVersion: number;
            revision: number;
            projects: unknown[];
            tasks: unknown[];
            bindings: unknown[];
            memories: unknown[];
            changes: unknown[];
            suppressions: unknown[];
            sources: unknown[];
            learning: unknown;
            processedEvents: string[];
        }>;
    };
};
