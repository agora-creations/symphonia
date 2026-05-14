import { z } from "zod";

export const ProviderIdSchema = z.enum(["codex", "claude", "cursor"]);
export const TrackerKindSchema = z.enum(["linear"]);

const nullablePath = z.string().min(1).nullable();
const envVarName = z
  .string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]*$/u, "Use an environment variable name such as LINEAR_API_KEY.");

export const DesktopSettingsSchema = z.object({
  firstRunCompleted: z.boolean(),
  daemonPortPreference: z.number().int().min(1024).max(65535).nullable(),
  daemonAutoStart: z.boolean(),
  repositoryPath: nullablePath,
  workflowPath: nullablePath,
  workspaceRoot: nullablePath,
  databasePath: nullablePath,
  defaultTrackerKind: TrackerKindSchema,
  defaultProviderId: ProviderIdSchema,
  githubEnabled: z.boolean(),
  githubTokenEnvVar: envVarName,
  linearEnabled: z.boolean(),
  linearApiKeyEnvVar: envVarName,
  cleanupDryRun: z.boolean(),
  cleanupEnabled: z.boolean(),
  lastOpenedAt: z.string().datetime({ offset: true }).nullable(),
  recentRepositories: z.array(z.string().min(1)).max(12),
});
export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

export const DesktopSettingsUpdateSchema = DesktopSettingsSchema.partial().strict();
export type DesktopSettingsUpdate = z.infer<typeof DesktopSettingsUpdateSchema>;

export const DesktopSettingsValidationResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type DesktopSettingsValidationResult = z.infer<typeof DesktopSettingsValidationResultSchema>;

export const ProcessStateSchema = z.enum(["stopped", "starting", "running", "stopping", "crashed", "unavailable"]);
export type ProcessState = z.infer<typeof ProcessStateSchema>;

export const ManagedProcessStatusSchema = z.object({
  state: ProcessStateSchema,
  pid: z.number().int().positive().nullable(),
  port: z.number().int().positive().nullable(),
  url: z.string().url().nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  stoppedAt: z.string().datetime({ offset: true }).nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  error: z.string().nullable(),
});
export type ManagedProcessStatus = z.infer<typeof ManagedProcessStatusSchema>;

export const DesktopStatusSchema = z.object({
  appVersion: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  platform: z.string(),
  startedAt: z.string().datetime({ offset: true }),
  settingsPath: z.string(),
  settings: DesktopSettingsSchema,
  daemon: ManagedProcessStatusSchema,
  web: ManagedProcessStatusSchema,
});
export type DesktopStatus = z.infer<typeof DesktopStatusSchema>;

export const DesktopDiagnosticsSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  desktop: DesktopStatusSchema,
  daemonLogs: z.array(z.string()),
  webLogs: z.array(z.string()),
  desktopLogs: z.array(z.string()),
  redactedSettings: z.record(z.unknown()),
});
export type DesktopDiagnostics = z.infer<typeof DesktopDiagnosticsSchema>;

export const ChoosePathRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  defaultPath: z.string().min(1).optional(),
});
export type ChoosePathRequest = z.infer<typeof ChoosePathRequestSchema>;

export const PathResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().min(1).nullable(),
});
export type PathResult = z.infer<typeof PathResultSchema>;

export const ExternalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  }, "Only http(s) URLs can be opened externally.");

export const RevealPathRequestSchema = z.object({
  path: z.string().min(1),
});

export const CreateStarterWorkflowRequestSchema = z.object({
  repositoryPath: z.string().min(1),
});
export type CreateStarterWorkflowRequest = z.infer<typeof CreateStarterWorkflowRequestSchema>;

export const IpcChannelSchema = z.enum([
  "desktop:getStatus",
  "desktop:getSettings",
  "desktop:updateSettings",
  "desktop:resetSettings",
  "desktop:validateSettings",
  "desktop:exportSettingsRedacted",
  "desktop:revealSettingsFile",
  "desktop:getDiagnostics",
  "desktop:getDaemonStatus",
  "desktop:restartDaemon",
  "desktop:getDaemonLogs",
  "desktop:getWebStatus",
  "desktop:restartWeb",
  "desktop:getWebLogs",
  "desktop:chooseDirectory",
  "desktop:chooseFile",
  "desktop:openExternalLink",
  "desktop:revealPathInFileManager",
  "desktop:createStarterWorkflow",
]);
export type IpcChannel = z.infer<typeof IpcChannelSchema>;

export const desktopIpcChannels = IpcChannelSchema.options;
