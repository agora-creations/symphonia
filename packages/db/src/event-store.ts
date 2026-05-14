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
  Issue,
  IssueSchema,
  ReviewArtifactSnapshot,
  ReviewArtifactSnapshotSchema,
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

const maxHarnessPayloadBytes = 2_000_000;

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

    return row ? RunSchema.parse(JSON.parse(row.payload_json)) : null;
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

    return rows.map((row) => RunSchema.parse(JSON.parse(row.payload_json)));
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
          trackerKind: parsed.tracker?.kind ?? "mock",
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

export function getDatabasePathFromEnv(): string {
  return resolve(process.env.SYMPHONIA_DB_PATH ?? DEFAULT_DATABASE_PATH);
}
