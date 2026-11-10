export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = {
    [key: string]: JsonValue;
};
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
export interface RealModelIsolationResponse {
    readonly label: 'A' | 'B';
    readonly textReturned: boolean;
    readonly textCharacters: number;
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
    readonly assistantResponses?: readonly RealModelIsolationResponse[];
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
    taskId?: string;
    requestId: string;
    eventId?: string;
    kind?: 'prompt' | 'agent-output' | 'external-result';
    stage: string;
    stepId?: string;
    parentVersionId?: string;
    promptVersionId?: string;
    source?: 'user-pasted';
    content: string;
    feedback?: string;
    stale?: boolean;
    staleReason?: string;
    memoryRevisionChanged?: boolean;
    model?: string;
    taskRevision?: number;
    sentMessages?: {
        count: number;
        roles: string[];
        textBytes: number;
        digest: string;
    };
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
export interface StoredReview {
    reviewId: string;
    resultVersionId: string;
    promptVersionId: string;
    stepId: string;
    verdict: 'success' | 'failure' | 'unverified';
    checks: {
        requirement: string;
        result: 'pass' | 'fail' | 'not-checked';
        note?: string;
    }[];
    feedback: string;
    confirmed: boolean;
    requirementsSnapshot: string[];
    createdAt: string;
}
export interface TaskMaterial {
    id?: string;
    sourceId?: string;
    sourceArticleId?: string;
    title?: string;
    kind?: string;
    sourceType?: string;
    purpose?: string;
    excerpt?: string;
    text?: string;
    note?: string;
    url?: string;
    selected?: boolean;
    verificationStatus?: string;
    contentStatus?: 'parsed' | 'failed';
    contentError?: string;
    extractedCharacterCount?: number;
    pageCount?: number;
    sourceLocator?: string;
    extractionMethod?: string;
    truncated?: boolean;
    extractionWarnings?: string[];
    recognitionConfidence?: number;
}
export interface MethodStageState {
    requestId: string;
    prompt: string;
    updatedAt: string;
}
export interface WritingMethodState {
    article?: {
        id?: string;
        goal?: string;
        audience?: string;
        platform?: string;
        genre?: string;
        constraints?: string;
        preserveItems?: string[];
    };
    roundHistory?: {
        id?: string;
        parentRoundId?: string;
        taskType?: string;
        draft?: string;
        feedback?: string;
        packSelections?: string[];
        packSnapshot?: {
            packs?: {
                id: string;
                name?: string;
                version: number;
            }[];
            selectedIds?: string[];
        };
    }[];
    round?: {
        id?: string;
        draft?: string;
        feedback?: string;
        taskType?: string;
        packSelections?: string[];
        packSnapshot?: {
            packs?: {
                id: string;
                name?: string;
                version: number;
            }[];
            entries?: {
                packId: string;
                text: string;
            }[];
            skipped?: {
                id: string;
                reason: string;
            }[];
            selectedIds?: string[];
        };
        externalResultVersionId?: string;
    };
    styleProfile?: {
        scope?: string;
        traits?: string[];
        samples?: {
            sourceArticleId: string;
            excerpt: string;
        }[];
    } | null;
    materialIds?: string[];
    roundNumber?: number;
}
export interface PptVisualFeedback {
    id: string;
    pageIndex: number;
    target?: {
        kind: 'point';
        x: number;
        y: number;
        imageIndex?: number;
    };
    category: 'content' | 'logic' | 'evidence' | 'style' | 'layout' | 'readability' | 'other';
    comment: string;
    contentSnapshot: string;
    selected: boolean;
    createdAt: string;
}
export interface PptSlideStyle {
    backgroundColor?: string;
    title?: {
        color?: string;
        fontSize?: number;
        bold?: boolean;
        italic?: boolean;
        align?: 'left' | 'center' | 'right' | 'justify';
    };
    body?: {
        color?: string;
        fontSize?: number;
        bold?: boolean;
        italic?: boolean;
        align?: 'left' | 'center' | 'right' | 'justify';
    };
}
export interface PptSlideState {
    title?: string;
    content?: string;
    body?: string | string[];
    visualDescription?: string;
    modelVisualDescription?: string;
    sourceImageName?: string;
    sourceDocumentName?: string;
    imageDataUrl?: string;
    imageDataUrls?: string[];
    table?: JsonObject;
    chart?: JsonObject;
    style?: PptSlideStyle;
}
export interface PptMethodState {
    stage?: 'brief' | 'outline' | 'slides' | 'route-prompt' | 'visual-feedback';
    route?: string;
    brief?: {
        idea?: string;
        audience?: string;
        audienceAction?: string;
        durationMinutes?: number;
        constraints?: {
            minSlides?: number;
            maxSlides?: number;
        };
        hardRequirements?: string[];
        preserveItems?: string[];
        excludeItems?: string[];
        facts?: string[];
        assumptions?: string[];
        materials?: TaskMaterial[];
    };
    outline?: {
        title?: string;
        status?: 'draft' | 'approved' | 'needs-revision' | 'needs-review';
        slides?: PptSlideState[];
    };
    visualFeedback?: PptVisualFeedback[];
}
export interface TaskMethodState {
    clarification?: MethodStageState;
    diagnosis?: MethodStageState;
    planning?: MethodStageState;
    'step-prompt'?: MethodStageState;
    review?: MethodStageState;
    writing?: WritingMethodState;
    ppt?: PptMethodState;
    currentOverrides?: {
        key: 'verbosity' | 'tone' | 'language' | 'slideDensity';
        value: string;
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
    materials: TaskMaterial[];
    methodState: TaskMethodState;
    versions: StoredVersion[];
    reviews: StoredReview[];
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
        research?: {
            status: string;
            decision: string;
            scope: {
                objective: string;
                queries: string[];
                sourceTypes: string[];
            };
            budget: {
                maxQueries: number;
                maxSources: number;
            };
            results: {
                url: string;
                title: string;
                summary: string;
            }[];
            message?: string;
            createdAt?: string;
            approvedAt?: string;
            rejectedAt?: string;
        };
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
    materials: TaskMaterial[];
    methodState: TaskMethodState;
    versions: StoredVersion[];
    reviews: StoredReview[];
    conversations: string[];
    agent: StoredTask['agent'];
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
        agent?: StoredTask["agent"];
        currentRequirements?: string[];
        methodState?: StoredTask["methodState"];
        materials?: StoredTask["materials"];
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
        clearLearned: boolean;
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
export interface SaveReviewInput extends TaskMutationContext {
    resultVersionId: string;
    promptVersionId: string;
    verdict: 'success' | 'failure' | 'unverified';
    checks: {
        requirement: string;
        result: 'pass' | 'fail' | 'not-checked';
        note?: string;
    }[];
    feedback?: string;
    confirmed: boolean;
}
export interface SaveReviewOutput {
    task: StoredTask;
    review: StoredReview;
    revision: number;
}
export interface SavePromptRevisionInput extends TaskMutationContext {
    stepId: string;
    sourceVersionId: string;
    content: string;
}
export interface SavePromptRevisionOutput {
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
    includeKnowledge?: boolean;
    expectedKnowledgeDigest?: string;
}
export interface UnderstandPptPageInput {
    projectId: string;
    taskId: string;
    taskRevision: number;
    conversationId: string;
    pageIndex: number;
    imageIndex?: number;
    imageIndices?: number[];
    provider: string;
    model: string;
}
export interface UnderstandPptPageOutput {
    visualDescription: string;
}
export interface RunTaskOutput {
    requestId: string;
    duplicate: boolean;
    saved: boolean;
    task: StoredTask;
    version?: StoredVersion;
    unsavedDraft?: {
        content: string;
        stage: string;
        errorCode: 'storage_failure';
    };
}
export interface CancelTaskInput {
    requestId: string;
}
export interface CancelTaskOutput {
    cancelled: boolean;
}
export type MemoryScope = 'global' | 'domain' | 'project' | 'task' | 'conversation';
export type MemoryStatus = 'active' | 'candidate' | 'disabled';
export interface MemorySnapshot {
    key?: string;
    value?: string;
    scope?: MemoryScope;
    domains?: string[];
    status?: MemoryStatus;
    sourceRefs?: string[];
    manualScope?: boolean;
    reason?: string;
}
export interface MemoryViewRecord {
    memoryId: string;
    revision: number;
    key: string;
    value: string;
    scope: MemoryScope;
    domains: string[];
    projectId: string;
    taskId: string;
    conversationId: string;
    status: MemoryStatus;
    sourceRefs: string[];
    reason: string;
    manualScope: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface MemorySourceView {
    sourceId: string;
    projectId: string;
    taskId: string;
    conversationId: string;
    locator: string;
    kind: string;
    excerpt: string;
    digest: string;
    active: boolean;
    userAuthored: boolean;
    taskRemoved?: boolean;
}
export interface MemoryChangeView {
    eventId: string;
    memoryId: string;
    reason: string;
    changedFields: string[];
    before: MemorySnapshot | null;
    after: MemorySnapshot | null;
    createdAt: string;
    undoOf?: string;
    auditRedacted?: boolean;
}
export interface LearningJobView {
    jobId: string;
    taskId: string;
    projectId: string;
    conversationId: string;
    sourceRefs: string[];
    status: 'queued' | 'running' | 'failed' | 'completed' | 'paused' | 'cancelled';
    attempts: number;
    createdAt: string;
    completedAt?: string;
    errorCode?: string;
    summary?: string;
}
export interface ProfileViewRecord {
    key: string;
    value: string;
    scope: MemoryScope;
    domains: string[];
    memories: {
        memoryId: string;
        revision: number;
    }[];
    sourceRefs: string[];
}
export interface UsedMemoryView {
    versionId: string;
    stage: string;
    createdAt: string;
    usedMemories: {
        memoryId: string;
        revision: number;
    }[];
}
export interface MemoryViewInput extends TaskScopeContext {
    crossTask?: boolean;
}
export interface MemoryViewOutput {
    taskId: string;
    revision: number;
    crossTask: boolean;
    visibleMemoryIds: string[];
    crossTaskMemoryIds: string[];
    currentTaskJobIds: string[];
    visibleJobIds: string[];
    memories: MemoryViewRecord[];
    changes: MemoryChangeView[];
    sources: MemorySourceView[];
    jobs: LearningJobView[];
    profile: ProfileViewRecord[];
    usedMemories: UsedMemoryView[];
    learningPaused: boolean;
}
export interface MemoryMutationContext extends TaskMutationContext {
    memoryId: string;
    memoryRevision: number;
}
export interface EditMemoryInput extends MemoryMutationContext {
    patch: {
        value?: string;
        scope?: MemoryScope;
        domains?: string[];
    };
}
export interface SetMemoryStatusInput extends MemoryMutationContext {
    status: 'active' | 'disabled';
}
export interface UndoMemoryInput extends MemoryMutationContext {
    changeEventId: string;
    resolve?: Record<string, 'keep' | 'restore'>;
}
export interface DeleteMemoryInput extends MemoryMutationContext {
    confirmed: boolean;
}
export interface InvalidateMemorySourceInput extends TaskMutationContext {
    sourceId: string;
    confirmed: boolean;
}
export interface SetLearningPausedInput extends TaskMutationContext {
    paused: boolean;
}
export interface RetryLearningInput extends TaskMutationContext {
    jobId: string;
}
export type MemoryConflictValue = string | boolean | string[] | null;
export interface MemoryConflict {
    field: string;
    current?: MemoryConflictValue;
    before?: MemoryConflictValue;
    after?: MemoryConflictValue;
}
export interface MemoryMutationOutput {
    memory?: MemoryViewRecord;
    change?: MemoryChangeView;
    source?: MemorySourceView;
    memories?: MemoryViewRecord[];
    conflicts?: MemoryConflict[];
    needsResolution?: boolean;
    idempotent?: boolean;
    deleted?: boolean;
    paused?: boolean;
    jobs?: LearningJobView[];
    job?: LearningJobView;
    revision: number;
}
export interface LearningControlOutput {
    paused: boolean;
    jobs: LearningJobView[];
    revision: number;
}
