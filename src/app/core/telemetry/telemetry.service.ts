import { inject, Injectable } from "@angular/core";

import { TELEMETRY_CONFIG } from "./telemetry.config";
import { LoggerService } from "../logging/logger.service";
import { createTokenBucketRateLimiter } from "../rate-limit/rate-limiter";

import type { TelemetryErrorEvent } from "../api/contracts";

export interface ErrorTelemetryEvent {
  type: "error";
  at: string;
  message: string;
  name?: string;
  stack?: string;
  url?: string;
  userAgent?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function shouldSample(rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

@Injectable({ providedIn: "root" })
export class TelemetryService {
  private readonly config = inject(TELEMETRY_CONFIG);
  private readonly logger = inject(LoggerService);
  private readonly limiter = createTokenBucketRateLimiter({
    capacity: 10,
    refillPerSecond: 1,
  });

  captureError(input: unknown): void {
    if (!this.config.enabled) return;
    if (!shouldSample(this.config.sampleRate)) return;
    if (!this.limiter.tryRemoveToken()) {
      this.logger.warn("telemetry.rate_limited");
      return;
    }

    const event = this.toErrorEvent(input);
    this.send(event);
  }

  private toErrorEvent(input: unknown): TelemetryErrorEvent {
    const normalized = this.normalizeError(input);
    return {
      type: "error",
      at: nowIso(),
      message: normalized.message,
      name: normalized.name,
      stack: normalized.stack,
      url: typeof location !== "undefined" ? location.href : undefined,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    };
  }

  private normalizeError(input: unknown): {
    message: string;
    name?: string;
    stack?: string;
  } {
    if (input instanceof Error) {
      return { message: input.message, name: input.name, stack: input.stack };
    }
    if (typeof input === "string") {
      return { message: input };
    }
    try {
      return { message: JSON.stringify(input) };
    } catch {
      return { message: "Unknown error" };
    }
  }

  private send(event: ErrorTelemetryEvent): void {
    const body = JSON.stringify(event);
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const ok = navigator.sendBeacon(this.config.endpointUrl, body);
      if (ok) return;
    }

    void fetch(this.config.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  }
}
