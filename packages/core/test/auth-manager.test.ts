import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuthManager,
  AuthFetch,
  createMemoryAuthManager,
  EncryptedFileTokenStore,
  makeStoredAuthToken,
  MemoryTokenStore,
} from "../src/index";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PAT;
  delete process.env.LINEAR_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("auth token storage", () => {
  it("stores and deletes tokens in memory with redacted connection metadata", () => {
    const store = new MemoryTokenStore();
    store.set(
      makeStoredAuthToken({
        provider: "github",
        method: "manual_token",
        credentialSource: "manual",
        accessToken: "ghp_secret_value",
        refreshToken: null,
        scopes: ["repo"],
        permissions: [],
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        accountLabel: "octo",
        accountId: "1",
        workspaceLabel: null,
        workspaceId: null,
        lastValidatedAt: null,
        lastError: null,
        refreshSupported: false,
      }),
    );

    expect(store.get("github")?.accessToken).toBe("ghp_secret_value");
    store.delete("github");
    expect(store.get("github")).toBeNull();
  });

  it("encrypts local file contents without writing token plaintext", () => {
    const dir = mkdtempSync(join(tmpdir(), "symphonia-auth-"));
    try {
      const store = new EncryptedFileTokenStore(join(dir, "auth.enc.json"));
      store.set(
        makeStoredAuthToken({
          provider: "linear",
          method: "manual_token",
          credentialSource: "manual",
          accessToken: "lin_secret_value",
          refreshToken: null,
          scopes: ["read"],
          permissions: [],
          tokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          accountLabel: "Linear User",
          accountId: "user-1",
          workspaceLabel: null,
          workspaceId: null,
          lastValidatedAt: null,
          lastError: null,
          refreshSupported: false,
        }),
      );

      expect(readFileSync(join(dir, "auth.enc.json"), "utf8")).not.toContain("lin_secret_value");
      expect(new EncryptedFileTokenStore(join(dir, "auth.enc.json")).get("linear")?.accessToken).toBe("lin_secret_value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AuthManager", () => {
  it("handles GitHub device flow pending, slow_down, success, validation, and redaction", async () => {
    let tokenPolls = 0;
    const fetch: AuthFetch = async (url) => {
      if (url.endsWith("/device/code")) {
        return json({
          device_code: "device-1",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url.endsWith("/access_token")) {
        tokenPolls += 1;
        if (tokenPolls === 1) return json({ error: "authorization_pending" });
        if (tokenPolls === 2) return json({ error: "slow_down" });
        return json({
          access_token: "ghu_secret_token",
          refresh_token: "ghr_refresh_token",
          expires_in: 28800,
          refresh_token_expires_in: 15_552_000,
          scope: "repo",
        });
      }
      if (url.endsWith("/user")) return json({ id: 123, login: "octocat" });
      return json({}, 404);
    };
    const manager = createMemoryAuthManager({
      fetch,
      config: {
        github: {
          clientId: "client-1",
          deviceCodeEndpoint: "https://github.test/device/code",
          tokenEndpoint: "https://github.test/access_token",
          apiEndpoint: "https://api.github.test",
        },
      },
    });

    const start = await manager.startAuth({
      provider: "github",
      method: "oauth_device",
      requestedScopes: ["repo"],
      redirectMode: "device",
      repositoryPath: null,
      metadata: {},
    });
    expect(start.userCode).toBe("ABCD-1234");
    expect((await manager.pollAuth("github", start.authSessionId)).status).toBe("pending_user");
    expect((await manager.pollAuth("github", start.authSessionId)).error).toContain("slow down");
    const completed = await manager.pollAuth("github", start.authSessionId);
    expect(completed.status).toBe("connected");

    const connection = manager.getConnection("github");
    expect(connection.accountLabel).toBe("octocat");
    expect(connection.redactedSource).not.toContain("ghu_secret_token");
  });

  it("handles Linear PKCE callback state mismatch and success", async () => {
    const fetch: AuthFetch = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return json({ access_token: "lin_oauth_secret", refresh_token: "lin_refresh", expires_in: 86399, scope: "read" });
      }
      if (url.endsWith("/graphql")) {
        return json({ data: { viewer: { id: "user-1", name: "Linear User", email: "linear@example.com" } } });
      }
      return json({}, 404);
    };
    const manager = createMemoryAuthManager({
      fetch,
      config: {
        linear: {
          clientId: "linear-client",
          authorizationEndpoint: "https://linear.test/oauth/authorize",
          tokenEndpoint: "https://api.linear.test/oauth/token",
          apiEndpoint: "https://api.linear.test/graphql",
          redirectUri: "http://127.0.0.1:4100/auth/linear/callback",
        },
      },
    });

    const start = await manager.startAuth({
      provider: "linear",
      method: "oauth_pkce",
      requestedScopes: ["read"],
      redirectMode: "loopback",
      repositoryPath: null,
      metadata: {},
    });
    const state = new URL(start.authorizationUrl ?? "").searchParams.get("state");
    expect(state).toBeTruthy();
    const mismatch = await manager.completeCallback("linear", {
      authSessionId: start.authSessionId,
      code: "code-1",
      state: "wrong",
    });
    expect(mismatch.status).toBe("failed");

    const retry = await manager.startAuth({
      provider: "linear",
      method: "oauth_pkce",
      requestedScopes: ["read"],
      redirectMode: "loopback",
      repositoryPath: null,
      metadata: {},
    });
    const retryState = new URL(retry.authorizationUrl ?? "").searchParams.get("state");
    const success = await manager.completeCallback("linear", {
      authSessionId: retry.authSessionId,
      code: "code-2",
      state: retryState,
    });
    expect(success.status).toBe("connected");
    expect(manager.getConnection("linear").accountLabel).toBe("Linear User");
    expect(manager.getConnection("linear").redactedSource).not.toContain("lin_oauth_secret");
  });

  it("supports manual token mode and env fallback without exposing raw tokens", async () => {
    process.env.GITHUB_TOKEN = "ghp_env_secret";
    const fetch: AuthFetch = async (url) => {
      if (url.endsWith("/user")) return json({ id: 1, login: "env-user" });
      if (url.endsWith("/graphql")) return json({ data: { viewer: { id: "linear-user", name: "Linear User" } } });
      return json({}, 404);
    };
    const manager = createMemoryAuthManager({
      fetch,
      config: {
        github: { apiEndpoint: "https://api.github.test" },
        linear: { apiEndpoint: "https://api.linear.test/graphql" },
      },
    });

    const envValidation = await manager.validateConnection("github");
    expect(envValidation.credentialSource).toBe("env");
    expect(manager.getConnection("github").redactedSource).toBe("env:GITHUB_TOKEN:present");

    await manager.startAuth({
      provider: "linear",
      method: "manual_token",
      requestedScopes: [],
      redirectMode: "manual",
      repositoryPath: null,
      metadata: { token: "lin_manual_secret" },
    });
    const connection = manager.getConnection("linear");
    expect(connection.credentialSource).toBe("manual");
    expect(connection.redactedSource).not.toContain("lin_manual_secret");
  });

  it.each([
    ["expired_token", "expired", "expired"],
    ["access_denied", "failed", "denied"],
  ])("handles GitHub device flow terminal error %s", async (errorCode, expectedStatus, expectedMessage) => {
    const fetch: AuthFetch = async (url) => {
      if (url.endsWith("/device/code")) {
        return json({
          device_code: "device-1",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url.endsWith("/access_token")) return json({ error: errorCode });
      return json({}, 404);
    };
    const manager = createMemoryAuthManager({
      fetch,
      config: {
        github: {
          clientId: "client-1",
          deviceCodeEndpoint: "https://github.test/device/code",
          tokenEndpoint: "https://github.test/access_token",
          apiEndpoint: "https://api.github.test",
        },
      },
    });

    const start = await manager.startAuth({
      provider: "github",
      method: "oauth_device",
      requestedScopes: ["repo"],
      redirectMode: "device",
      repositoryPath: null,
      metadata: {},
    });
    const result = await manager.pollAuth("github", start.authSessionId);

    expect(result.status).toBe(expectedStatus);
    expect(result.error).toContain(expectedMessage);
    expect(JSON.stringify(result)).not.toContain("device-1");
  });

  it("refreshes expiring GitHub tokens without leaking refresh token values", async () => {
    const store = new MemoryTokenStore();
    store.set(
      makeStoredAuthToken({
        provider: "github",
        method: "oauth_device",
        credentialSource: "connected",
        accessToken: "ghu_old_secret",
        refreshToken: "ghr_refresh_secret",
        scopes: ["repo"],
        permissions: [],
        tokenExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        accountLabel: "octo-old",
        accountId: "1",
        workspaceLabel: null,
        workspaceId: null,
        lastValidatedAt: null,
        lastError: null,
        refreshSupported: true,
      }),
    );
    const fetch: AuthFetch = async (url) => {
      if (url.endsWith("/access_token")) {
        return json({ access_token: "ghu_new_secret", refresh_token: "ghr_new_refresh_secret", expires_in: 28800, scope: "repo" });
      }
      if (url.endsWith("/user")) return json({ id: 1, login: "octo-new" });
      return json({}, 404);
    };
    const manager = new AuthManager({
      store,
      fetch,
      config: {
        github: {
          clientId: "client-1",
          tokenEndpoint: "https://github.test/access_token",
          apiEndpoint: "https://api.github.test",
        },
      },
    });

    const refreshed = await manager.refreshConnection("github");

    expect(refreshed.status).toBe("connected");
    expect(manager.resolveCredential("github")?.token).toBe("ghu_new_secret");
    expect(JSON.stringify(refreshed)).not.toContain("ghr_new_refresh_secret");
  });

  it("marks refresh failures expired and keeps env fallback unavailable until configured", async () => {
    const store = new MemoryTokenStore();
    store.set(
      makeStoredAuthToken({
        provider: "github",
        method: "oauth_device",
        credentialSource: "connected",
        accessToken: "ghu_old_secret",
        refreshToken: "ghr_bad_refresh_secret",
        scopes: ["repo"],
        permissions: [],
        tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        accountLabel: "octo-old",
        accountId: "1",
        workspaceLabel: null,
        workspaceId: null,
        lastValidatedAt: null,
        lastError: null,
        refreshSupported: true,
      }),
    );
    const fetch: AuthFetch = async (url) => {
      if (url.endsWith("/access_token")) return json({ error: "bad_refresh_token" });
      return json({}, 404);
    };
    const manager = new AuthManager({
      store,
      fetch,
      config: {
        github: {
          clientId: "client-1",
          tokenEndpoint: "https://github.test/access_token",
          apiEndpoint: "https://api.github.test",
        },
      },
    });

    const refreshed = await manager.refreshConnection("github");

    expect(refreshed.status).toBe("expired");
    expect(refreshed.error).toContain("bad_refresh_token");
    expect(manager.resolveCredential("github")).toBeNull();
    expect(JSON.stringify(refreshed)).not.toContain("ghr_bad_refresh_secret");
  });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
