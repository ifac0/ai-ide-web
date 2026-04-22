import { inject, Injectable, NgZone, type ErrorHandler } from "@angular/core";

import { LoggerService } from "../logging/logger.service";
import { TelemetryService } from "../telemetry/telemetry.service";

function normalizeErrorMessage(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return "Unknown error";
  }
}

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly zone = inject(NgZone);
  private readonly telemetry = inject(TelemetryService);
  private readonly logger = inject(LoggerService);

  handleError(error: unknown): void {
    this.zone.run(() => {
      this.logger.error("app.unhandled_error", { error });
      this.telemetry.captureError(error);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("app-error", {
            detail: { message: normalizeErrorMessage(error) },
          }),
        );
      }
    });
  }
}
