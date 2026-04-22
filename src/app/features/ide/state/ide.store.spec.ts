import { TestBed } from "@angular/core/testing";
import { Subject } from "rxjs";

import { IdeStore } from "./ide.store";
import { AI_CLIENT_CONFIG } from "../../../core/ai/ai.config";
import { AiService, type AiStreamEvent } from "../../../core/ai/ai.service";

describe("IdeStore", () => {
  it("opens a scratch tab and activates it", () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AI_CLIENT_CONFIG,
          useValue: { streamUrl: "/api/ai/stream", defaultMockEnabled: true },
        },
      ],
    });
    const store = TestBed.inject(IdeStore);

    const beforeTabs = store.tabs();
    store.openScratchTab();

    expect(store.tabs().length).toBe(beforeTabs.length + 1);
    expect(store.activeTabId()).not.toBeNull();
    expect(store.activeTab()).not.toBeNull();
  });

  it("opens a file from the explorer into a tab", () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AI_CLIENT_CONFIG,
          useValue: { streamUrl: "/api/ai/stream", defaultMockEnabled: true },
        },
      ],
    });
    const store = TestBed.inject(IdeStore);

    const before = store.tabs().length;
    store.openFile("/README.md");

    expect(store.tabs().length).toBe(before + 1);
    expect(store.activeTab()?.title).toBe("README.md");
  });

  it("updates active tab value via editorValueChanged rxMethod", () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AI_CLIENT_CONFIG,
          useValue: { streamUrl: "/api/ai/stream", defaultMockEnabled: true },
        },
      ],
    });
    const store = TestBed.inject(IdeStore);

    const activeBefore = store.activeTab();
    expect(activeBefore).not.toBeNull();

    store.editorValueChanged("const x = 1;\n");

    const activeAfter = store.activeTab();
    expect(activeAfter).not.toBeNull();
    expect(activeAfter?.value).toBe("const x = 1;\n");
  });

  it("streams AI events and updates output and streaming state", async () => {
    const aiEvents$ = new Subject<AiStreamEvent>();
    const aiService: Pick<AiService, "streamCompletion"> = {
      streamCompletion: () => aiEvents$.asObservable(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AiService, useValue: aiService },
        {
          provide: AI_CLIENT_CONFIG,
          useValue: { streamUrl: "/api/ai/stream", defaultMockEnabled: true },
        },
      ],
    });

    const store = TestBed.inject(IdeStore);
    store.streamPrompt("hello");

    expect(store.ai().streaming).toBe(true);
    expect(store.ai().output).toBe("");

    aiEvents$.next({ delta: "A" });
    aiEvents$.next({ delta: "B" });

    expect(store.ai().output).toBe("AB");

    aiEvents$.next({ done: true });

    await Promise.resolve();

    expect(store.ai().streaming).toBe(false);
  });
});
