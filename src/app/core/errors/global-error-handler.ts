import { inject, Injectable, NgZone, type ErrorHandler } from "@angular/core";

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly zone = inject(NgZone);

  handleError(error: unknown): void {
    this.zone.run(() => {
      console.error(error);
    });
  }
}
