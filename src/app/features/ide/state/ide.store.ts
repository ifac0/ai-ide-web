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
  path: string | null;
  language: string;
  value: string;
  savedValue: string;
  dirty: boolean;
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

export type CommandId =
  | "tabs.newScratch"
  | "tabs.closeActive"
  | "tabs.closeOthers"
  | "ai.toggleMock"
  | "panel.toggleBottom";

export interface CommandItem {
  id: CommandId;
  title: string;
  keywords: string;
}

export interface SearchMatch {
  tabId: string;
  title: string;
  index: number;
  line: number;
  column: number;
  preview: string;
}

export interface IdeState {
  tabs: IdeTab[];
  activeTabId: string | null;
  layout: {
    sidebarWidthPx: number;
    bottomPanelHeightPx: number;
    bottomPanelOpen: boolean;
  };
  ui: {
    commandPalette: {
      open: boolean;
      query: string;
    };
    search: {
      open: boolean;
      query: string;
      results: SearchMatch[];
      selectedIndex: number;
    };
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

type PersistedTab = Pick<
  IdeTab,
  "id" | "title" | "path" | "language" | "value" | "savedValue"
>;

interface PersistedIdeStateV1 {
  tabs: PersistedTab[];
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
      path: null,
      language: "typescript",
      value: 'export const welcome = "AI IDE Web";\n',
      savedValue: 'export const welcome = "AI IDE Web";\n',
      dirty: false,
    },
  ],
  activeTabId: "welcome",
  layout: {
    sidebarWidthPx: 288,
    bottomPanelHeightPx: 220,
    bottomPanelOpen: true,
  },
  ui: {
    commandPalette: { open: false, query: "" },
    search: { open: false, query: "", results: [], selectedIndex: 0 },
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

function commandItems(): CommandItem[] {
  return [
    {
      id: "tabs.newScratch",
      title: "New scratch tab",
      keywords: "new tab scratch",
    },
    {
      id: "tabs.closeActive",
      title: "Close active tab",
      keywords: "close tab",
    },
    {
      id: "tabs.closeOthers",
      title: "Close other tabs",
      keywords: "close others tabs",
    },
    {
      id: "ai.toggleMock",
      title: "Toggle mock streaming",
      keywords: "ai mock",
    },
    {
      id: "panel.toggleBottom",
      title: "Toggle bottom panel",
      keywords: "panel bottom",
    },
  ];
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function findAllMatches(input: string, query: string): number[] {
  if (query.length === 0) return [];
  const matches: number[] = [];
  const hay = input.toLowerCase();
  const needle = query.toLowerCase();
  let i = 0;
  while (i < hay.length) {
    const idx = hay.indexOf(needle, i);
    if (idx < 0) break;
    matches.push(idx);
    i = idx + Math.max(1, needle.length);
  }
  return matches;
}

function computeLineAndColumn(
  value: string,
  index: number,
): {
  line: number;
  column: number;
} {
  const before = value.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  const line = lines.length;
  const column = (lines.at(-1) ?? "").length + 1;
  return { line, column };
}

function linePreview(value: string, index: number): string {
  const start = value.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const endRaw = value.indexOf("\n", Math.max(0, index));
  const end = endRaw >= 0 ? endRaw : value.length;
  return value.slice(start, end);
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
    commandPaletteOpen: computed(() => s.ui().commandPalette.open),
    commandPaletteQuery: computed(() => s.ui().commandPalette.query),
    commandPaletteItems: computed(() => {
      const q = normalizeQuery(s.ui().commandPalette.query);
      const items = commandItems();
      if (q.length === 0) return items;
      return items.filter((c) =>
        `${c.title} ${c.keywords}`.toLowerCase().includes(q),
      );
    }),
    searchOpen: computed(() => s.ui().search.open),
    searchQuery: computed(() => s.ui().search.query),
    searchResults: computed(() => s.ui().search.results),
    searchSelectedIndex: computed(() => s.ui().search.selectedIndex),
  })),
  withMethods((s) => {
    const service = inject(AiService);
    const cancel$ = new Subject<void>();

    const persisted = tryParsePersisted(localStorage.getItem(storageKey()));
    if (persisted) {
      patchState(s, {
        tabs: persisted.tabs.map((t) => ({
          ...t,
          dirty: t.value !== t.savedValue,
        })),
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
        tabs: s.tabs().map((t) => ({
          id: t.id,
          title: t.title,
          path: t.path,
          language: t.language,
          value: t.value,
          savedValue: t.savedValue,
        })),
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
      openCommandPalette(): void {
        patchState(s, {
          ui: {
            ...s.ui(),
            commandPalette: { open: true, query: "" },
          },
        });
      },
      closeCommandPalette(): void {
        patchState(s, {
          ui: {
            ...s.ui(),
            commandPalette: { ...s.ui().commandPalette, open: false },
          },
        });
      },
      setCommandPaletteQuery(query: string): void {
        patchState(s, {
          ui: {
            ...s.ui(),
            commandPalette: { ...s.ui().commandPalette, query },
          },
        });
      },
      runCommand(id: CommandId): void {
        if (id === "tabs.newScratch") {
          this.openScratchTab();
          this.closeCommandPalette();
          return;
        }
        if (id === "tabs.closeActive") {
          this.closeActiveTab();
          this.closeCommandPalette();
          return;
        }
        if (id === "tabs.closeOthers") {
          this.closeOtherTabs();
          this.closeCommandPalette();
          return;
        }
        if (id === "ai.toggleMock") {
          this.setUseMock(!s.ai().useMock);
          this.closeCommandPalette();
          return;
        }
        if (id === "panel.toggleBottom") {
          this.setBottomPanelOpen(!s.layout().bottomPanelOpen);
          this.closeCommandPalette();
        }
      },
      openSearch(): void {
        patchState(s, {
          ui: {
            ...s.ui(),
            search: {
              open: true,
              query: s.ui().search.query,
              results: [],
              selectedIndex: 0,
            },
          },
        });
      },
      closeSearch(): void {
        patchState(s, {
          ui: { ...s.ui(), search: { ...s.ui().search, open: false } },
        });
      },
      setSearchQuery(query: string): void {
        const q = query;
        const needle = normalizeQuery(q);
        const results: SearchMatch[] = [];
        if (needle.length > 0) {
          for (const tab of s.tabs()) {
            for (const idx of findAllMatches(tab.value, needle)) {
              const pos = computeLineAndColumn(tab.value, idx);
              results.push({
                tabId: tab.id,
                title: tab.title,
                index: idx,
                line: pos.line,
                column: pos.column,
                preview: linePreview(tab.value, idx),
              });
            }
          }
        }
        patchState(s, {
          ui: {
            ...s.ui(),
            search: {
              ...s.ui().search,
              query: q,
              results,
              selectedIndex: 0,
            },
          },
        });
      },
      selectSearchResult(index: number): void {
        const clamped = Math.min(
          Math.max(0, Math.floor(index)),
          Math.max(0, s.ui().search.results.length - 1),
        );
        patchState(s, {
          ui: {
            ...s.ui(),
            search: { ...s.ui().search, selectedIndex: clamped },
          },
        });
      },
      activateSelectedSearchResult(): void {
        const idx = s.ui().search.selectedIndex;
        const item = s.ui().search.results[idx];
        if (!item) return;
        patchState(s, { activeTabId: item.tabId });
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
        const existing = s.tabs().find((t) => t.path === node.path);
        if (existing) {
          patchState(s, { activeTabId: existing.id });
          return;
        }
        const id = randomId();
        patchState(s, {
          tabs: s.tabs().concat({
            id,
            title: node.name,
            path: node.path,
            language: node.language,
            value: node.value,
            savedValue: node.value,
            dirty: false,
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
            patchState(s, {
              tabs: s
                .tabs()
                .map((t) =>
                  t.id === activeId
                    ? { ...t, dirty: value !== t.savedValue }
                    : t,
                ),
            });
          }),
        ),
      ),
      openScratchTab(): void {
        const id = randomId();
        const title = `scratch-${id.slice(0, 4)}.ts`;
        patchState(s, {
          tabs: s.tabs().concat({
            id,
            title,
            path: null,
            language: "typescript",
            value: "",
            savedValue: "",
            dirty: false,
          }),
          activeTabId: id,
        });
      },
      closeTab(tabId: string): void {
        const remaining = s.tabs().filter((t) => t.id !== tabId);
        const nextActive =
          s.activeTabId() === tabId
            ? (remaining.at(-1)?.id ?? null)
            : s.activeTabId();
        patchState(s, { tabs: remaining, activeTabId: nextActive });
      },
      closeActiveTab(): void {
        const id = s.activeTabId();
        if (!id) return;
        this.closeTab(id);
      },
      closeOtherTabs(): void {
        const activeId = s.activeTabId();
        if (!activeId) return;
        patchState(s, {
          tabs: s.tabs().filter((t) => t.id === activeId),
          activeTabId: activeId,
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
