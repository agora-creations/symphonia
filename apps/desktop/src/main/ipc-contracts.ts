import {
  ChoosePathRequestSchema,
  CreateStarterWorkflowRequestSchema,
  DesktopSettingsUpdateSchema,
  ExternalUrlSchema,
  IpcChannelSchema,
  RevealPathRequestSchema,
} from "../shared/schemas.js";
import type { ChoosePathRequest, DesktopSettingsUpdate, IpcChannel } from "../shared/schemas.js";

export function parseIpcChannel(channel: string): IpcChannel {
  return IpcChannelSchema.parse(channel);
}

export function parseSettingsUpdate(input: unknown): DesktopSettingsUpdate {
  return DesktopSettingsUpdateSchema.parse(input);
}

export function parseChoosePathRequest(input: unknown): ChoosePathRequest {
  return ChoosePathRequestSchema.parse(input ?? {});
}

export function parseExternalUrl(input: unknown): string {
  return ExternalUrlSchema.parse(input);
}

export function parseRevealPath(input: unknown): string {
  return RevealPathRequestSchema.parse(input).path;
}

export function parseStarterWorkflowPath(input: unknown): string {
  return CreateStarterWorkflowRequestSchema.parse(input).repositoryPath;
}

export function isLocalRendererUrl(url: string, allowedOrigins: string[]): boolean {
  if (url === "about:blank") return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return false;
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}
