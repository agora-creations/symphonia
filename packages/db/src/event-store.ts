import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  AgentEvent,
  AgentEventSchema,
  HarnessApplyResult,
  HarnessApplyResultSchema,
  HarnessScanResult,
  HarnessScanResultSchema,
  IntegrationWritePreview,
  IntegrationWritePreviewSchema,
  IntegrationWriteResult,
  IntegrationWriteResultSchema,
  Issue,
  IssueSchema,
  LocalWriteExecutionRecord,
  LocalWriteExecutionRecordSchema,
  ReviewArtifactSnapshot,
  ReviewArtifactSnapshotSchema,
  RunWorkspaceOwnership,
  RunWorkspaceOwnershipSchema,
  Run,
  RunSchema,
  TrackerKind,
} from "@symphonia/types";

export const DEFAULT_DATABASE_PATH = "./.data/agentboard.sqlite";

type StoredRow = {
  payload_json: string;
};

type IssueRow = {
  payload_json: string;
};

type IssueStatsRow = {
  issue_count: number;
  last_fetched_at: string | null;
};

type ReviewArtifactRow = {
  payload_json: string;
};

type HarnessScanRow = {
  payload_json: string;
};

type HarnessApplyRow = {
  payload_json: string;
};

type WriteActionRow = {
  payload_json: string;
};

type WorkspaceOwnershipRow = {
  payload_json: string;
};

const maxHarnessPayloadBytes = 2_000_000;
const maxWriteActionPayloadBytes = 500_000;

function parseRunPayload(payloadJson: string): Run | null {
  try {
    return RunSchema.parse(JSON.parse(payloadJson));
  } catch {
    return null;
  }
}

export class EventStore {
  private readonly db: Database.Database;
  private readonly databasePath: string;

  constructor(databasePath = resolve(process.env.SYMPHONIA_DB_PATH ?? DEFAULT_DATABASE_PATH)) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  append(event: AgentEvent): void {
    const parsed = AgentEventSchema.parse(event);

    this.db
      .prepare(
        `
          insert into run_events (event_id, run_id, type, timestamp, payload_json, created_at)
          values (@eventId, @runId, @type, @timestamp, @payloadJson, @createdAt)
        `,
      )
      .run({
        eventId: parsed.id,
        runId: parsed.runId,
        type: parsed.type,
        timestamp: parsed.timestamp,
        payloadJson: JSON.stringify(parsed),
        createdAt: new Date().toISOString(),
      });
  }

  saveRun(run: Run): void {
    const parsed = RunSchema.parse(run);
    this.db
      .prepare(
        `
          insert into run_records (
            run_id,
            issue_id,
            issue_identifier,
            tracker_kind,
            provider,
            status,
            started_at,
            updated_at,
            ended_at,
            last_event_at,
            recovery_state,
            payload_json
          )
          values (
            @runId,
            @issueId,
            @issueIdentifier,
            @trackerKind,
            @provider,
            @status,
            @startedAt,
            @updatedAt,
            @endedAt,
            @lastEventAt,
            @recoveryState,
            @payloadJson
          )
          on conflict(run_id) do update set
            issue_id = excluded.issue_id,
            issue_identifier = excluded.issue_identifier,
            tracker_kind = excluded.tracker_kind,
            provider = excluded.provider,
            status = excluded.status,
            started_at = excluded.started_at,
            updated_at = excluded.updated_at,
            ended_at = excluded.ended_at,
            last_event_at = excluded.last_event_at,
            recovery_state = excluded.recovery_state,
            payload_json = excluded.payload_json
        `,
      )
      .run({
        runId: parsed.id,
        issueId: parsed.issueId,
        issueIdentifier: parsed.issueIdentifier,
        trackerKind: parsed.trackerKind,
        provider: parsed.provider,
        status: parsed.status,
        startedAt: parsed.startedAt,
        updatedAt: parsed.updatedAt,
        endedAt: parsed.endedAt,
        lastEventAt: parsed.lastEventAt,
        recoveryState: parsed.recoveryState,
        payloadJson: JSON.stringify(parsed),
      });
  }

  getRun(runId: string): Run | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from run_records
          where run_id = ?
        `,
      )
      .get(runId) as StoredRow | undefined;

    return row ? parseRunPayload(row.payload_json) : null;
  }

  listRuns(): Run[] {
    const rows = this.db
      .prepare(
        `
          select payload_json
          from run_records
          order by coalesce(started_at, updated_at, last_event_at, '') desc, run_id asc
        `,
      )
      .all() as StoredRow[];

    return rows.flatMap((row) => {
      const parsed = parseRunPayload(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  getEventsForRun(runId: string): AgentEvent[] {
    const rows = this.db
      .prepare(
        `
          select payload_json
          from run_events
          where run_id = ?
          order by timestamp asc, sequence asc
        `,
      )
      .all(runId) as StoredRow[];

    return rows.map((row) => AgentEventSchema.parse(JSON.parse(row.payload_json)));
  }

  upsertIssues(issues: Issue[], fetchedAt: string): void {
    const statement = this.db.prepare(`
      insert into issue_cache (
        issue_id,
        identifier,
        tracker_kind,
        state,
        updated_at,
        last_fetched_at,
        payload_json
      )
      values (
        @issueId,
        @identifier,
        @trackerKind,
        @state,
        @updatedAt,
        @lastFetchedAt,
        @payloadJson
      )
      on conflict(issue_id) do update set
        identifier = excluded.identifier,
        tracker_kind = excluded.tracker_kind,
        state = excluded.state,
        updated_at = excluded.updated_at,
        last_fetched_at = excluded.last_fetched_at,
        payload_json = excluded.payload_json
    `);

    const transaction = this.db.transaction((items: Issue[]) => {
      for (const item of items) {
        const parsed = IssueSchema.parse({ ...item, lastFetchedAt: item.lastFetchedAt ?? fetchedAt });
        statement.run({
          issueId: parsed.id,
          identifier: parsed.identifier,
          trackerKind: parsed.tracker?.kind ?? "linear",
          state: parsed.state,
          updatedAt: parsed.updatedAt,
          lastFetchedAt: parsed.lastFetchedAt ?? fetchedAt,
          payloadJson: JSON.stringify(parsed),
        });
      }
    });

    transaction(issues);
  }

  listIssues(trackerKind?: TrackerKind): Issue[] {
    const rows = (trackerKind
      ? this.db
          .prepare(
            `
              select payload_json
              from issue_cache
              where tracker_kind = ?
              order by identifier asc
            `,
          )
          .all(trackerKind)
      : this.db
          .prepare(
            `
              select payload_json
              from issue_cache
              order by identifier asc
            `,
          )
          .all()) as IssueRow[];

    return rows.map((row) => IssueSchema.parse(JSON.parse(row.payload_json)));
  }

  getIssue(issueId: string): Issue | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from issue_cache
          where issue_id = ?
        `,
      )
      .get(issueId) as IssueRow | undefined;

    return row ? IssueSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getIssueByIdentifier(identifier: string): Issue | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from issue_cache
          where identifier = ?
        `,
      )
      .get(identifier) as IssueRow | undefined;

    return row ? IssueSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getIssueCacheStats(trackerKind?: TrackerKind): { issueCount: number; lastFetchedAt: string | null } {
    const row = (trackerKind
      ? this.db
          .prepare(
            `
              select count(*) as issue_count, max(last_fetched_at) as last_fetched_at
              from issue_cache
              where tracker_kind = ?
            `,
          )
          .get(trackerKind)
      : this.db
          .prepare(
            `
              select count(*) as issue_count, max(last_fetched_at) as last_fetched_at
              from issue_cache
            `,
          )
          .get()) as IssueStatsRow | undefined;

    return {
      issueCount: row?.issue_count ?? 0,
      lastFetchedAt: row?.last_fetched_at ?? null,
    };
  }

  saveReviewArtifactSnapshot(snapshot: ReviewArtifactSnapshot): void {
    const parsed = ReviewArtifactSnapshotSchema.parse(snapshot);
    this.db
      .prepare(
        `
          insert into review_artifact_snapshots (
            run_id,
            issue_id,
            issue_identifier,
            last_refreshed_at,
            payload_json,
            updated_at
          )
          values (
            @runId,
            @issueId,
            @issueIdentifier,
            @lastRefreshedAt,
            @payloadJson,
            @updatedAt
          )
          on conflict(run_id) do update set
            issue_id = excluded.issue_id,
            issue_identifier = excluded.issue_identifier,
            last_refreshed_at = excluded.last_refreshed_at,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        runId: parsed.runId,
        issueId: parsed.issueId,
        issueIdentifier: parsed.issueIdentifier,
        lastRefreshedAt: parsed.lastRefreshedAt,
        payloadJson: JSON.stringify(parsed),
        updatedAt: new Date().toISOString(),
      });
  }

  getReviewArtifactSnapshot(runId: string): ReviewArtifactSnapshot | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from review_artifact_snapshots
          where run_id = ?
        `,
      )
      .get(runId) as ReviewArtifactRow | undefined;

    return row ? ReviewArtifactSnapshotSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getLatestReviewArtifactSnapshotByIssue(issueId: string): ReviewArtifactSnapshot | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from review_artifact_snapshots
          where issue_id = ?
          order by last_refreshed_at desc
          limit 1
        `,
      )
      .get(issueId) as ReviewArtifactRow | undefined;

    return row ? ReviewArtifactSnapshotSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getLatestReviewArtifactSnapshotByIdentifier(issueIdentifier: string): ReviewArtifactSnapshot | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from review_artifact_snapshots
          where issue_identifier = ?
          order by last_refreshed_at desc
          limit 1
        `,
      )
      .get(issueIdentifier) as ReviewArtifactRow | undefined;

    return row ? ReviewArtifactSnapshotSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  saveHarnessScan(scan: HarnessScanResult): void {
    const parsed = HarnessScanResultSchema.parse(scan);
    const payloadJson = boundedHarnessPayload(parsed);
    this.db
      .prepare(
        `
          insert into harness_scans (
            scan_id,
            repository_path,
            scanned_at,
            score_percentage,
            grade,
            payload_json,
            updated_at
          )
          values (
            @scanId,
            @repositoryPath,
            @scannedAt,
            @scorePercentage,
            @grade,
            @payloadJson,
            @updatedAt
          )
          on conflict(scan_id) do update set
            repository_path = excluded.repository_path,
            scanned_at = excluded.scanned_at,
            score_percentage = excluded.score_percentage,
            grade = excluded.grade,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        scanId: parsed.id,
        repositoryPath: parsed.repositoryPath,
        scannedAt: parsed.scannedAt,
        scorePercentage: parsed.score.percentage,
        grade: parsed.grade,
        payloadJson,
        updatedAt: new Date().toISOString(),
      });
  }

  getHarnessScan(scanId: string): HarnessScanResult | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from harness_scans
          where scan_id = ?
        `,
      )
      .get(scanId) as HarnessScanRow | undefined;

    return row ? HarnessScanResultSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getLatestHarnessScanForRepository(repositoryPath: string): HarnessScanResult | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from harness_scans
          where repository_path = ?
          order by scanned_at desc, updated_at desc
          limit 1
        `,
      )
      .get(repositoryPath) as HarnessScanRow | undefined;

    return row ? HarnessScanResultSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listHarnessScans(repositoryPath?: string, limit = 20): HarnessScanResult[] {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const rows = (repositoryPath
      ? this.db
          .prepare(
            `
              select payload_json
              from harness_scans
              where repository_path = ?
              order by scanned_at desc, updated_at desc
              limit ?
            `,
          )
          .all(repositoryPath, boundedLimit)
      : this.db
          .prepare(
            `
              select payload_json
              from harness_scans
              order by scanned_at desc, updated_at desc
              limit ?
            `,
          )
          .all(boundedLimit)) as HarnessScanRow[];

    return rows.map((row) => HarnessScanResultSchema.parse(JSON.parse(row.payload_json)));
  }

  saveHarnessApplyResult(input: {
    id: string;
    repositoryPath: string;
    scanId: string | null;
    appliedAt: string;
    result: HarnessApplyResult;
  }): void {
    const result = HarnessApplyResultSchema.parse(input.result);
    const payloadJson = boundedHarnessPayload({ ...input, result });
    this.db
      .prepare(
        `
          insert into harness_apply_history (
            apply_id,
            scan_id,
            repository_path,
            applied_at,
            payload_json
          )
          values (
            @applyId,
            @scanId,
            @repositoryPath,
            @appliedAt,
            @payloadJson
          )
        `,
      )
      .run({
        applyId: input.id,
        scanId: input.scanId,
        repositoryPath: input.repositoryPath,
        appliedAt: input.appliedAt,
        payloadJson,
      });

    if (input.scanId) {
      this.db
        .prepare(
          `
            update harness_scans
            set last_applied_at = @appliedAt
            where scan_id = @scanId
          `,
        )
        .run({ appliedAt: input.appliedAt, scanId: input.scanId });
    }
  }

  listHarnessApplyHistory(repositoryPath?: string, limit = 20): unknown[] {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const rows = (repositoryPath
      ? this.db
          .prepare(
            `
              select payload_json
              from harness_apply_history
              where repository_path = ?
              order by applied_at desc
              limit ?
            `,
          )
          .all(repositoryPath, boundedLimit)
      : this.db
          .prepare(
            `
              select payload_json
              from harness_apply_history
              order by applied_at desc
              limit ?
            `,
          )
          .all(boundedLimit)) as HarnessApplyRow[];

    return rows.map((row) => JSON.parse(row.payload_json) as unknown);
  }

  saveIntegrationWritePreview(preview: IntegrationWritePreview): void {
    const parsed = IntegrationWritePreviewSchema.parse(preview);
    const payloadJson = boundedWriteActionPayload(parsed);
    this.db
      .prepare(
        `
          insert into integration_write_actions (
            action_id,
            preview_id,
            provider,
            kind,
            run_id,
            issue_id,
            status,
            external_id,
            external_url,
            idempotency_key,
            created_at,
            executed_at,
            payload_json
          )
          values (
            @actionId,
            @previewId,
            @provider,
            @kind,
            @runId,
            @issueId,
            @status,
            null,
            null,
            null,
            @createdAt,
            null,
            @payloadJson
          )
          on conflict(action_id) do update set
            provider = excluded.provider,
            kind = excluded.kind,
            run_id = excluded.run_id,
            issue_id = excluded.issue_id,
            status = excluded.status,
            created_at = excluded.created_at,
            payload_json = excluded.payload_json
        `,
      )
      .run({
        actionId: parsed.id,
        previewId: parsed.id,
        provider: parsed.provider,
        kind: parsed.kind,
        runId: parsed.runId,
        issueId: parsed.issueId,
        status: parsed.status,
        createdAt: parsed.createdAt,
        payloadJson,
      });
  }

  getIntegrationWritePreview(previewId: string): IntegrationWritePreview | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from integration_write_actions
          where preview_id = ? and action_id = preview_id
          order by created_at desc
          limit 1
        `,
      )
      .get(previewId) as WriteActionRow | undefined;

    return row ? IntegrationWritePreviewSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  saveIntegrationWriteResult(result: IntegrationWriteResult, idempotencyKey: string | null = null): void {
    const parsed = IntegrationWriteResultSchema.parse(result);
    const payloadJson = boundedWriteActionPayload(parsed);
    this.db
      .prepare(
        `
          insert into integration_write_actions (
            action_id,
            preview_id,
            provider,
            kind,
            run_id,
            issue_id,
            status,
            external_id,
            external_url,
            idempotency_key,
            created_at,
            executed_at,
            payload_json
          )
          values (
            @actionId,
            @previewId,
            @provider,
            @kind,
            @runId,
            @issueId,
            @status,
            @externalId,
            @externalUrl,
            @idempotencyKey,
            @createdAt,
            @executedAt,
            @payloadJson
          )
          on conflict(action_id) do update set
            status = excluded.status,
            external_id = excluded.external_id,
            external_url = excluded.external_url,
            idempotency_key = excluded.idempotency_key,
            executed_at = excluded.executed_at,
            payload_json = excluded.payload_json
        `,
      )
      .run({
        actionId: parsed.id,
        previewId: parsed.previewId,
        provider: parsed.provider,
        kind: parsed.kind,
        runId: String(parsed.redactedRequestSummary.runId ?? parsed.target.issueIdentifier ?? parsed.previewId),
        issueId: parsed.target.issueId,
        status: parsed.status,
        externalId: parsed.externalId,
        externalUrl: parsed.externalUrl,
        idempotencyKey,
        createdAt: parsed.executedAt,
        executedAt: parsed.executedAt,
        payloadJson,
      });
  }

  listIntegrationWriteActionsForRun(runId: string): Array<IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord> {
    const rows = this.db
      .prepare(
        `
          select payload_json
          from integration_write_actions
          where run_id = ?
          order by coalesce(executed_at, created_at) desc, action_id asc
        `,
      )
      .all(runId) as WriteActionRow[];

    return rows.map((row) => parseWriteActionPayload(row.payload_json)).filter(isDefined);
  }

  findIntegrationWriteResultByIdempotencyKey(idempotencyKey: string): IntegrationWriteResult | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from integration_write_actions
          where idempotency_key = ? and executed_at is not null
          order by executed_at desc
          limit 1
        `,
      )
      .get(idempotencyKey) as WriteActionRow | undefined;

    if (!row) return null;
    const parsed = parseWriteActionPayload(row.payload_json);
    return parsed && "previewId" in parsed && "executedAt" in parsed ? IntegrationWriteResultSchema.parse(parsed) : null;
  }

  saveLocalWriteExecutionRecord(record: LocalWriteExecutionRecord): void {
    const parsed = LocalWriteExecutionRecordSchema.parse(record);
    const payloadJson = boundedWriteActionPayload(parsed);
    this.db
      .prepare(
        `
          insert into integration_write_actions (
            action_id,
            preview_id,
            provider,
            kind,
            run_id,
            issue_id,
            status,
            external_id,
            external_url,
            idempotency_key,
            created_at,
            executed_at,
            payload_json
          )
          values (
            @actionId,
            @previewId,
            @provider,
            @kind,
            @runId,
            @issueId,
            @status,
            @externalId,
            @externalUrl,
            @idempotencyKey,
            @createdAt,
            @executedAt,
            @payloadJson
          )
          on conflict(action_id) do update set
            status = excluded.status,
            external_id = excluded.external_id,
            external_url = excluded.external_url,
            idempotency_key = excluded.idempotency_key,
            executed_at = excluded.executed_at,
            payload_json = excluded.payload_json
        `,
      )
      .run({
        actionId: parsed.id,
        previewId: parsed.previewId,
        provider: parsed.targetSystem,
        kind: parsed.kind,
        runId: parsed.runId,
        issueId: parsed.issueId,
        status: parsed.status,
        externalId: parsed.externalWriteId,
        externalUrl: parsed.githubPrUrl ?? parsed.linearCommentUrl,
        idempotencyKey: parsed.idempotencyKey,
        createdAt: parsed.startedAt,
        executedAt: parsed.completedAt,
        payloadJson,
      });
  }

  findLocalWriteExecutionByIdempotencyKey(idempotencyKey: string): LocalWriteExecutionRecord | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from integration_write_actions
          where idempotency_key = ?
          order by coalesce(executed_at, created_at) desc
          limit 1
        `,
      )
      .get(idempotencyKey) as WriteActionRow | undefined;

    if (!row) return null;
    const parsed = parseWriteActionPayload(row.payload_json);
    return parsed && "recordType" in parsed && parsed.recordType === "local_write_execution"
      ? LocalWriteExecutionRecordSchema.parse(parsed)
      : null;
  }

  saveRunWorkspaceOwnership(ownership: RunWorkspaceOwnership): void {
    const parsed = RunWorkspaceOwnershipSchema.parse(ownership);
    this.db
      .prepare(
        `
          insert into run_workspace_ownership (
            run_id,
            workspace_id,
            issue_id,
            issue_key,
            workspace_path,
            workspace_kind,
            isolation_status,
            pr_eligibility,
            created_at,
            prepared_at,
            payload_json
          )
          values (
            @runId,
            @workspaceId,
            @issueId,
            @issueKey,
            @workspacePath,
            @workspaceKind,
            @isolationStatus,
            @prEligibility,
            @createdAt,
            @preparedAt,
            @payloadJson
          )
          on conflict(run_id) do update set
            workspace_id = excluded.workspace_id,
            issue_id = excluded.issue_id,
            issue_key = excluded.issue_key,
            workspace_path = excluded.workspace_path,
            workspace_kind = excluded.workspace_kind,
            isolation_status = excluded.isolation_status,
            pr_eligibility = excluded.pr_eligibility,
            prepared_at = excluded.prepared_at,
            payload_json = excluded.payload_json
        `,
      )
      .run({
        runId: parsed.runId,
        workspaceId: parsed.workspaceId,
        issueId: parsed.issueId,
        issueKey: parsed.issueKey,
        workspacePath: parsed.workspacePath,
        workspaceKind: parsed.workspaceKind,
        isolationStatus: parsed.isolationStatus,
        prEligibility: parsed.prEligibility,
        createdAt: parsed.createdAt,
        preparedAt: parsed.preparedAt,
        payloadJson: JSON.stringify(parsed),
      });
  }

  getRunWorkspaceOwnership(runId: string): RunWorkspaceOwnership | null {
    const row = this.db
      .prepare(
        `
          select payload_json
          from run_workspace_ownership
          where run_id = ?
        `,
      )
      .get(runId) as WorkspaceOwnershipRow | undefined;

    return row ? RunWorkspaceOwnershipSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listRunWorkspaceOwnership(): RunWorkspaceOwnership[] {
    const rows = this.db
      .prepare(
        `
          select payload_json
          from run_workspace_ownership
          order by prepared_at desc, run_id asc
        `,
      )
      .all() as WorkspaceOwnershipRow[];

    return rows.map((row) => RunWorkspaceOwnershipSchema.parse(JSON.parse(row.payload_json)));
  }

  close(): void {
    this.db.close();
  }

  getDatabasePath(): string {
    return this.databasePath;
  }

  private initialize(): void {
    this.db.exec(`
      create table if not exists run_records (
        run_id text primary key,
        issue_id text not null,
        issue_identifier text not null,
        tracker_kind text not null,
        provider text not null,
        status text not null,
        started_at text,
        updated_at text,
        ended_at text,
        last_event_at text,
        recovery_state text not null,
        payload_json text not null
      );

      create index if not exists idx_run_records_issue_id
      on run_records (issue_id, started_at);

      create index if not exists idx_run_records_status
      on run_records (status, updated_at);

      create table if not exists run_events (
        sequence integer primary key autoincrement,
        event_id text not null unique,
        run_id text not null,
        type text not null,
        timestamp text not null,
        payload_json text not null,
        created_at text not null
      );

      create index if not exists idx_run_events_run_id_time
      on run_events (run_id, timestamp, sequence);

      create table if not exists issue_cache (
        issue_id text primary key,
        identifier text not null,
        tracker_kind text not null,
        state text not null,
        updated_at text not null,
        last_fetched_at text not null,
        payload_json text not null
      );

      create index if not exists idx_issue_cache_tracker_identifier
      on issue_cache (tracker_kind, identifier);

      create index if not exists idx_issue_cache_updated_at
      on issue_cache (updated_at);

      create table if not exists review_artifact_snapshots (
        run_id text primary key,
        issue_id text not null,
        issue_identifier text not null,
        last_refreshed_at text not null,
        payload_json text not null,
        updated_at text not null
      );

      create index if not exists idx_review_artifact_snapshots_issue_id
      on review_artifact_snapshots (issue_id, last_refreshed_at);

      create index if not exists idx_review_artifact_snapshots_issue_identifier
      on review_artifact_snapshots (issue_identifier, last_refreshed_at);

      create table if not exists harness_scans (
        scan_id text primary key,
        repository_path text not null,
        scanned_at text not null,
        score_percentage integer not null,
        grade text not null,
        payload_json text not null,
        updated_at text not null,
        last_applied_at text
      );

      create index if not exists idx_harness_scans_repository_scanned
      on harness_scans (repository_path, scanned_at);

      create table if not exists harness_apply_history (
        apply_id text primary key,
        scan_id text,
        repository_path text not null,
        applied_at text not null,
        payload_json text not null
      );

      create index if not exists idx_harness_apply_history_repository
      on harness_apply_history (repository_path, applied_at);

      create table if not exists integration_write_actions (
        action_id text primary key,
        preview_id text not null,
        provider text not null,
        kind text not null,
        run_id text not null,
        issue_id text,
        status text not null,
        external_id text,
        external_url text,
        idempotency_key text,
        created_at text not null,
        executed_at text,
        payload_json text not null
      );

      create index if not exists idx_integration_write_actions_run
      on integration_write_actions (run_id, created_at);

      create index if not exists idx_integration_write_actions_preview
      on integration_write_actions (preview_id);

      create unique index if not exists idx_integration_write_actions_idempotency
      on integration_write_actions (idempotency_key)
      where idempotency_key is not null;

      create table if not exists run_workspace_ownership (
        run_id text primary key,
        workspace_id text not null,
        issue_id text not null,
        issue_key text not null,
        workspace_path text not null,
        workspace_kind text not null,
        isolation_status text not null,
        pr_eligibility text not null,
        created_at text not null,
        prepared_at text not null,
        payload_json text not null
      );

      create index if not exists idx_run_workspace_ownership_issue
      on run_workspace_ownership (issue_id, prepared_at);

      create index if not exists idx_run_workspace_ownership_workspace
      on run_workspace_ownership (workspace_path);
    `);
  }
}

function boundedHarnessPayload(value: unknown): string {
  const payloadJson = JSON.stringify(value);
  if (Buffer.byteLength(payloadJson, "utf8") > maxHarnessPayloadBytes) {
    throw new Error("Harness payload exceeded SQLite storage limit.");
  }
  return payloadJson;
}

function boundedWriteActionPayload(value: unknown): string {
  const payloadJson = JSON.stringify(value);
  if (Buffer.byteLength(payloadJson, "utf8") > maxWriteActionPayloadBytes) {
    throw new Error("Integration write action payload exceeded SQLite storage limit.");
  }
  if (/Bearer\s+[A-Za-z0-9._-]+/.test(payloadJson) || /gh[pousr]_[A-Za-z0-9_]+/.test(payloadJson)) {
    throw new Error("Integration write action payload appears to contain a raw token.");
  }
  return payloadJson;
}

function parseWriteActionPayload(payloadJson: string): IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord | null {
  const value = JSON.parse(payloadJson) as unknown;
  const localExecution = LocalWriteExecutionRecordSchema.safeParse(value);
  if (localExecution.success) return localExecution.data;
  const result = IntegrationWriteResultSchema.safeParse(value);
  if (result.success) return result.data;
  const preview = IntegrationWritePreviewSchema.safeParse(value);
  return preview.success ? preview.data : null;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function getDatabasePathFromEnv(): string {
  return resolve(process.env.SYMPHONIA_DB_PATH ?? DEFAULT_DATABASE_PATH);
}
