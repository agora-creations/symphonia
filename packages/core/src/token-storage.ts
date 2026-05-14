import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AuthCredentialSource, AuthMethod, AuthProviderId, TokenStorageKind } from "@symphonia/types";
import { nowIso } from "./time.js";

export type StoredAuthToken = {
  id: string;
  provider: AuthProviderId;
  method: AuthMethod;
  credentialSource: AuthCredentialSource;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  permissions: string[];
  tokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  accountLabel: string | null;
  accountId: string | null;
  workspaceLabel: string | null;
  workspaceId: string | null;
  connectedAt: string;
  lastValidatedAt: string | null;
  lastError: string | null;
  refreshSupported: boolean;
};

export type TokenStoreDiagnostics = {
  kind: TokenStorageKind;
  available: boolean;
  path: string | null;
  error: string | null;
};

export interface TokenStore {
  readonly kind: TokenStorageKind;
  isAvailable(): boolean;
  diagnostics(): TokenStoreDiagnostics;
  get(provider: AuthProviderId): StoredAuthToken | null;
  set(record: StoredAuthToken): void;
  delete(provider: AuthProviderId): void;
  list(): StoredAuthToken[];
}

export class MemoryTokenStore implements TokenStore {
  readonly kind: TokenStorageKind = "memory";
  private readonly records = new Map<AuthProviderId, StoredAuthToken>();

  isAvailable(): boolean {
    return true;
  }

  diagnostics(): TokenStoreDiagnostics {
    return { kind: this.kind, available: true, path: null, error: null };
  }

  get(provider: AuthProviderId): StoredAuthToken | null {
    return this.records.get(provider) ?? null;
  }

  set(record: StoredAuthToken): void {
    this.records.set(record.provider, { ...record });
  }

  delete(provider: AuthProviderId): void {
    this.records.delete(provider);
  }

  list(): StoredAuthToken[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }
}

type EncryptedPayload = {
  version: 1;
  encryptedAt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

type TokenStoreFile = {
  records: StoredAuthToken[];
};

export class EncryptedFileTokenStore implements TokenStore {
  readonly kind: TokenStorageKind = "encrypted_local_file";
  private lastError: string | null = null;

  constructor(
    private readonly filePath: string,
    private readonly keyPath = `${filePath}.key`,
  ) {}

  isAvailable(): boolean {
    try {
      this.ensureKey();
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Token storage is unavailable.";
      return false;
    }
  }

  diagnostics(): TokenStoreDiagnostics {
    return { kind: this.kind, available: this.isAvailable(), path: this.filePath, error: this.lastError };
  }

  get(provider: AuthProviderId): StoredAuthToken | null {
    return this.readFile().records.find((record) => record.provider === provider) ?? null;
  }

  set(record: StoredAuthToken): void {
    const file = this.readFile();
    const records = file.records.filter((candidate) => candidate.provider !== record.provider);
    records.push(record);
    this.writeFile({ records });
  }

  delete(provider: AuthProviderId): void {
    const file = this.readFile();
    this.writeFile({ records: file.records.filter((record) => record.provider !== provider) });
  }

  list(): StoredAuthToken[] {
    return this.readFile().records;
  }

  private readFile(): TokenStoreFile {
    if (!existsSync(this.filePath)) return { records: [] };

    try {
      const payload = JSON.parse(readFileSync(this.filePath, "utf8")) as EncryptedPayload;
      if (payload.version !== 1) throw new Error("Unsupported auth token store version.");
      const key = this.ensureKey();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
      decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      const decoded = JSON.parse(plaintext) as TokenStoreFile;
      return {
        records: Array.isArray(decoded.records) ? decoded.records.filter(isStoredAuthToken) : [],
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unable to read auth token store.";
      return { records: [] };
    }
  }

  private writeFile(file: TokenStoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const key = this.ensureKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(file), "utf8"), cipher.final()]);
    const payload: EncryptedPayload = {
      version: 1,
      encryptedAt: nowIso(),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    void chmod(this.filePath, 0o600).catch(() => undefined);
    this.lastError = null;
  }

  private ensureKey(): Buffer {
    const envKey = process.env.SYMPHONIA_AUTH_STORAGE_KEY;
    if (envKey && envKey.trim().length > 0) {
      return createHash("sha256").update(envKey).digest();
    }

    mkdirSync(dirname(this.keyPath), { recursive: true });
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
      void chmod(this.keyPath, 0o600).catch(() => undefined);
    }
    return Buffer.from(readFileSync(this.keyPath, "utf8").trim(), "base64");
  }
}

export function defaultAuthStorePath(basePath = process.env.SYMPHONIA_AUTH_STORE_PATH): string {
  if (basePath && basePath.trim().length > 0) return resolve(basePath);
  return resolve(process.env.SYMPHONIA_DB_PATH ? dirname(process.env.SYMPHONIA_DB_PATH) : ".data", "auth-tokens.enc.json");
}

export function tokenFingerprint(token: string): string {
  const hash = createHash("sha256").update(token).digest("hex").slice(0, 10);
  return `${hash}...${token.slice(-4)}`;
}

export function redactedTokenSource(source: AuthCredentialSource, token: string, label?: string): string {
  if (source === "env") return label ? `env:${label}:present` : "env:present";
  if (source === "unavailable") return "unavailable";
  return `${source}:${tokenFingerprint(token)}`;
}

export function makeStoredAuthToken(input: Omit<StoredAuthToken, "id" | "connectedAt"> & { id?: string; connectedAt?: string }): StoredAuthToken {
  return {
    ...input,
    id: input.id ?? `${input.provider}-${input.credentialSource}`,
    connectedAt: input.connectedAt ?? nowIso(),
  };
}

function isStoredAuthToken(value: unknown): value is StoredAuthToken {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<StoredAuthToken>;
  return (
    (record.provider === "github" || record.provider === "linear") &&
    typeof record.accessToken === "string" &&
    record.accessToken.length > 0
  );
}
