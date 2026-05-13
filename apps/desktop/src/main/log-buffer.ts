export class LogBuffer {
  private readonly lines: string[] = [];

  constructor(private readonly maxLines = 400) {}

  append(line: string): void {
    const normalized = line.replace(/\r?\n$/u, "");
    if (!normalized) return;
    this.lines.push(normalized);
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
  }

  appendChunk(prefix: string, chunk: Buffer | string): void {
    const text = String(chunk);
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim().length > 0) this.append(`${prefix} ${redactSecrets(line)}`);
    }
  }

  snapshot(): string[] {
    return [...this.lines];
  }

  clear(): void {
    this.lines.splice(0, this.lines.length);
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/((?:github|linear|cursor|anthropic|openai)[_ -]?(?:token|key|pat)\s*[=:]\s*)[^\s]+/giu, "$1[REDACTED]")
    .replace(/(GITHUB_TOKEN|GITHUB_PAT|LINEAR_API_KEY|CURSOR_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=\S+/gu, "$1=[REDACTED]");
}
