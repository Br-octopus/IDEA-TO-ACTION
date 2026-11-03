import type { TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol';
import { type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { ProbeInput, ProbeOutput, ProbeWaitInput, ProbeStorageOutput, ProbeAgentIsolationOutput, ListTasksInput, ListTasksOutput, CreateTaskInput, CreateTaskOutput, BindTaskInput, BindTaskOutput, GetCurrentBindingInput, GetCurrentBindingOutput, ListProvidersOutput, ListModelsInput, ListModelsOutput, RunTaskInput, RunTaskOutput, CancelTaskInput, CancelTaskOutput, UpdateTaskInput, UpdateTaskOutput, ArchiveTaskInput, ArchiveTaskOutput, PreviewDeleteTaskInput, PreviewDeleteTaskOutput, DeleteTaskInput, DeleteTaskOutput, SaveExternalResultInput, SaveExternalResultOutput, RealModelIsolationInput, RealModelIsolationOutput } from './types.js';
type AgentMessage = {
    readonly id: string;
    readonly role: 'user';
    readonly content: readonly {
        readonly type: 'text';
        readonly text: string;
    }[];
    readonly source: {
        readonly kind: 'user';
    };
};
type ProbeAgentHandle = {
    readonly agent: {
        readonly session: {
            readonly id: string;
            snapshotEvents(): readonly {
                readonly type: string;
                readonly data?: any;
            }[];
        };
        readonly options?: {
            readonly provider?: string;
            readonly model?: string;
        };
        readonly status?: string;
        readonly inbox?: {
            readonly nextTurn: readonly unknown[];
            readonly nextStep?: readonly unknown[];
        };
        readonly ctx?: {
            on(name: string, listener: (payload: any, next: () => Promise<unknown>) => unknown): unknown;
        };
        followup(message: AgentMessage): void;
        whenIdle(): Promise<void>;
        cancel(cause: {
            readonly kind: 'user';
        } | {
            readonly kind: 'disposed';
        }): void;
    };
    dispose(): Promise<void>;
};
type AgentRegistry = {
    create(options: {
        readonly sessionId: string;
        readonly meta?: {
            readonly cwd?: string;
        };
        readonly agentOptions: {
            readonly provider: string;
            readonly model: string;
            readonly maxTokens: number;
        };
        readonly signal?: AbortSignal;
        readonly setup?: (agentContext: {
            readonly tools: {
                restrict(filter: {
                    readonly allow: readonly string[];
                }): () => void;
            };
        }) => void;
    }): Promise<ProbeAgentHandle>;
};
type AdapterRequest = {
    readonly sessionId?: string;
    readonly purpose?: 'compaction' | 'session-title';
    readonly messages: readonly {
        readonly content?: readonly {
            readonly type?: string;
            readonly text?: string;
        }[];
    }[];
    readonly signal?: AbortSignal;
};
type ObservedLlmRequest = {
    readonly sessionId?: string;
    readonly purpose?: 'compaction' | 'session-title';
    readonly provider?: string;
    readonly model?: string;
    readonly messages: readonly {
        readonly role?: string;
        readonly content?: string | readonly {
            readonly type?: string;
            readonly text?: string;
        }[];
    }[];
};
type CaptureAdapter = {
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    providerRetryPolicy(): undefined;
    imageRequestPricing(): undefined;
    listModels(provider: string): Promise<readonly {
        provider: string;
        id: string;
        name: string;
    }[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<{
        provider: string;
        id: string;
        name: string;
    }>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
        model: {
            provider: string;
            id: string;
            name: string;
        };
        stream(options: AdapterRequest): AsyncIterable<unknown>;
    }>;
    stream(options: AdapterRequest): AsyncIterable<unknown>;
};
type LlmRuntime = {
    stream(options: any): AsyncIterable<any>;
    listProviders(): {
        id: string;
        name?: string;
    }[];
    listModels(provider: string): Promise<readonly {
        provider: string;
        id: string;
        name?: string;
    }[]>;
    registerAdapter(providers: string[], adapter: CaptureAdapter): () => void;
};
/** 仅用于阶段一验证 Host/Client RPC、取消、宿主持久化与 Agent/Session 隔离。 */
export declare class ForwardStepProbe {
    private readonly storageDomain;
    private readonly agents?;
    private readonly llm?;
    readonly typertRemote: TypertGatewayBinding<ForwardStepProbe>;
    private domainPromise?;
    private readonly activeWaits;
    private readonly activeIsolationRuns;
    private disposed;
    private disposePromise?;
    private taskStorePromise?;
    private taskStore?;
    private readonly activeTaskRuns;
    private readonly activeStorageWrites;
    private activeRealModelAudit?;
    constructor(storageDomain: Pick<DomainFacility, 'open'>, agents?: AgentRegistry | undefined, llm?: LlmRuntime | undefined);
    private assertActive;
    private openTaskStore;
    private generate;
    listProviders(): ListProvidersOutput;
    listModels(input: ListModelsInput): Promise<ListModelsOutput>;
    listTasks(input: ListTasksInput): Promise<ListTasksOutput>;
    createTask(input: CreateTaskInput): Promise<CreateTaskOutput>;
    private assertCurrentTask;
    updateTask(input: UpdateTaskInput): Promise<UpdateTaskOutput>;
    archiveTask(input: ArchiveTaskInput): Promise<ArchiveTaskOutput>;
    previewDeleteTask(input: PreviewDeleteTaskInput): Promise<PreviewDeleteTaskOutput>;
    deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput>;
    saveExternalResult(input: SaveExternalResultInput): Promise<SaveExternalResultOutput>;
    bindTask(input: BindTaskInput): Promise<BindTaskOutput>;
    getCurrentBinding(input: GetCurrentBindingInput): Promise<GetCurrentBindingOutput>;
    runTask(input: RunTaskInput, signal: AbortSignal): Promise<RunTaskOutput>;
    cancelTask(input: CancelTaskInput): CancelTaskOutput;
    private openDomain;
    echo(input: ProbeInput): ProbeOutput;
    wait(input: ProbeWaitInput, signal: AbortSignal): Promise<ProbeOutput>;
    storageWrite(input: ProbeInput): Promise<ProbeStorageOutput>;
    storageRead(): Promise<ProbeStorageOutput>;
    /** Capture metadata only while the isolated real-model probe is running. */
    captureRealModelRequest(options: ObservedLlmRequest): void;
    realModelIsolation(input: RealModelIsolationInput, signal: AbortSignal): Promise<RealModelIsolationOutput>;
    agentIsolation(signal: AbortSignal): Promise<ProbeAgentIsolationOutput>;
    dispose(): Promise<void>;
    private disposeResources;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        forwardStepProbe: ForwardStepProbe;
    }
}
export {};
