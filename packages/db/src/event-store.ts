import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { AgentEvent, AgentEventSchema } from "@symphonia/types";

export const DEFAULT_DATABASE_PATH = "./.data/agentboard.sqlite";

type StoredRow = {
  payload_json: string;
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
    `);
  }
}

export function getDatabasePathFromEnv(): string {
  return resolve(process.env.SYMPHONIA_DB_PATH ?? DEFAULT_DATABASE_PATH);
}
