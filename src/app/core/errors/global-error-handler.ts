import { inject, Injectable, NgZone, type ErrorHandler } from "@angular/core";

import { TelemetryService } from "../telemetry/telemetry.service";

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly zone = inject(NgZone);
  private readonly telemetry = inject(TelemetryService);

  handleError(error: unknown): void {
    this.zone.run(() => {
      console.error(error);
      this.telemetry.captureError(error);
    });
  }
}
