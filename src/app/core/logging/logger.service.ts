import { Injectable } from "@angular/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  at: string;
  message: string;
  context?: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

@Injectable({ providedIn: "root" })
export class LoggerService {
  debug(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: "debug", at: nowIso(), message, context });
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: "info", at: nowIso(), message, context });
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: "warn", at: nowIso(), message, context });
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: "error", at: nowIso(), message, context });
  }

  private emit(evt: LogEvent): void {
    if (evt.level === "error") {
      console.error(evt);
      return;
    }
    if (evt.level === "warn") {
      console.warn(evt);
      return;
    }
    console.log(evt);
  }
}
