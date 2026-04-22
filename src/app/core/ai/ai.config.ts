import { InjectionToken } from "@angular/core";

export interface AiClientConfig {
  streamUrl: string;
  defaultMockEnabled: boolean;
}

export const AI_CLIENT_CONFIG = new InjectionToken<AiClientConfig>(
  "AI_CLIENT_CONFIG",
);
