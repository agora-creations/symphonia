import { isDaemonEntrypoint, startDaemon } from "./daemon.js";

if (isDaemonEntrypoint(import.meta.url)) {
  startDaemon();
}

export * from "./daemon.js";
