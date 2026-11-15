import type { TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol';
import { type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { ProbeInput, ProbeOutput, ProbeWaitInput, ProbeStorageOutput, ProbeAgentIsolationOutput, ListTasksInput, ListTasksOutput, CreateTaskInput, CreateTaskOutput, BindTaskInput, BindTaskOutput, GetCurrentBindingInput, GetCurrentBindingOutput, ListProvidersOutput, ListModelsInput, ListModelsOutput, RunTaskInput, RunTaskOutput, UnderstandPptPageInput, UnderstandPptPageOutput, CancelTaskInput, CancelTaskOutput, UpdateTaskInput, UpdateTaskOutput, ArchiveTaskInput, ArchiveTaskOutput, PreviewDeleteTaskInput, PreviewDeleteTaskOutput, DeleteTaskInput, DeleteTaskOutput, SaveExternalResultInput, SaveExternalResultOutput, SaveReviewInput, SaveReviewOutput, SavePromptRevisionInput, SavePromptRevisionOutput, RealModelIsolationInput, RealModelIsolationOutput, MemoryViewInput, MemoryViewOutput, EditMemoryInput, SetMemoryStatusInput, UndoMemoryInput, DeleteMemoryInput, InvalidateMemorySourceInput, SetLearningPausedInput, RetryLearningInput, MemoryMutationOutput, LearningControlOutput, JsonObject, JsonValue } from './types.js';
type PptWebRuntime = {
    search(request: {
        query: string;
        maxResults: number;
    }, signal?: AbortSignal): Promise<{
        sources: readonly {
            url: string;
            title?: string;
            snippet?: string;
            publishedAt?: string;
        }[];
        truncated: boolean;
    }>;
    fetch(request: {
        url: string;
    }, signal?: AbortSignal): Promise<{
        url: string;
        statusCode: number;
        body: {
            kind: 'html' | 'text';
            content: string;
        };
        truncated: boolean;
    }>;
};
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
    private readonly attachments?;
    private readonly web?;
    private readonly socialResearch?;
    readonly typertRemote: TypertGatewayBinding<ForwardStepProbe>;
    private domainPromise?;
    private readonly activeWaits;
    private readonly activeIsolationRuns;
    private disposed;
    private disposePromise?;
    private taskStorePromise?;
    private taskStore?;
    private learningService?;
    private learningModel?;
    private readonly activeTaskRuns;
    private readonly activeStorageWrites;
    private readonly activeBackgroundTasks;
    private readonly activeSocialPlatformRuns;
    private readonly activeSocialPublicSources;
    private readonly activeResearchSearches;
    private activeRealModelAudit?;
    private readonly archiveUploads;
    private readonly pluginBackupExports;
    private readonly pluginBackupUploads;
    private readonly writingMaterialUploads;
    private readonly socialAttachmentUploads;
    private readonly socialAttachmentRecoveries;
    private readonly socialAttachmentDownloads;
    private socialAttachmentDownloadsStarting;
    private readonly verifiedPptWebCapabilities;
    constructor(storageDomain: Pick<DomainFacility, 'open'>, agents?: AgentRegistry | undefined, llm?: LlmRuntime | undefined, attachments?: any | undefined, web?: PptWebRuntime | undefined, socialResearch?: any | undefined);
    private assertActive;
    private trackStorageWrite;
    private openTaskStore;
    private initializeLearningService;
    private assignLearningModel;
    private scheduleLearning;
    private generate;
    getPluginPreferences(): Promise<{
        preferences: {
            defaultEntryType: string;
            defaultDomain: string;
            preferredProvider: string;
            preferredModel: string;
        };
    }>;
    savePluginPreferences(input: {
        defaultEntryType: string;
        defaultDomain: string;
        preferredProvider: string;
        preferredModel: string;
    }): Promise<{
        preferences: {
            defaultEntryType: string;
            defaultDomain: string;
            preferredProvider: string;
            preferredModel: string;
        };
        revision: number;
    }>;
    getPluginServiceConfig(): Promise<{
        serviceConfig: {
            searchEndpoint: string;
            auxiliaryWritingEndpoint: string;
            auxiliaryWritingModel: string;
        };
    }>;
    savePluginServiceConfig(input: {
        searchEndpoint: string;
        auxiliaryWritingEndpoint: string;
        auxiliaryWritingModel: string;
    }): Promise<{
        serviceConfig: {
            searchEndpoint: string;
            auxiliaryWritingEndpoint: string;
            auxiliaryWritingModel: string;
        };
        revision: number;
    }>;
    runAuxiliaryWriting(input: {
        prompt: string;
        confirmed: boolean;
    }, signal: AbortSignal): Promise<{
        text: string;
        model: string;
    }>;
    testPluginServiceEndpoint(input: {
        service: 'search' | 'auxiliary-writing';
        confirmed: boolean;
    }, signal: AbortSignal): Promise<{
        service: string;
        reachable: boolean;
        statusCode: number;
        checkedAt: string;
    }>;
    getHostCapabilities(): {
        capabilities: {
            id: string;
            label: string;
            status: 'available' | 'unavailable';
            detail: string;
        }[];
    };
    listProviders(): ListProvidersOutput;
    listModels(input: ListModelsInput): Promise<ListModelsOutput>;
    listTasks(input: ListTasksInput): Promise<ListTasksOutput>;
    listAcademicWorkspaces(): Promise<JsonObject>;
    createAcademicWorkspace(input: {
        kind: 'review' | 'publishing';
        title: string;
        question?: string;
        scope?: string;
        reviewType?: string;
        screeningModel?: 'single-reviewer' | 'two-reviewers';
        venue?: string;
    }): Promise<JsonObject>;
    saveAcademicWorkspace(input: {
        project: JsonObject;
    }): Promise<JsonObject>;
    previewAcademicBibliography(input: {
        text: string;
        format: string;
    }): Promise<JsonObject>;
    importAcademicBibliography(input: {
        entries: JsonValue[];
    }): Promise<JsonObject>;
    applyAcademicWorkspaceAction(input: {
        projectId: string;
        action: string;
        args: JsonValue[];
    }): Promise<JsonObject>;
    buildAcademicPrompt(input: {
        projectId: string;
        kind: string;
        ids: string[];
    }): Promise<JsonObject>;
    beginSocialResearchAttachmentDownload(input: {
        taskId: string;
        attachmentId: string;
    }): Promise<JsonObject>;
    readSocialResearchAttachmentChunk(input: {
        downloadId: string;
        taskId: string;
        offset: number;
    }, signal?: AbortSignal): Promise<JsonObject>;
    finishSocialResearchAttachmentDownload(input: {
        downloadId: string;
    }): Promise<JsonObject>;
    private cleanupSocialAttachmentDownload;
    listSocialResearchTasks(): Promise<JsonObject>;
    searchPptSources(input: {
        projectId: string;
        taskId: string;
        conversationId: string;
        query: string;
        confirmed: boolean;
        probe?: boolean;
    }, signal: AbortSignal): Promise<JsonObject>;
    fetchPptSource(input: {
        projectId: string;
        taskId: string;
        conversationId: string;
        url: string;
        confirmed: boolean;
        probe?: boolean;
    }, signal: AbortSignal): Promise<JsonObject>;
    listSocialPlatformAvailability(): Promise<JsonObject>;
    private readSocialPlatformState;
    createSocialResearchPlan(input: {
        topic: string;
        platforms: string[];
        queries: string[];
        budget?: JsonObject;
    }): Promise<JsonObject>;
    runAuthorizedSocialResearch(input: {
        taskId: string;
        confirmed: boolean;
        platforms?: string[];
    }, signal: AbortSignal): Promise<JsonObject>;
    confirmSocialResearchPlan(input: {
        taskId: string;
    }): Promise<JsonObject>;
    searchSocialPublicSources(input: {
        taskId: string;
        platform: string;
        query: string;
        confirmed: boolean;
    }, signal: AbortSignal): Promise<JsonObject>;
    searchConfirmedSocialPublicPlan(input: {
        taskId: string;
        confirmed: boolean;
    }, signal: AbortSignal): Promise<JsonObject>;
    fetchSocialPublicSource(input: {
        taskId: string;
        platform: string;
        sourceUrl: string;
        confirmed: boolean;
    }, signal: AbortSignal): Promise<JsonObject>;
    rejectSocialResearchPlan(input: {
        taskId: string;
        reason?: string;
    }): Promise<JsonObject>;
    applySocialResearchTaskAction(input: {
        taskId: string;
        action: 'pause' | 'resume' | 'cancel' | 'skip-platform';
        platform?: string;
    }): Promise<JsonObject>;
    saveSocialResearchResult(input: {
        taskId: string;
        result: JsonObject;
    }): Promise<JsonObject>;
    removeSocialResearchResult(input: {
        taskId: string;
        resultId: string;
    }): Promise<JsonObject>;
    removeSocialResearchAttachment(input: {
        taskId: string;
        attachmentId: string;
    }): Promise<JsonObject>;
    beginSocialAttachmentUpload(input: {
        taskId: string;
        resultId: string;
        name: string;
        mimeType: string;
        size: number;
    }): Promise<JsonObject>;
    appendSocialAttachmentChunk(input: {
        uploadId: string;
        index: number;
        dataBase64: string;
    }): Promise<JsonObject>;
    commitSocialAttachmentUpload(input: {
        uploadId: string;
    }): Promise<JsonObject>;
    private commitSocialAttachmentUploadInternal;
    private recoverPendingSocialAttachments;
    private recoverSocialAttachment;
    cancelSocialAttachmentUpload(input: {
        uploadId: string;
    }): Promise<JsonObject>;
    private prepareSocialResearchReport;
    buildSocialResearchReportPrompt(input: {
        taskId: string;
        resultIds: string[];
    }): Promise<JsonObject>;
    generateSocialResearchReport(input: {
        taskId: string;
        resultIds: string[];
        provider: string;
        model: string;
    }, signal: AbortSignal): Promise<JsonObject>;
    saveSocialResearchReportPrompt(input: {
        taskId: string;
        parentRunId: string;
        prompt: string;
    }): Promise<JsonObject>;
    listMethodCards(): Promise<JsonObject>;
    saveMethodCard(input: {
        card: JsonObject;
        eventId: string;
    }): Promise<JsonObject>;
    deleteMethodCard(input: {
        cardId: string;
        eventId: string;
    }): Promise<JsonObject>;
    listPromptAssets(input: {
        query?: string;
        includeArchived?: boolean;
    }): Promise<JsonObject>;
    listWritingPacks(): Promise<JsonObject>;
    compareWritingPackVersions(input: {
        packId: string;
        leftVersion: number;
        rightVersion: number;
    }): Promise<JsonObject>;
    listWritingGenres(): Promise<JsonObject>;
    listWritingWorkspaces(input: {
        projectId?: string;
        taskId?: string;
    }): Promise<JsonObject>;
    createWritingWorkspace(input: {
        genre: string;
        title: string;
        goal: string;
        projectId?: string;
        taskId?: string;
        domainInputs?: JsonObject;
    }): Promise<JsonObject>;
    saveWritingWorkspace(input: {
        workspace: JsonObject;
    }): Promise<JsonObject>;
    appendWritingRound(input: {
        articleId: string;
        round: JsonObject;
    }): Promise<JsonObject>;
    setWritingRoundReview(input: {
        articleId: string;
        roundId: string;
        status: string;
        note?: string;
    }): Promise<JsonObject>;
    restoreWritingRound(input: {
        articleId: string;
        roundId: string;
    }): Promise<JsonObject>;
    compareWritingRounds(input: {
        articleId: string;
        leftRoundId: string;
        rightRoundId: string;
    }): Promise<JsonObject>;
    getWritingMaterialCoverage(input: {
        articleId: string;
    }): Promise<JsonObject>;
    initializeWritingMaterialCoverage(input: {
        articleId: string;
        genre: string;
        goal?: string;
        items: JsonObject[];
    }): Promise<JsonObject>;
    applyWritingMaterialCoverageAction(input: {
        articleId: string;
        action: string;
        batchSize?: number;
        promptVersionId?: string;
        batchId?: string;
        itemId?: string;
        kind?: string;
        resultSummary?: string;
        reason?: string;
        evidence?: string;
    }): Promise<JsonObject>;
    previewWritingPackSnapshot(input: {
        genre: string;
        taskType?: string;
        selectedIds: string[];
    }): Promise<JsonObject>;
    saveWritingPack(input: {
        packId?: string;
        pack: JsonObject;
    }): Promise<JsonObject>;
    setWritingPackEnabled(input: {
        packId: string;
        enabled: boolean;
    }): Promise<JsonObject>;
    deleteWritingPack(input: {
        packId: string;
    }): Promise<JsonObject>;
    restoreBuiltinWritingPack(input: {
        packId: string;
    }): Promise<JsonObject>;
    previewImportWritingPacks(input: {
        packs: JsonObject[];
    }): Promise<JsonObject>;
    confirmImportWritingPacks(input: {
        preview: JsonObject;
    }): Promise<JsonObject>;
    exportWritingPacks(input: {
        ids: string[];
    }): Promise<JsonObject>;
    savePromptAsset(input: {
        prompt: JsonObject;
    }): Promise<JsonObject>;
    setPromptVerification(input: {
        promptId: string;
        note: string;
    }): Promise<JsonObject>;
    setPromptArchived(input: {
        promptId: string;
        archived: boolean;
    }): Promise<JsonObject>;
    deletePromptAsset(input: {
        promptId: string;
    }): Promise<JsonObject>;
    listCaseAssets(input: {
        query?: string;
        includeArchived?: boolean;
    }): Promise<JsonObject>;
    saveCaseAsset(input: {
        caseItem: JsonObject;
    }): Promise<JsonObject>;
    deleteCaseAsset(input: {
        caseId: string;
    }): Promise<JsonObject>;
    listKnowledgeEntries(input: {
        filters?: JsonObject;
        workspaceSessionId?: string;
    }): Promise<JsonObject>;
    syncWorkspaceKnowledgeDirectory(input: {
        sessionId: string;
        directoryPath: string;
        files: {
            relativePath: string;
            text: string;
        }[];
        eventId: string;
    }): Promise<JsonObject>;
    revokeWorkspaceKnowledgeDirectory(input: {
        sessionId: string;
        directoryPath: string;
        eventId: string;
    }): Promise<JsonObject>;
    saveKnowledgeEntry(input: {
        entry: JsonObject;
        eventId: string;
    }): Promise<JsonObject>;
    deleteKnowledgeEntry(input: {
        entryId: string;
        eventId: string;
    }): Promise<JsonObject>;
    setKnowledgeFlags(input: {
        entryId: string;
        patch: {
            favorite?: boolean;
            pinned?: boolean;
            hiddenAt?: string;
        };
        eventId: string;
    }): Promise<JsonObject>;
    setKnowledgeSelection(input: {
        ids: string[];
        eventId: string;
    }): Promise<JsonObject>;
    setKnowledgeFilters(input: {
        filters: JsonObject;
        eventId: string;
    }): Promise<JsonObject>;
    previewKnowledgeContext(): Promise<JsonObject>;
    previewImport(input: {
        backupJson: string;
        sourceName?: string;
    }): Promise<JsonObject>;
    commitImport(input: {
        backupJson: string;
        selectedCategories: string[];
        eventId: string;
    }): Promise<JsonObject>;
    beginArchiveImport(input: {
        sourceName: string;
        size: number;
    }): Promise<JsonObject>;
    appendArchiveImportChunk(input: {
        uploadId: string;
        index: number;
        dataBase64: string;
    }): Promise<JsonObject>;
    previewArchiveImport(input: {
        uploadId: string;
        size: number;
    }): Promise<JsonObject>;
    commitArchiveImport(input: {
        uploadId: string;
        selectedCategories: string[];
        eventId: string;
    }): Promise<JsonObject>;
    cancelArchiveImport(input: {
        uploadId: string;
    }): Promise<JsonObject>;
    beginWritingMaterialUpload(input: {
        sourceName: string;
        mimeType: string;
        size: number;
    }): Promise<JsonObject>;
    appendWritingMaterialChunk(input: {
        uploadId: string;
        index: number;
        dataBase64: string;
    }): Promise<JsonObject>;
    parseWritingMaterialUpload(input: {
        uploadId: string;
    }, signal?: AbortSignal): Promise<JsonObject>;
    cancelWritingMaterialUpload(input: {
        uploadId: string;
    }): Promise<JsonObject>;
    listImportReceipts(): Promise<JsonObject>;
    deleteImportReceipt(input: {
        receiptId: string;
        eventId: string;
    }): Promise<JsonObject>;
    exportPluginBackup(input: {
        includePreferences?: boolean;
        includeServiceConfig?: boolean;
    }): Promise<JsonObject>;
    beginPluginBackupExport(input: {
        includePreferences?: boolean;
        includeServiceConfig?: boolean;
    }): Promise<JsonObject>;
    readPluginBackupExportChunk(input: {
        exportId: string;
        offset: number;
        length: number;
    }): Promise<JsonObject>;
    cancelPluginBackupExport(input: {
        exportId: string;
    }): Promise<JsonObject>;
    beginPluginBackupImport(input: {
        sourceName: string;
        size: number;
    }): Promise<JsonObject>;
    appendPluginBackupImportChunk(input: {
        uploadId: string;
        index: number;
        dataBase64: string;
    }): Promise<JsonObject>;
    previewPluginBackupImport(input: {
        uploadId: string;
        mode: 'replace' | 'merge';
    }): Promise<JsonObject>;
    restorePluginBackupArchive(input: {
        uploadId: string;
        mode: 'replace' | 'merge';
        expectedSha256: string;
        expectedRevision: number;
        confirmed: boolean;
        eventId: string;
    }): Promise<JsonObject>;
    cancelPluginBackupImport(input: {
        uploadId: string;
    }): Promise<JsonObject>;
    finishPluginBackupImport(input: {
        uploadId: string;
    }): Promise<JsonObject>;
    previewPluginRestore(input: {
        backupJson: string;
        mode: 'replace' | 'merge';
    }): Promise<JsonObject>;
    restorePluginBackup(input: {
        backupJson: string;
        mode: 'replace' | 'merge';
        expectedSha256: string;
        expectedRevision: number;
        confirmed: boolean;
        eventId: string;
    }): Promise<JsonObject>;
    createTask(input: CreateTaskInput): Promise<CreateTaskOutput>;
    private assertCurrentTask;
    updateTask(input: UpdateTaskInput): Promise<UpdateTaskOutput>;
    runApprovedResearch(input: {
        taskId: string;
    }, signal: AbortSignal): Promise<JsonObject>;
    archiveTask(input: ArchiveTaskInput): Promise<ArchiveTaskOutput>;
    previewDeleteTask(input: PreviewDeleteTaskInput): Promise<PreviewDeleteTaskOutput>;
    deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput>;
    saveExternalResult(input: SaveExternalResultInput): Promise<SaveExternalResultOutput>;
    saveReview(input: SaveReviewInput): Promise<SaveReviewOutput>;
    savePromptRevision(input: SavePromptRevisionInput): Promise<SavePromptRevisionOutput>;
    bindTask(input: BindTaskInput): Promise<BindTaskOutput>;
    getCurrentBinding(input: GetCurrentBindingInput): Promise<GetCurrentBindingOutput>;
    private memoryContext;
    private assertMemoryAccess;
    getMemoryView(input: MemoryViewInput): Promise<MemoryViewOutput>;
    setLearningPaused(input: SetLearningPausedInput): Promise<LearningControlOutput>;
    retryLearning(input: RetryLearningInput): Promise<LearningControlOutput>;
    editMemory(input: EditMemoryInput): Promise<MemoryMutationOutput>;
    setMemoryStatus(input: SetMemoryStatusInput): Promise<MemoryMutationOutput>;
    undoMemory(input: UndoMemoryInput): Promise<MemoryMutationOutput>;
    deleteMemory(input: DeleteMemoryInput): Promise<MemoryMutationOutput>;
    invalidateMemorySource(input: InvalidateMemorySourceInput): Promise<MemoryMutationOutput>;
    runTask(input: RunTaskInput, signal: AbortSignal): Promise<RunTaskOutput>;
    understandPptPage(input: UnderstandPptPageInput, signal: AbortSignal): Promise<UnderstandPptPageOutput>;
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
