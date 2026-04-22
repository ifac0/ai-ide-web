import { InjectionToken } from "@angular/core";

export interface TelemetryConfig {
  enabled: boolean;
  endpointUrl: string;
  sampleRate: number;
}

export const TELEMETRY_CONFIG = new InjectionToken<TelemetryConfig>(
  "TELEMETRY_CONFIG",
);
