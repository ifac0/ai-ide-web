import {
  HttpClient,
  HttpEventType,
  type HttpDownloadProgressEvent,
  type HttpEvent,
} from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import { Subject, firstValueFrom, take, toArray } from "rxjs";

import { AiService } from "./ai.service";

describe("AiService", () => {
  function progress(partialText: string): HttpDownloadProgressEvent {
    return {
      type: HttpEventType.DownloadProgress,
      loaded: partialText.length,
      partialText,
    };
  }

  it("emits deltas from SSE data frames in order", async () => {
    const events$ = new Subject<HttpEvent<string>>();
    const http: Pick<HttpClient, "request"> = {
      request: () =>
        events$.asObservable() as unknown as ReturnType<HttpClient["request"]>,
    };

    TestBed.configureTestingModule({
      providers: [AiService, { provide: HttpClient, useValue: http }],
    });

    const service = TestBed.inject(AiService);

    const resultsPromise = firstValueFrom(
      service.streamCompletion("x", { mock: false }).pipe(take(3), toArray()),
    );

    events$.next(progress('event: message\ndata: {"delta":"A"}\n\n'));
    events$.next(progress('event: message\ndata: {"delta":"B"}\n\n'));
    events$.next(progress('event: message\ndata: {"delta":"C"}\n\n'));

    const results = await resultsPromise;

    expect(results).toEqual([{ delta: "A" }, { delta: "B" }, { delta: "C" }]);
  });

  it("handles split frames across multiple progress events", async () => {
    const events$ = new Subject<HttpEvent<string>>();
    const http: Pick<HttpClient, "request"> = {
      request: () =>
        events$.asObservable() as unknown as ReturnType<HttpClient["request"]>,
    };

    TestBed.configureTestingModule({
      providers: [AiService, { provide: HttpClient, useValue: http }],
    });

    const service = TestBed.inject(AiService);

    const resultsPromise = firstValueFrom(
      service.streamCompletion("x", { mock: false }).pipe(take(1), toArray()),
    );

    events$.next(progress('event: message\ndata: {"delta":"Hel'));
    events$.next(progress('lo"}\n\n'));

    const results = await resultsPromise;

    expect(results).toEqual([{ delta: "Hello" }]);
  });
});
