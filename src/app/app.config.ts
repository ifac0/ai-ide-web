import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from "@angular/common/http";
import {
  isDevMode,
  provideZoneChangeDetection,
  type ApplicationConfig,
} from "@angular/core";
import { provideAnimations } from "@angular/platform-browser/animations";
import { provideRouter, withInMemoryScrolling } from "@angular/router";
import { provideServiceWorker } from "@angular/service-worker";

import { routes } from "./app.routes";
import { AI_CLIENT_CONFIG } from "./core/ai/ai.config";
import { provideGlobalErrorHandler } from "./core/errors/provide-global-error-handler";
import { authInterceptor } from "./core/http/interceptors/auth.interceptor";
import { mockAiStreamInterceptor } from "./core/http/interceptors/mock-ai-stream.interceptor";
import { TELEMETRY_CONFIG } from "./core/telemetry/telemetry.config";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideAnimations(),
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: "enabled" }),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([mockAiStreamInterceptor, authInterceptor]),
    ),
    {
      provide: AI_CLIENT_CONFIG,
      useValue: { streamUrl: "/api/ai/stream", defaultMockEnabled: true },
    },
    {
      provide: TELEMETRY_CONFIG,
      useValue: {
        enabled: false,
        endpointUrl: "/api/telemetry",
        sampleRate: 1,
      },
    },
    ...provideGlobalErrorHandler(),
    provideServiceWorker("ngsw-worker.js", {
      enabled: !isDevMode(),
      registrationStrategy: "registerWhenStable:30000",
    }),
  ],
};
