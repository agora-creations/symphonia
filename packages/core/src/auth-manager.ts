import { createHash, randomBytes } from "node:crypto";
import {
  AuthCallbackResult,
  AuthConnectionStatus,
  AuthCredentialSource,
  AuthDisconnectRequest,
  AuthPollResult,
  AuthProviderId,
  AuthStartRequest,
  AuthStartResult,
  AuthStatus,
  AuthValidationResult,
  IntegrationAuthConnection,
} from "@symphonia/types";
import { nowIso } from "./time.js";
import {
  defaultAuthStorePath,
  EncryptedFileTokenStore,
  makeStoredAuthToken,
  MemoryTokenStore,
  redactedTokenSource,
  StoredAuthToken,
  TokenStore,
} from "./token-storage.js";

export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AuthResolvedCredential = {
  provider: AuthProviderId;
  source: AuthCredentialSource;
  token: string;
  authorizationHeader: string;
  connection: IntegrationAuthConnection;
};

export type AuthProviderConfig = {
  github?: {
    clientId?: string | null;
    apiEndpoint?: string;
    deviceCodeEndpoint?: string;
    tokenEndpoint?: string;
    requestedScopes?: string[];
  };
  linear?: {
    clientId?: string | null;
    clientSecret?: string | null;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    revokeEndpoint?: string;
    apiEndpoint?: string;
    redirectUri?: string | null;
    requestedScopes?: string[];
  };
};

type NormalizedAuthProviderConfig = {
  github: {
    clientId: string | null;
    apiEndpoint: string;
    deviceCodeEndpoint: string;
    tokenEndpoint: string;
    requestedScopes: string[];
  };
  linear: {
    clientId: string | null;
    clientSecret: string | null;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revokeEndpoint: string;
    apiEndpoint: string;
    redirectUri: string | null;
    requestedScopes: string[];
  };
};

export type AuthManagerOptions = {
  store?: TokenStore;
  fetch?: AuthFetch;
  config?: AuthProviderConfig;
};

type GithubDeviceSession = {
  authSessionId: string;
  provider: "github";
  method: "oauth_device";
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  pollIntervalMs: number;
  requestedScopes: string[];
  status: AuthConnectionStatus;
  lastError: string | null;
};

type LinearPkceSession = {
  authSessionId: string;
  provider: "linear";
  method: "oauth_pkce" | "oauth_loopback";
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  codeVerifier: string;
  state: string;
  requestedScopes: string[];
  expiresAt: string;
  status: AuthConnectionStatus;
  lastError: string | null;
};

type AuthSession = GithubDeviceSession | LinearPkceSession;

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
  interval?: unknown;
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
};

type AccountInfo = {
  accountId: string | null;
  accountLabel: string | null;
  workspaceId: string | null;
  workspaceLabel: string | null;
  permissions: string[];
};

const githubDefaultScopes = ["repo"];
const linearDefaultScopes = ["read"];

export class AuthManager {
  private readonly fetchFn: AuthFetch;
  private readonly store: TokenStore;
  private readonly sessions = new Map<string, AuthSession>();
  private readonly config: NormalizedAuthProviderConfig;

  constructor(options: AuthManagerOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.store = options.store ?? new EncryptedFileTokenStore(defaultAuthStorePath());
    this.config = normalizeAuthConfig(options.config);
  }

  getStatus(): AuthStatus {
    const diagnostics = this.store.diagnostics();
    return {
      providers: this.getConnections(),
      storage: {
        kind: diagnostics.kind,
        available: diagnostics.available,
      },
    };
  }

  getConnections(): IntegrationAuthConnection[] {
    return [this.getConnection("github"), this.getConnection("linear")];
  }

  getConnection(provider: AuthProviderId): IntegrationAuthConnection {
    const stored = this.store.get(provider);
    if (stored) return connectionFromStored(stored, this.store.kind, providerConfigState(provider, this.config));

    const env = this.envToken(provider);
    if (env) return envConnection(provider, env.envVar, providerConfigState(provider, this.config));

    return unavailableConnection(provider, providerConfigState(provider, this.config));
  }

  async startAuth(request: AuthStartRequest): Promise<AuthStartResult> {
    if (request.method === "manual_token") {
      return this.storeManualToken(request);
    }

    if (request.method === "env_token") {
      const validation = await this.validateConnection(request.provider);
      return {
        authSessionId: `env-${request.provider}`,
        provider: request.provider,
        method: "env_token",
        status: validation.status,
        authorizationUrl: null,
        verificationUri: null,
        userCode: null,
        expiresAt: validation.expiresAt,
        pollIntervalMs: null,
        instructions: [validation.error ?? `${request.provider} environment token validation completed.`],
      };
    }

    if (request.provider === "github" && request.method === "oauth_device") {
      return this.startGithubDeviceFlow(request);
    }

    if (request.provider === "linear" && (request.method === "oauth_pkce" || request.method === "oauth_loopback")) {
      return this.startLinearPkceFlow(request);
    }

    return {
      authSessionId: `unavailable-${request.provider}`,
      provider: request.provider,
      method: request.method,
      status: "unavailable",
      authorizationUrl: null,
      verificationUri: null,
      userCode: null,
      expiresAt: null,
      pollIntervalMs: null,
      instructions: [`${request.method} is not available for ${request.provider}.`],
    };
  }

  async pollAuth(provider: AuthProviderId, authSessionId: string): Promise<AuthPollResult> {
    const session = this.sessions.get(authSessionId);
    if (!session || session.provider !== provider) {
      return { authSessionId, status: "failed", connection: null, error: "Auth session not found." };
    }

    if (provider !== "github" || session.method !== "oauth_device") {
      return { authSessionId, status: session.status, connection: null, error: session.lastError };
    }

    const body = new URLSearchParams({
      client_id: session.clientId,
      device_code: session.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const response = await this.postForm(this.config.github.tokenEndpoint, body);
    if (response.error) {
      const error = stringOrNull(response.error) ?? "github_auth_failed";
      if (error === "authorization_pending") {
        session.status = "pending_user";
        session.lastError = null;
        return { authSessionId, status: "pending_user", connection: null, error: null };
      }
      if (error === "slow_down") {
        session.status = "pending_user";
        session.pollIntervalMs += 5_000;
        session.lastError = "GitHub asked Symphonia to slow down polling.";
        return { authSessionId, status: "pending_user", connection: null, error: session.lastError };
      }
      session.status = error === "expired_token" || error === "token_expired" ? "expired" : "failed";
      session.lastError = githubDeviceErrorMessage(error, response.error_description);
      return { authSessionId, status: session.status, connection: null, error: session.lastError };
    }

    const accessToken = requireString(response.access_token, "GitHub token response did not include an access token.");
    const record = makeStoredAuthToken({
      provider: "github",
      method: "oauth_device",
      credentialSource: "connected",
      accessToken,
      refreshToken: stringOrNull(response.refresh_token),
      scopes: parseScopes(response.scope),
      permissions: [],
      tokenExpiresAt: secondsFromNow(response.expires_in),
      refreshTokenExpiresAt: secondsFromNow(response.refresh_token_expires_in),
      accountLabel: null,
      accountId: null,
      workspaceLabel: null,
      workspaceId: null,
      lastValidatedAt: null,
      lastError: null,
      refreshSupported: Boolean(response.refresh_token),
    });
    const validated = await this.validateAndStore(record);
    this.sessions.delete(authSessionId);
    return { authSessionId, status: validated.status, connection: this.getConnection("github"), error: validated.error };
  }

  async completeCallback(provider: AuthProviderId, input: unknown): Promise<AuthCallbackResult> {
    if (provider !== "linear") {
      return { provider, status: "failed", connection: null, error: "Callback flow is only implemented for Linear PKCE." };
    }

    const parsed = parseCallbackInput(input);
    const session = parsed.authSessionId
      ? this.sessions.get(parsed.authSessionId)
      : [...this.sessions.values()].find((candidate) => candidate.provider === "linear" && candidate.state === parsed.state);
    if (!session || session.provider !== "linear") {
      return { provider, status: "failed", connection: null, error: "Auth session not found." };
    }
    if (parsed.state !== session.state) {
      session.status = "failed";
      session.lastError = "OAuth state mismatch.";
      return { provider, status: "failed", connection: null, error: session.lastError };
    }
    if (parsed.error) {
      session.status = "failed";
      session.lastError = parsed.error;
      return { provider, status: "failed", connection: null, error: parsed.error };
    }

    const body = new URLSearchParams({
      code: parsed.code,
      redirect_uri: session.redirectUri,
      client_id: session.clientId,
      code_verifier: session.codeVerifier,
      grant_type: "authorization_code",
    });
    if (session.clientSecret) body.set("client_secret", session.clientSecret);

    const response = await this.postForm(this.config.linear.tokenEndpoint, body);
    if (response.error) {
      session.status = "failed";
      session.lastError = stringOrNull(response.error_description) ?? stringOrNull(response.error) ?? "Linear token exchange failed.";
      return { provider, status: "failed", connection: null, error: session.lastError };
    }

    const accessToken = requireString(response.access_token, "Linear token response did not include an access token.");
    const record = makeStoredAuthToken({
      provider: "linear",
      method: session.method,
      credentialSource: "connected",
      accessToken,
      refreshToken: stringOrNull(response.refresh_token),
      scopes: parseScopes(response.scope),
      permissions: [],
      tokenExpiresAt: secondsFromNow(response.expires_in),
      refreshTokenExpiresAt: null,
      accountLabel: null,
      accountId: null,
      workspaceLabel: null,
      workspaceId: null,
      lastValidatedAt: null,
      lastError: null,
      refreshSupported: Boolean(response.refresh_token),
    });
    const validated = await this.validateAndStore(record);
    this.sessions.delete(session.authSessionId);
    return { provider, status: validated.status, connection: this.getConnection("linear"), error: validated.error };
  }

  async validateConnection(provider: AuthProviderId): Promise<AuthValidationResult> {
    const credential = this.resolveCredential(provider);
    if (!credential) {
      return {
        provider,
        status: "unavailable",
        account: null,
        scopes: [],
        permissions: [],
        expiresAt: null,
        error: `${provider} credentials are not configured.`,
        credentialSource: "unavailable",
        redactedSource: "unavailable",
      };
    }

    try {
      const account = provider === "github" ? await this.validateGithub(credential) : await this.validateLinear(credential);
      const stored = this.store.get(provider);
      if (stored && credential.source !== "env") {
        this.store.set({
          ...stored,
          accountId: account.accountId,
          accountLabel: account.accountLabel,
          workspaceId: account.workspaceId,
          workspaceLabel: account.workspaceLabel,
          permissions: account.permissions,
          lastValidatedAt: nowIso(),
          lastError: null,
        });
      }
      return {
        provider,
        status: "connected",
        account: {
          id: account.accountId,
          label: account.accountLabel,
          workspaceId: account.workspaceId,
          workspaceLabel: account.workspaceLabel,
        },
        scopes: credential.connection.scopes,
        permissions: account.permissions,
        expiresAt: credential.connection.tokenExpiresAt,
        error: null,
        credentialSource: credential.source,
        redactedSource: credential.connection.redactedSource,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} validation failed.`;
      const stored = this.store.get(provider);
      if (stored && credential.source !== "env") {
        this.store.set({ ...stored, lastValidatedAt: nowIso(), lastError: message });
      }
      return {
        provider,
        status: "failed",
        account: null,
        scopes: credential.connection.scopes,
        permissions: [],
        expiresAt: credential.connection.tokenExpiresAt,
        error: message,
        credentialSource: credential.source,
        redactedSource: credential.connection.redactedSource,
      };
    }
  }

  async refreshConnection(provider: AuthProviderId): Promise<AuthValidationResult> {
    const stored = this.store.get(provider);
    if (!stored?.refreshToken) return this.validateConnection(provider);

    try {
      const body = new URLSearchParams({
        refresh_token: stored.refreshToken,
        grant_type: "refresh_token",
      });
      if (provider === "github") {
        const clientId = this.config.github.clientId;
        if (!clientId) throw new Error("GitHub client id is not configured.");
        body.set("client_id", clientId);
      } else {
        const clientId = this.config.linear.clientId;
        if (!clientId) throw new Error("Linear client id is not configured.");
        body.set("client_id", clientId);
        if (this.config.linear.clientSecret) body.set("client_secret", this.config.linear.clientSecret);
      }

      const response = await this.postForm(
        provider === "github" ? this.config.github.tokenEndpoint : this.config.linear.tokenEndpoint,
        body,
      );
      if (response.error) throw new Error(stringOrNull(response.error_description) ?? stringOrNull(response.error) ?? "Token refresh failed.");

      this.store.set({
        ...stored,
        accessToken: requireString(response.access_token, "Refresh response did not include an access token."),
        refreshToken: stringOrNull(response.refresh_token) ?? stored.refreshToken,
        scopes: parseScopes(response.scope).length > 0 ? parseScopes(response.scope) : stored.scopes,
        tokenExpiresAt: secondsFromNow(response.expires_in),
        refreshTokenExpiresAt: secondsFromNow(response.refresh_token_expires_in) ?? stored.refreshTokenExpiresAt,
        lastError: null,
      });
      return this.validateConnection(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token refresh failed.";
      this.store.set({ ...stored, lastError: message });
      return {
        provider,
        status: "expired",
        account: null,
        scopes: stored.scopes,
        permissions: stored.permissions,
        expiresAt: stored.tokenExpiresAt,
        error: message,
        credentialSource: stored.credentialSource,
        redactedSource: redactedTokenSource(stored.credentialSource, stored.accessToken),
      };
    }
  }

  async disconnect(request: AuthDisconnectRequest): Promise<IntegrationAuthConnection> {
    const stored = this.store.get(request.provider);
    if (request.revokeRemoteTokenIfSupported && stored) {
      await this.revokeStoredToken(request.provider, stored).catch(() => undefined);
    }
    if (request.deleteStoredToken) this.store.delete(request.provider);
    return this.getConnection(request.provider);
  }

  resolveCredential(provider: AuthProviderId): AuthResolvedCredential | null {
    const stored = this.store.get(provider);
    if (stored && !isExpired(stored.tokenExpiresAt)) {
      const connection = connectionFromStored(stored, this.store.kind, providerConfigState(provider, this.config));
      return {
        provider,
        source: stored.credentialSource,
        token: stored.accessToken,
        authorizationHeader:
          provider === "linear" && stored.method === "manual_token" ? stored.accessToken : `Bearer ${stored.accessToken}`,
        connection,
      };
    }

    const env = this.envToken(provider);
    if (env) {
      const connection = envConnection(provider, env.envVar, providerConfigState(provider, this.config));
      return {
        provider,
        source: "env",
        token: env.token,
        authorizationHeader: provider === "github" ? `Bearer ${env.token}` : env.token,
        connection,
      };
    }

    return null;
  }

  private async startGithubDeviceFlow(request: AuthStartRequest): Promise<AuthStartResult> {
    const clientId = stringFromMetadata(request.metadata, "clientId") ?? this.config.github.clientId;
    if (!clientId) {
      return unavailableStart(request, "GitHub client id is not configured. Set SYMPHONIA_GITHUB_CLIENT_ID.");
    }

    const scopes = request.requestedScopes.length > 0 ? request.requestedScopes : this.config.github.requestedScopes;
    const response = await this.postForm(
      this.config.github.deviceCodeEndpoint,
      new URLSearchParams({ client_id: clientId, scope: scopes.join(" ") }),
    );
    if (response.error) {
      return unavailableStart(request, stringOrNull(response.error_description) ?? stringOrNull(response.error) ?? "GitHub device flow failed.");
    }

    const expiresAt = secondsFromNow(response.expires_in) ?? nowIso();
    const authSessionId = `github-${randomId()}`;
    const session: GithubDeviceSession = {
      authSessionId,
      provider: "github",
      method: "oauth_device",
      clientId,
      deviceCode: requireString(response.device_code, "GitHub device flow did not return a device code."),
      userCode: requireString(response.user_code, "GitHub device flow did not return a user code."),
      verificationUri: requireString(response.verification_uri, "GitHub device flow did not return a verification URI."),
      expiresAt,
      pollIntervalMs: Math.max(1, numberOr(response.interval, 5)) * 1000,
      requestedScopes: scopes,
      status: "pending_user",
      lastError: null,
    };
    this.sessions.set(authSessionId, session);
    return {
      authSessionId,
      provider: "github",
      method: "oauth_device",
      status: "pending_user",
      authorizationUrl: session.verificationUri,
      verificationUri: session.verificationUri,
      userCode: session.userCode,
      expiresAt,
      pollIntervalMs: session.pollIntervalMs,
      instructions: ["Open GitHub device authorization, enter the code, then return to Symphonia."],
    };
  }

  private startLinearPkceFlow(request: AuthStartRequest): AuthStartResult {
    const clientId = stringFromMetadata(request.metadata, "clientId") ?? this.config.linear.clientId;
    const redirectUri =
      stringFromMetadata(request.metadata, "redirectUri") ??
      this.config.linear.redirectUri ??
      "http://127.0.0.1:4100/auth/linear/callback";
    if (!clientId) {
      return unavailableStart(request, "Linear client id is not configured. Set SYMPHONIA_LINEAR_CLIENT_ID.");
    }

    const scopes = request.requestedScopes.length > 0 ? request.requestedScopes : this.config.linear.requestedScopes;
    const authSessionId = `linear-${randomId()}`;
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    const state = randomId();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const authorizationUrl = new URL(this.config.linear.authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", scopes.join(","));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    this.sessions.set(authSessionId, {
      authSessionId,
      provider: "linear",
      method: request.method === "oauth_loopback" ? "oauth_loopback" : "oauth_pkce",
      clientId,
      clientSecret: stringFromMetadata(request.metadata, "clientSecret") ?? this.config.linear.clientSecret,
      redirectUri,
      codeVerifier,
      state,
      requestedScopes: scopes,
      expiresAt,
      status: "pending_user",
      lastError: null,
    });

    return {
      authSessionId,
      provider: "linear",
      method: request.method === "oauth_loopback" ? "oauth_loopback" : "oauth_pkce",
      status: "pending_user",
      authorizationUrl: authorizationUrl.toString(),
      verificationUri: authorizationUrl.toString(),
      userCode: null,
      expiresAt,
      pollIntervalMs: null,
      instructions: ["Open Linear authorization, approve access, then return through the configured callback."],
    };
  }

  private async storeManualToken(request: AuthStartRequest): Promise<AuthStartResult> {
    const token = stringFromMetadata(request.metadata, "token") ?? stringFromMetadata(request.metadata, "manualToken");
    if (!token) return unavailableStart(request, "Manual token was not provided.");
    const record = makeStoredAuthToken({
      provider: request.provider,
      method: "manual_token",
      credentialSource: "manual",
      accessToken: token,
      refreshToken: null,
      scopes: request.requestedScopes,
      permissions: [],
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      accountLabel: null,
      accountId: null,
      workspaceLabel: null,
      workspaceId: null,
      lastValidatedAt: null,
      lastError: null,
      refreshSupported: false,
    });
    const validation = await this.validateAndStore(record);
    return {
      authSessionId: `manual-${request.provider}`,
      provider: request.provider,
      method: "manual_token",
      status: validation.status,
      authorizationUrl: null,
      verificationUri: null,
      userCode: null,
      expiresAt: validation.expiresAt,
      pollIntervalMs: null,
      instructions: [validation.error ?? `${request.provider} manual token was stored and validated.`],
    };
  }

  private async validateAndStore(record: StoredAuthToken): Promise<AuthValidationResult> {
    this.store.set(record);
    const validation = await this.validateConnection(record.provider);
    if (validation.status !== "connected") {
      this.store.delete(record.provider);
      return validation;
    }
    return validation;
  }

  private async validateGithub(credential: AuthResolvedCredential): Promise<AccountInfo> {
    const response = await this.fetchJson(`${this.config.github.apiEndpoint.replace(/\/+$/, "")}/user`, {
      headers: githubHeaders(credential.authorizationHeader),
    });
    return {
      accountId: stringOrNumber(response.id),
      accountLabel: stringOrNull(response.login) ?? stringOrNull(response.name),
      workspaceId: null,
      workspaceLabel: null,
      permissions: [],
    };
  }

  private async validateLinear(credential: AuthResolvedCredential): Promise<AccountInfo> {
    const response = await this.fetchJson(this.config.linear.apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: credential.authorizationHeader,
      },
      body: JSON.stringify({
        query: `query SymphoniaAuthViewer { viewer { id name email } }`,
        variables: {},
      }),
    });
    const data = isRecord(response.data) ? response.data : {};
    const viewer = isRecord(data.viewer) ? data.viewer : {};
    return {
      accountId: stringOrNull(viewer.id),
      accountLabel: stringOrNull(viewer.name) ?? stringOrNull(viewer.email),
      workspaceId: null,
      workspaceLabel: null,
      permissions: [],
    };
  }

  private async revokeStoredToken(provider: AuthProviderId, stored: StoredAuthToken): Promise<void> {
    if (provider !== "linear") return;
    const body = new URLSearchParams({
      token: stored.accessToken,
      token_type_hint: "access_token",
    });
    await this.postForm(this.config.linear.revokeEndpoint, body);
  }

  private envToken(provider: AuthProviderId): { token: string; envVar: string } | null {
    if (provider === "github") {
      if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, envVar: "GITHUB_TOKEN" };
      if (process.env.GITHUB_PAT) return { token: process.env.GITHUB_PAT, envVar: "GITHUB_PAT" };
      return null;
    }
    return process.env.LINEAR_API_KEY ? { token: process.env.LINEAR_API_KEY, envVar: "LINEAR_API_KEY" } : null;
  }

  private async postForm(url: string, body: URLSearchParams): Promise<TokenResponse> {
    return this.fetchJson(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }) as Promise<TokenResponse>;
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchFn(url, init);
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message = isRecord(parsed) && typeof parsed.message === "string" ? parsed.message : `Auth request failed with HTTP ${response.status}.`;
      throw new Error(message);
    }
    return isRecord(parsed) ? parsed : {};
  }
}

export function createDefaultAuthManager(options: AuthManagerOptions = {}): AuthManager {
  return new AuthManager(options);
}

export function createMemoryAuthManager(options: Omit<AuthManagerOptions, "store"> = {}): AuthManager {
  return new AuthManager({ ...options, store: new MemoryTokenStore() });
}

function normalizeAuthConfig(config: AuthProviderConfig = {}): NormalizedAuthProviderConfig {
  return {
    github: {
      clientId: config.github?.clientId ?? process.env.SYMPHONIA_GITHUB_CLIENT_ID ?? null,
      apiEndpoint: config.github?.apiEndpoint ?? "https://api.github.com",
      deviceCodeEndpoint: config.github?.deviceCodeEndpoint ?? "https://github.com/login/device/code",
      tokenEndpoint: config.github?.tokenEndpoint ?? "https://github.com/login/oauth/access_token",
      requestedScopes: config.github?.requestedScopes ?? githubDefaultScopes,
    },
    linear: {
      clientId: config.linear?.clientId ?? process.env.SYMPHONIA_LINEAR_CLIENT_ID ?? null,
      clientSecret: config.linear?.clientSecret ?? process.env.SYMPHONIA_LINEAR_CLIENT_SECRET ?? null,
      authorizationEndpoint: config.linear?.authorizationEndpoint ?? "https://linear.app/oauth/authorize",
      tokenEndpoint: config.linear?.tokenEndpoint ?? "https://api.linear.app/oauth/token",
      revokeEndpoint: config.linear?.revokeEndpoint ?? "https://api.linear.app/oauth/revoke",
      apiEndpoint: config.linear?.apiEndpoint ?? "https://api.linear.app/graphql",
      redirectUri: config.linear?.redirectUri ?? process.env.SYMPHONIA_LINEAR_REDIRECT_URI ?? null,
      requestedScopes: config.linear?.requestedScopes ?? linearDefaultScopes,
    },
  };
}

function providerConfigState(provider: AuthProviderId, config: NormalizedAuthProviderConfig) {
  const selected = provider === "github" ? config.github : config.linear;
  return {
    clientIdConfigured: Boolean(selected.clientId),
    clientSecretConfigured: provider === "linear" && Boolean(config.linear.clientSecret),
  };
}

function connectionFromStored(
  record: StoredAuthToken,
  tokenStorage: IntegrationAuthConnection["tokenStorage"],
  configState: { clientIdConfigured: boolean; clientSecretConfigured: boolean },
): IntegrationAuthConnection {
  const expired = isExpired(record.tokenExpiresAt);
  return {
    id: record.id,
    provider: record.provider,
    method: record.method,
    status: expired ? "expired" : record.lastError ? "failed" : "connected",
    accountLabel: record.accountLabel,
    accountId: record.accountId,
    workspaceLabel: record.workspaceLabel,
    workspaceId: record.workspaceId,
    scopes: record.scopes,
    permissions: record.permissions,
    tokenStorage,
    tokenExpiresAt: record.tokenExpiresAt,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt,
    connectedAt: record.connectedAt,
    lastValidatedAt: record.lastValidatedAt,
    lastError: record.lastError,
    redactedSource: redactedTokenSource(record.credentialSource, record.accessToken),
    credentialSource: record.credentialSource,
    refreshSupported: record.refreshSupported,
    envTokenPresent: envTokenPresent(record.provider),
    clientIdConfigured: configState.clientIdConfigured,
    clientSecretConfigured: configState.clientSecretConfigured,
  };
}

function envConnection(
  provider: AuthProviderId,
  envVar: string,
  configState: { clientIdConfigured: boolean; clientSecretConfigured: boolean },
): IntegrationAuthConnection {
  return {
    id: `${provider}-env`,
    provider,
    method: "env_token",
    status: "connected",
    accountLabel: null,
    accountId: null,
    workspaceLabel: null,
    workspaceId: null,
    scopes: [],
    permissions: [],
    tokenStorage: "env",
    tokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    connectedAt: null,
    lastValidatedAt: null,
    lastError: null,
    redactedSource: `env:${envVar}:present`,
    credentialSource: "env",
    refreshSupported: false,
    envTokenPresent: true,
    clientIdConfigured: configState.clientIdConfigured,
    clientSecretConfigured: configState.clientSecretConfigured,
  };
}

function unavailableConnection(
  provider: AuthProviderId,
  configState: { clientIdConfigured: boolean; clientSecretConfigured: boolean },
): IntegrationAuthConnection {
  return {
    id: `${provider}-unavailable`,
    provider,
    method: "unavailable",
    status: "disconnected",
    accountLabel: null,
    accountId: null,
    workspaceLabel: null,
    workspaceId: null,
    scopes: [],
    permissions: [],
    tokenStorage: "none",
    tokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    connectedAt: null,
    lastValidatedAt: null,
    lastError: null,
    redactedSource: "unavailable",
    credentialSource: "unavailable",
    refreshSupported: false,
    envTokenPresent: envTokenPresent(provider),
    clientIdConfigured: configState.clientIdConfigured,
    clientSecretConfigured: configState.clientSecretConfigured,
  };
}

function unavailableStart(request: AuthStartRequest, message: string): AuthStartResult {
  return {
    authSessionId: `unavailable-${request.provider}`,
    provider: request.provider,
    method: request.method,
    status: "unavailable",
    authorizationUrl: null,
    verificationUri: null,
    userCode: null,
    expiresAt: null,
    pollIntervalMs: null,
    instructions: [message],
  };
}

function parseCallbackInput(input: unknown): {
  authSessionId: string | null;
  code: string;
  state: string;
  error: string | null;
} {
  if (!isRecord(input)) throw new Error("Callback payload must be an object.");
  const error = stringOrNull(input.error);
  return {
    authSessionId: stringOrNull(input.authSessionId),
    code: error ? "" : requireString(input.code, "code is required."),
    state: requireString(input.state, "state is required."),
    error,
  };
}

function githubHeaders(authorizationHeader: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "symphonia-local",
    Authorization: authorizationHeader,
  };
}

function secondsFromNow(value: unknown): string | null {
  const seconds = numberOr(value, 0);
  return seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function randomId(): string {
  return base64Url(randomBytes(18));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringFromMetadata(metadata: Record<string, unknown>, key: string): string | null {
  return stringOrNull(metadata[key]);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringOrNumber(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringOrNull(value);
}

function requireString(value: unknown, message: string): string {
  const result = stringOrNull(value);
  if (!result) throw new Error(message);
  return result;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpired(expiresAt: string | null): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now() + 60_000);
}

function envTokenPresent(provider: AuthProviderId): boolean {
  return provider === "github" ? Boolean(process.env.GITHUB_TOKEN || process.env.GITHUB_PAT) : Boolean(process.env.LINEAR_API_KEY);
}

function githubDeviceErrorMessage(error: string, description: unknown): string {
  const message = stringOrNull(description);
  if (message) return message;
  if (error === "authorization_pending") return "GitHub authorization is still pending.";
  if (error === "slow_down") return "GitHub asked Symphonia to slow down polling.";
  if (error === "expired_token" || error === "token_expired") return "GitHub device code expired.";
  if (error === "access_denied") return "GitHub authorization was denied.";
  if (error === "incorrect_client_credentials") return "GitHub client id is incorrect.";
  if (error === "device_flow_disabled") return "GitHub device flow is disabled for this app.";
  return error;
}
