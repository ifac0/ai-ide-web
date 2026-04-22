import {
  HttpEventType,
  type HttpDownloadProgressEvent,
  type HttpEvent,
} from "@angular/common/http";
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import {
  catchError,
  concatMap,
  filter,
  from,
  map,
  of,
  retry,
  scan,
  share,
  type Observable,
} from "rxjs";

import { AI_CLIENT_CONFIG } from "./ai.config";
import { LoggerService } from "../logging/logger.service";
import { createTokenBucketRateLimiter } from "../rate-limit/rate-limiter";

export interface AiStreamDelta {
  delta: string;
}

export interface AiStreamDone {
  done: true;
}

export type AiStreamEvent = AiStreamDelta | AiStreamDone;

interface SseChunk {
  data: string;
}

function isDownloadProgress(
  e: HttpEvent<unknown>,
): e is HttpDownloadProgressEvent {
  return e.type === HttpEventType.DownloadProgress;
}

function extractText(e: HttpDownloadProgressEvent): string {
  return typeof e.partialText === "string" ? e.partialText : "";
}

function parseSseChunks(buffer: string): { chunks: SseChunk[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const chunks = parts
    .map((p) => p.split("\n").filter((l) => l.startsWith("data: ")))
    .map((lines) => lines.map((l) => l.slice("data: ".length)).join("\n"))
    .filter((data) => data.length > 0)
    .map((data) => ({ data }));

  return { chunks, rest };
}

function toEvent(chunk: SseChunk): AiStreamEvent | null {
  if (chunk.data === "{}" || chunk.data === "") {
    return { done: true };
  }

  try {
    const parsed = JSON.parse(chunk.data) as Partial<AiStreamDelta>;
    if (typeof parsed.delta === "string") {
      return { delta: parsed.delta };
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: "root" })
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AI_CLIENT_CONFIG);
  private readonly logger = inject(LoggerService);
  private readonly limiter = createTokenBucketRateLimiter({
    capacity: 3,
    refillPerSecond: 0.5,
  });

  streamCompletion(
    prompt: string,
    options?: { mock?: boolean },
  ): Observable<AiStreamEvent> {
    if (!this.limiter.tryRemoveToken()) {
      this.logger.warn("ai.stream.rate_limited");
      return of<AiStreamEvent>({ done: true });
    }

    const mockEnabled = options?.mock ?? this.config.defaultMockEnabled;
    const headers = mockEnabled ? { "x-mock-ai": "1" } : undefined;
    const requestId = crypto.randomUUID();

    const events$ = this.http.request("POST", this.config.streamUrl, {
      body: { prompt, requestId },
      observe: "events",
      responseType: "text",
      reportProgress: true,
      headers,
    });

    return events$.pipe(
      filter(isDownloadProgress),
      map(extractText),
      scan(
        (acc, next) => {
          const parsed = parseSseChunks(acc.buffer + next);
          return { buffer: parsed.rest, chunks: parsed.chunks };
        },
        { buffer: "", chunks: [] as SseChunk[] },
      ),
      concatMap((s) => from(s.chunks)),
      map(toEvent),
      filter((e): e is AiStreamEvent => e !== null),
      retry({ count: 2, delay: 250 }),
      catchError((err: unknown) => {
        this.logger.error("ai.stream.error", { requestId, err });
        return of<AiStreamEvent>({ done: true });
      }),
      share(),
    );
  }
}
