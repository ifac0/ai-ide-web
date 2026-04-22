import { ErrorHandler, type Provider } from "@angular/core";

import { GlobalErrorHandler } from "./global-error-handler";

export function provideGlobalErrorHandler(): Provider[] {
  return [{ provide: ErrorHandler, useClass: GlobalErrorHandler }];
}
