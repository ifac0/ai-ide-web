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
  tap,
  Observable,
} from "rxjs";

import { AI_CLIENT_CONFIG } from "./ai.config";
import { LoggerService } from "../logging/logger.service";
import { PerfService } from "../observability/perf.service";
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
  private readonly perf = inject(PerfService);
  private readonly limiter = createTokenBucketRateLimiter({
    capacity: 3,
    refillPerSecond: 0.5,
  });

  private currentAbort: AbortController | null = null;

  cancelActiveRequest(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
  }

  streamCompletion(
    prompt: string,
    options?: { mock?: boolean; requestId?: string },
  ): Observable<AiStreamEvent> {
    if (!this.limiter.tryRemoveToken()) {
      this.logger.warn("ai.stream.rate_limited");
      return of<AiStreamEvent>({ done: true });
    }

    const mockEnabled = options?.mock ?? this.config.defaultMockEnabled;
    const headers = mockEnabled ? { "x-mock-ai": "1" } : undefined;
    const requestId = options?.requestId ?? crypto.randomUUID();
    this.perf.mark(`ai.stream.start.${requestId}`);

    const http$ = this.http
      .request("POST", this.config.streamUrl, {
        body: { prompt, requestId },
        observe: "events",
        responseType: "text",
        reportProgress: true,
        headers,
      })
      .pipe(
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
      );

    const fetch$ = new Observable<AiStreamEvent>((subscriber) => {
      const controller = new AbortController();
      this.currentAbort = controller;

      const run = async (): Promise<void> => {
        try {
          const res = await fetch(this.config.streamUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt, requestId }),
            signal: controller.signal,
          });

          if (!res.ok) {
            subscriber.next({ done: true });
            subscriber.complete();
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) {
            subscriber.next({ done: true });
            subscriber.complete();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let doneReading = false;
          while (!doneReading) {
            const { done, value } = await reader.read();
            if (done) {
              doneReading = true;
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseChunks(buffer);
            buffer = parsed.rest;
            for (const chunk of parsed.chunks) {
              const evt = toEvent(chunk);
              if (evt) subscriber.next(evt);
            }
          }

          subscriber.next({ done: true });
          subscriber.complete();
        } catch (err) {
          if (controller.signal.aborted) {
            subscriber.next({ done: true });
            subscriber.complete();
            return;
          }
          subscriber.error(err);
        } finally {
          if (this.currentAbort === controller) {
            this.currentAbort = null;
          }
        }
      };

      void run();
      return () => controller.abort();
    });

    const canFetch = typeof fetch === "function";
    const source$ = mockEnabled ? http$ : canFetch ? fetch$ : http$;

    return source$.pipe(
      retry({ count: 2, delay: 250 }),
      catchError((err: unknown) => {
        this.logger.error("ai.stream.error", { requestId, err });
        return of<AiStreamEvent>({ done: true });
      }),
      tap({
        complete: () => {
          this.perf.mark(`ai.stream.end.${requestId}`);
        },
      }),
      share(),
    );
  }
}
