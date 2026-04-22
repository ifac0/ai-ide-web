import { computed, inject } from "@angular/core";
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { filter, finalize, map, switchMap, tap } from "rxjs";

import { AiService, type AiStreamEvent } from "../../../core/ai/ai.service";

export interface IdeTab {
  id: string;
  title: string;
  language: string;
  value: string;
}

export interface IdeState {
  tabs: IdeTab[];
  activeTabId: string | null;
  ai: {
    prompt: string;
    streaming: boolean;
    output: string;
  };
}

const initialState: IdeState = {
  tabs: [
    {
      id: "welcome",
      title: "welcome.ts",
      language: "typescript",
      value: 'export const welcome = "AI IDE Web";\n',
    },
  ],
  activeTabId: "welcome",
  ai: {
    prompt: "",
    streaming: false,
    output: "",
  },
};

function randomId(): string {
  return crypto.randomUUID();
}

export const IdeStore = signalStore(
  { providedIn: "root" },
  withState(initialState),
  withComputed((s) => ({
    activeTab: computed(
      () => s.tabs().find((t) => t.id === s.activeTabId()) ?? null,
    ),
  })),
  withMethods((s) => {
    const service = inject(AiService);

    const onAiEvent = (evt: AiStreamEvent): void => {
      if ("done" in evt) {
        patchState(s, { ai: { ...s.ai(), streaming: false } });
        return;
      }
      patchState(s, { ai: { ...s.ai(), output: s.ai().output + evt.delta } });
    };

    const streamPrompt = rxMethod<string>((prompt$) =>
      prompt$.pipe(
        map((prompt) => prompt.trim()),
        filter((p) => p.length > 0),
        tap((prompt) =>
          patchState(s, { ai: { prompt, streaming: true, output: "" } }),
        ),
        switchMap((prompt) =>
          service.streamCompletion(prompt, { mock: true }).pipe(
            tap(onAiEvent),
            finalize(() =>
              patchState(s, { ai: { ...s.ai(), streaming: false } }),
            ),
          ),
        ),
      ),
    );

    return {
      setActiveTab(tabId: string): void {
        patchState(s, { activeTabId: tabId });
      },
      updateActiveValue(value: string): void {
        const activeId = s.activeTabId();
        if (!activeId) return;
        patchState(s, {
          tabs: s.tabs().map((t) => (t.id === activeId ? { ...t, value } : t)),
        });
      },
      editorValueChanged: rxMethod<string>((value$) =>
        value$.pipe(
          tap((value) => {
            const activeId = s.activeTabId();
            if (!activeId) return;
            patchState(s, {
              tabs: s
                .tabs()
                .map((t) => (t.id === activeId ? { ...t, value } : t)),
            });
          }),
        ),
      ),
      openScratchTab(): void {
        const id = randomId();
        patchState(s, {
          tabs: s
            .tabs()
            .concat({
              id,
              title: `scratch-${id.slice(0, 4)}.ts`,
              language: "typescript",
              value: "",
            }),
          activeTabId: id,
        });
      },
      setPrompt(prompt: string): void {
        patchState(s, { ai: { ...s.ai(), prompt } });
      },
      startPromptStream(): void {
        streamPrompt(s.ai().prompt);
      },
      streamPrompt,
      onAiEvent,
    };
  }),
);
