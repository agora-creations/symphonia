import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { AgentEvent, AgentEventSchema, Issue, IssueSchema, TrackerKind } from "@symphonia/types";

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

export class EventStore {
  private readonly db: Database.Database;

  constructor(databasePath = resolve(process.env.SYMPHONIA_DB_PATH ?? DEFAULT_DATABASE_PATH)) {
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

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec(`
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
    `);
  }
}

export function getDatabasePathFromEnv(): string {
  return resolve(process.env.SYMPHONIA_DB_PATH ?? DEFAULT_DATABASE_PATH);
}
