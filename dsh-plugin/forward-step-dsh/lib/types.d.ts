export interface ProbeInput {
    readonly marker: string;
}
export interface ProbeOutput {
    readonly marker: string;
    readonly observed: boolean;
}
export interface ProbeStorageOutput {
    readonly marker: string;
    readonly stored: boolean;
}
export interface ProbeWaitInput {
    readonly marker: string;
    readonly milliseconds: number;
}
export interface RealModelIsolationInput {
    readonly provider: string;
    readonly model: string;
}
export interface RealModelIsolationRequest {
    readonly purpose?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly messageCount: number;
    readonly roles: readonly string[];
    readonly textBytes: number;
    readonly messageDigest: string;
    readonly containsTaskA: boolean;
    readonly containsTaskB: boolean;
}
export interface RealModelIsolationOutput {
    readonly passed: boolean;
    readonly reason: string;
    readonly requests: readonly RealModelIsolationRequest[];
    readonly taskRequestCount: number;
    readonly auxiliaryRequestCount: number;
    readonly sessionsDistinct: boolean;
    readonly requestAIsolated: boolean;
    readonly requestBIsolated: boolean;
    readonly agentsDisposed: boolean;
    readonly turnEndReasons?: readonly string[];
    readonly agentStatuses?: readonly string[];
}
export interface ProbeAgentIsolationOutput {
    readonly passed: boolean;
    readonly diagnosticStage: string;
    readonly diagnosticErrorName: string;
    readonly diagnosticErrorCode: string;
    readonly diagnosticErrorMessage: string;
    readonly cleanupErrors: readonly string[];
    readonly adapterRequests: number;
    readonly taskRequests: number;
    readonly auxiliaryRequests: number;
    readonly auxiliaryRequestsIsolated: boolean;
    readonly sessionsDistinct: boolean;
    readonly requestAUsesSessionA: boolean;
    readonly requestBUsesSessionB: boolean;
    readonly requestAContainsTaskA: boolean;
    readonly requestAContainsTaskB: boolean;
    readonly requestBContainsTaskA: boolean;
    readonly requestBContainsTaskB: boolean;
    readonly agentsDisposed: boolean;
    readonly adapterReleased: boolean;
    readonly requestedOptionsMatched: readonly boolean[];
    readonly agentStatusesAfterFollowup: readonly string[];
    readonly agentStatusesAfterIdle: readonly string[];
    readonly pendingFollowupsAfterFollowup: readonly number[];
    readonly pendingFollowupsAfterIdle: readonly number[];
    readonly pendingNextStepsAfterFollowup: readonly number[];
    readonly pendingNextStepsAfterIdle: readonly number[];
    readonly requestErrorCodes: readonly string[];
    readonly sessionEventKinds: readonly string[];
    readonly turnStoppingEvents: readonly string[];
    readonly turnEndReasonKinds: readonly string[];
    readonly turnEndErrorCodes: readonly string[];
    readonly turnEndErrorMessages: readonly string[];
}
export interface StoredProject {
    projectId: string;
    cwd: string;
    label: string;
    createdAt: string;
    updatedAt: string;
}
export interface StoredBinding {
    projectId: string;
    taskId: string;
    conversationId: string;
    eventId: string;
    createdAt: string;
}
export interface StoredVersion {
    versionId: string;
    requestId: string;
    eventId?: string;
    kind?: 'agent-output' | 'external-result';
    stage: string;
    stepId?: string;
    promptVersionId?: string;
    content: string;
    feedback?: string;
    createdAt: string;
    usedMemories: {
        memoryId: string;
        revision: number;
    }[];
    usedSources: string[];
    omissions: {
        kind: string;
        id: string;
        reason: string;
    }[];
}
export interface StoredTask {
    projectId: string;
    taskId: string;
    revision: number;
    title: string;
    entryType: string;
    domain: string;
    archived: boolean;
    originalInput: string;
    currentRequirements: string[];
    materials: {
        [key: string]: string;
    }[];
    methodState: {
        [key: string]: string;
    };
    versions: StoredVersion[];
    reviews: {
        [key: string]: string;
    }[];
    conversations: string[];
    createdAt: string;
    updatedAt: string;
    agent: {
        id: string;
        type: string;
        goal: string;
        steps?: {
            id: string;
            title: string;
            status?: string;
        }[];
        currentStepId?: string;
    };
}
export interface TaskRecord {
    projectId: string;
    taskId: string;
    conversationId: string;
    eventId: string;
    createdAt: string;
    revision: number;
    title: string;
    entryType: string;
    domain: string;
    archived: boolean;
    originalInput: string;
    currentRequirements: string[];
    materials: {
        [key: string]: string;
    }[];
    methodState: {
        [key: string]: string;
    };
    versions: StoredVersion[];
    reviews: {
        [key: string]: string;
    }[];
    conversations: string[];
    agent: {
        id: string;
        type: string;
        goal: string;
        steps?: {
            id: string;
            title: string;
            status?: string;
        }[];
        currentStepId?: string;
    };
}
export interface ListTasksInput {
    cwd: string;
    archived?: boolean;
}
export interface ListTasksOutput {
    projectId: string;
    revision: number;
    tasks: StoredTask[];
}
export interface CreateTaskInput {
    cwd: string;
    title?: string;
    entryType: string;
    domain: string;
    originalInput: string;
    conversationId: string;
    eventId: string;
}
export interface CreateTaskOutput {
    task: StoredTask;
    revision: number;
}
export interface TaskScopeContext {
    projectId: string;
    taskId: string;
    taskRevision: number;
    conversationId: string;
}
export interface TaskMutationContext extends TaskScopeContext {
    eventId: string;
}
export interface UpdateTaskInput extends TaskMutationContext {
    patch: {
        title?: string;
    };
}
export interface UpdateTaskOutput {
    task: StoredTask;
    revision: number;
}
export interface ArchiveTaskInput extends TaskMutationContext {
    archived: boolean;
}
export interface ArchiveTaskOutput {
    task: StoredTask;
    revision: number;
}
export interface PreviewDeleteTaskInput extends TaskScopeContext {
    clearLearned?: boolean;
}
export interface PreviewDeleteTaskOutput {
    impact: {
        taskId: string;
        title: string;
        bindingCount: number;
        versionCount: number;
        reviewCount: number;
        memoryCount: number;
        sourceCount: number;
    };
}
export interface DeleteTaskInput extends TaskMutationContext {
    confirmed: boolean;
    clearLearned?: boolean;
}
export interface DeleteTaskOutput {
    deleted: boolean;
    taskId: string;
    revision: number;
}
export interface SaveExternalResultInput extends TaskMutationContext {
    stepId: string;
    promptVersionId: string;
    content: string;
    feedback?: string;
}
export interface SaveExternalResultOutput {
    task: StoredTask;
    version: StoredVersion;
    revision: number;
}
export interface BindTaskInput {
    projectId: string;
    taskId: string;
    conversationId: string;
    eventId: string;
}
export interface BindTaskOutput {
    binding: StoredBinding;
    revision: number;
}
export interface GetCurrentBindingInput {
    projectId: string;
    conversationId: string;
}
export interface GetCurrentBindingOutput {
    binding: StoredBinding | null;
}
export interface ListProvidersOutput {
    providers: {
        id: string;
        name: string;
    }[];
}
export interface ListModelsInput {
    provider: string;
}
export interface ListModelsOutput {
    models: {
        provider: string;
        id: string;
        name: string;
    }[];
}
export interface RunTaskInput {
    taskId: string;
    taskRevision: number;
    stage: string;
    requestId: string;
    projectId: string;
    conversationId: string;
    provider: string;
    model: string;
}
export interface RunTaskOutput {
    requestId: string;
    duplicate: boolean;
    task: StoredTask;
    version: TaskRecord | null;
}
export interface CancelTaskInput {
    requestId: string;
}
export interface CancelTaskOutput {
    cancelled: boolean;
}
