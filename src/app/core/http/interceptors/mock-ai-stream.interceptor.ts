import {
  HttpEventType,
  type HttpDownloadProgressEvent,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
  HttpResponse,
} from "@angular/common/http";
import { concat, of, timer, type Observable } from "rxjs";
import { map } from "rxjs/operators";

interface MockChunk {
  delayMs: number;
  text: string;
}

function isMockEnabled(req: HttpRequest<unknown>): boolean {
  return req.headers.get("x-mock-ai") === "1";
}

function isMockTarget(req: HttpRequest<unknown>): boolean {
  return req.url.includes("/api/ai/stream");
}

function toProgressEvent(text: string): HttpDownloadProgressEvent {
  return {
    type: HttpEventType.DownloadProgress,
    loaded: text.length,
    total: undefined,
    partialText: text,
  };
}

function buildMockStream(): Observable<HttpEvent<string>> {
  const chunks: MockChunk[] = [
    { delayMs: 50, text: 'event: message\ndata: {"delta":"Hello"}\n\n' },
    { delayMs: 120, text: 'event: message\ndata: {"delta":" from"}\n\n' },
    { delayMs: 120, text: 'event: message\ndata: {"delta":" mock"}\n\n' },
    { delayMs: 120, text: 'event: message\ndata: {"delta":" SSE"}\n\n' },
    { delayMs: 120, text: "event: done\ndata: {}\n\n" },
  ];

  const progress$ = concat(
    ...chunks.map((c) =>
      timer(c.delayMs).pipe(
        map(() => toProgressEvent(c.text) as HttpEvent<string>),
      ),
    ),
  );

  const response = new HttpResponse<string>({
    status: 200,
    body: chunks.map((c) => c.text).join(""),
    headers: undefined,
    statusText: "OK",
    url: "/api/ai/stream",
  });

  return concat(
    of({ type: HttpEventType.Sent } as HttpEvent<string>),
    progress$,
    of(response),
  );
}

export const mockAiStreamInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  if (!isMockEnabled(req) || !isMockTarget(req)) {
    return next(req);
  }

  return buildMockStream();
};
