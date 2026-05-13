import { createServer } from "node:net";

export async function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function findAvailablePort(preferredPort: number, host = "127.0.0.1", maxAttempts = 50): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) break;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  throw new Error(`No available localhost port found starting at ${preferredPort}.`);
}
