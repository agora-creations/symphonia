export class ProviderRunCancelledError extends Error {
  constructor() {
    super("Provider run was cancelled.");
    this.name = "ProviderRunCancelledError";
  }
}
