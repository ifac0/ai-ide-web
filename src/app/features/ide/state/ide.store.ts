import { computed, effect, inject } from "@angular/core";
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import {
  Subject,
  filter,
  finalize,
  map,
  switchMap,
  takeUntil,
  tap,
} from "rxjs";

import { AiService, type AiStreamEvent } from "../../../core/ai/ai.service";

export interface IdeTab {
  id: string;
  title: string;
  language: string;
  value: string;
}

export type IdeFsNodeKind = "file" | "folder";

export interface IdeFsNode {
  id: string;
  kind: IdeFsNodeKind;
  name: string;
  path: string;
  language?: string;
  value?: string;
  children?: IdeFsNode[];
}

export interface IdeState {
  tabs: IdeTab[];
  activeTabId: string | null;
  layout: {
    sidebarWidthPx: number;
    bottomPanelHeightPx: number;
    bottomPanelOpen: boolean;
  };
  explorer: {
    root: IdeFsNode;
    openFolderPaths: string[];
  };
  ai: {
    prompt: string;
    streaming: boolean;
    output: string;
    useMock: boolean;
  };
}

interface PersistedIdeStateV1 {
  tabs: IdeTab[];
  activeTabId: string | null;
  layout: {
    sidebarWidthPx: number;
    bottomPanelHeightPx: number;
    bottomPanelOpen: boolean;
  };
  explorer: {
    openFolderPaths: string[];
  };
  ai: {
    useMock: boolean;
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
  layout: {
    sidebarWidthPx: 288,
    bottomPanelHeightPx: 220,
    bottomPanelOpen: true,
  },
  explorer: {
    root: {
      id: "root",
      kind: "folder",
      name: "workspace",
      path: "/",
      children: [
        {
          id: "src",
          kind: "folder",
          name: "src",
          path: "/src",
          children: [
            {
              id: "main-ts",
              kind: "file",
              name: "main.ts",
              path: "/src/main.ts",
              language: "typescript",
              value: 'import "zone.js";\n\nconsole.log("hello");\n',
            },
          ],
        },
        {
          id: "readme",
          kind: "file",
          name: "README.md",
          path: "/README.md",
          language: "markdown",
          value: "# AI IDE Web\n",
        },
      ],
    },
    openFolderPaths: ["/src"],
  },
  ai: {
    prompt: "",
    streaming: false,
    output: "",
    useMock: true,
  },
};

function randomId(): string {
  return crypto.randomUUID();
}

function storageKey(): string {
  return "ide.state.v2";
}

function tryParsePersisted(raw: string | null): PersistedIdeStateV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedIdeStateV1;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.layout) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFile(
  node: IdeFsNode,
): node is IdeFsNode & { kind: "file"; language: string; value: string } {
  return (
    node.kind === "file" &&
    typeof node.language === "string" &&
    typeof node.value === "string"
  );
}

function isFolder(
  node: IdeFsNode,
): node is IdeFsNode & { kind: "folder"; children: IdeFsNode[] } {
  return node.kind === "folder" && Array.isArray(node.children);
}

function findNodeByPath(node: IdeFsNode, path: string): IdeFsNode | null {
  if (node.path === path) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}

export const IdeStore = signalStore(
  { providedIn: "root" },
  withState(initialState),
  withComputed((s) => ({
    activeTab: computed(
      () => s.tabs().find((t) => t.id === s.activeTabId()) ?? null,
    ),
    explorerRoot: computed(() => s.explorer().root),
    openFolderPaths: computed(() => new Set(s.explorer().openFolderPaths)),
    sidebarWidthPx: computed(() => s.layout().sidebarWidthPx),
    bottomPanelHeightPx: computed(() => s.layout().bottomPanelHeightPx),
    bottomPanelOpen: computed(() => s.layout().bottomPanelOpen),
  })),
  withMethods((s) => {
    const service = inject(AiService);
    const cancel$ = new Subject<void>();

    const persisted = tryParsePersisted(localStorage.getItem(storageKey()));
    if (persisted) {
      patchState(s, {
        tabs: persisted.tabs,
        activeTabId: persisted.activeTabId,
        layout: persisted.layout,
        explorer: {
          ...s.explorer(),
          openFolderPaths: persisted.explorer.openFolderPaths,
        },
        ai: { ...s.ai(), useMock: persisted.ai.useMock },
      });
    }

    effect(() => {
      const state: PersistedIdeStateV1 = {
        tabs: s.tabs(),
        activeTabId: s.activeTabId(),
        layout: s.layout(),
        explorer: { openFolderPaths: s.explorer().openFolderPaths },
        ai: { useMock: s.ai().useMock },
      };
      localStorage.setItem(storageKey(), JSON.stringify(state));
    });

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
        tap(() => cancel$.next()),
        tap((prompt) =>
          patchState(s, {
            ai: { ...s.ai(), prompt, streaming: true, output: "" },
          }),
        ),
        switchMap((prompt) =>
          service.streamCompletion(prompt, { mock: s.ai().useMock }).pipe(
            tap(onAiEvent),
            takeUntil(cancel$),
            finalize(() =>
              patchState(s, { ai: { ...s.ai(), streaming: false } }),
            ),
          ),
        ),
      ),
    );

    const cancelStream = rxMethod<void>((trigger$) =>
      trigger$.pipe(
        tap(() => {
          cancel$.next();
          patchState(s, { ai: { ...s.ai(), streaming: false } });
        }),
      ),
    );

    return {
      setSidebarWidthPx(widthPx: number): void {
        const clamped = Math.min(520, Math.max(200, Math.round(widthPx)));
        patchState(s, { layout: { ...s.layout(), sidebarWidthPx: clamped } });
      },
      setBottomPanelHeightPx(heightPx: number): void {
        const clamped = Math.min(420, Math.max(120, Math.round(heightPx)));
        patchState(s, {
          layout: { ...s.layout(), bottomPanelHeightPx: clamped },
        });
      },
      setBottomPanelOpen(open: boolean): void {
        patchState(s, { layout: { ...s.layout(), bottomPanelOpen: open } });
      },
      toggleFolder(path: string): void {
        const node = findNodeByPath(s.explorer().root, path);
        if (!node || !isFolder(node)) return;
        const open = s.explorer().openFolderPaths;
        const isOpen = open.includes(path);
        patchState(s, {
          explorer: {
            ...s.explorer(),
            openFolderPaths: isOpen
              ? open.filter((p) => p !== path)
              : open.concat(path),
          },
        });
      },
      openFile(path: string): void {
        const node = findNodeByPath(s.explorer().root, path);
        if (!node || !isFile(node)) return;
        const existing = s.tabs().find((t) => t.title === node.name);
        if (existing) {
          patchState(s, { activeTabId: existing.id });
          return;
        }
        const id = randomId();
        patchState(s, {
          tabs: s.tabs().concat({
            id,
            title: node.name,
            language: node.language,
            value: node.value,
          }),
          activeTabId: id,
        });
      },
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
          tabs: s.tabs().concat({
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
      setUseMock(useMock: boolean): void {
        patchState(s, { ai: { ...s.ai(), useMock } });
      },
      startPromptStream(): void {
        streamPrompt(s.ai().prompt);
      },
      cancelStream,
      streamPrompt,
      onAiEvent,
    };
  }),
);
