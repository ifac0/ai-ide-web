import { inject, Injectable, NgZone, type ErrorHandler } from "@angular/core";

import { LoggerService } from "../logging/logger.service";
import { TelemetryService } from "../telemetry/telemetry.service";

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly zone = inject(NgZone);
  private readonly telemetry = inject(TelemetryService);
  private readonly logger = inject(LoggerService);

  handleError(error: unknown): void {
    this.zone.run(() => {
      this.logger.error("app.unhandled_error", { error });
      this.telemetry.captureError(error);
    });
  }
}
