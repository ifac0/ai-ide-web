export interface AiStreamRequest {
  prompt: string;
  requestId: string;
}

export interface AiStreamDeltaEvent {
  delta: string;
}

export interface AiStreamDoneEvent {
  done: true;
}

export type AiStreamEvent = AiStreamDeltaEvent | AiStreamDoneEvent;

export interface TelemetryErrorEvent {
  type: "error";
  at: string;
  message: string;
  name?: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  requestId?: string;
}
