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

import {
  IdePersistenceService,
  type WorkspaceItem,
} from "./ide-persistence.service";
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
  workspace: {
    currentId: string;
    items: WorkspaceItem[];
    loaded: boolean;
  };
  layout: {
    sidebarWidthPx: number;
    bottomPanelHeightPx: number;
    bottomPanelOpen: boolean;
  };
  ui: {
    commandPalette: {
      open: boolean;
      query: string;
      selectedIndex: number;
      recent: CommandId[];
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
    history: {
      id: string;
      at: string;
      prompt: string;
      output: string;
    }[];
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
  workspace: { currentId: "local", items: [], loaded: false },
  layout: {
    sidebarWidthPx: 288,
    bottomPanelHeightPx: 220,
    bottomPanelOpen: true,
  },
  ui: {
    commandPalette: { open: false, query: "", selectedIndex: 0, recent: [] },
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
    history: [],
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

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

function isIdeState(input: unknown): input is IdeState {
  if (!input || typeof input !== "object") return false;
  const v = input as {
    tabs?: unknown;
    layout?: unknown;
    explorer?: unknown;
    ai?: unknown;
  };
  return (
    Array.isArray(v.tabs) &&
    typeof v.layout === "object" &&
    typeof v.explorer === "object" &&
    typeof v.ai === "object"
  );
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

function updateNodeByPath(
  node: IdeFsNode,
  path: string,
  update: (n: IdeFsNode) => IdeFsNode,
): IdeFsNode {
  if (node.path === path) return update(node);
  if (!node.children) return node;
  const children = node.children.map((c) => updateNodeByPath(c, path, update));
  return { ...node, children };
}

function removeNodeByPath(node: IdeFsNode, path: string): IdeFsNode {
  if (!node.children) return node;
  const children = node.children
    .filter((c) => c.path !== path)
    .map((c) => removeNodeByPath(c, path));
  return { ...node, children };
}

function ensureFolderChild(
  root: IdeFsNode,
  parentPath: string,
  child: IdeFsNode,
): IdeFsNode {
  return updateNodeByPath(root, parentPath, (n) => {
    if (!isFolder(n)) return n;
    const children = (n.children ?? []).concat(child);
    return { ...n, children };
  });
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

function filteredCommandItems(query: string): CommandItem[] {
  const q = normalizeQuery(query);
  const items = commandItems();
  if (q.length === 0) return items;
  return items.filter((c) =>
    `${c.title} ${c.keywords}`.toLowerCase().includes(q),
  );
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
    workspaceLoaded: computed(() => s.workspace().loaded),
    workspaces: computed(() => s.workspace().items),
    currentWorkspaceId: computed(() => s.workspace().currentId),
    explorerRoot: computed(() => s.explorer().root),
    openFolderPaths: computed(() => new Set(s.explorer().openFolderPaths)),
    sidebarWidthPx: computed(() => s.layout().sidebarWidthPx),
    bottomPanelHeightPx: computed(() => s.layout().bottomPanelHeightPx),
    bottomPanelOpen: computed(() => s.layout().bottomPanelOpen),
    commandPaletteOpen: computed(() => s.ui().commandPalette.open),
    commandPaletteQuery: computed(() => s.ui().commandPalette.query),
    commandPaletteSelectedIndex: computed(
      () => s.ui().commandPalette.selectedIndex,
    ),
    commandPaletteItems: computed(() => {
      return filteredCommandItems(s.ui().commandPalette.query);
    }),
    searchOpen: computed(() => s.ui().search.open),
    searchQuery: computed(() => s.ui().search.query),
    searchResults: computed(() => s.ui().search.results),
    searchSelectedIndex: computed(() => s.ui().search.selectedIndex),
  })),
  withMethods((s) => {
    const service = inject(AiService);
    const persistence = inject(IdePersistenceService);
    const cancel$ = new Subject<void>();

    const snapshot = (): IdeState => ({
      tabs: s.tabs(),
      activeTabId: s.activeTabId(),
      workspace: s.workspace(),
      layout: s.layout(),
      ui: s.ui(),
      explorer: s.explorer(),
      ai: s.ai(),
    });

    const snapshotForPersistence = (): IdeState => {
      const state = snapshot();
      return {
        ...state,
        workspace: {
          ...state.workspace,
          items: [],
        },
      };
    };

    const hydrate = rxMethod<void>((trigger$) =>
      trigger$.pipe(
        switchMap(async () => {
          const index = await persistence.loadWorkspaceIndex();
          const currentId = index.currentWorkspaceId;
          const loaded = await persistence.loadIdeState(currentId);

          patchState(s, {
            workspace: { currentId, items: index.workspaces, loaded: true },
          });

          if (isIdeState(loaded)) {
            patchState(s, loaded);
            return;
          }

          const legacy = tryParsePersisted(localStorage.getItem(storageKey()));
          if (legacy) {
            patchState(s, {
              tabs: legacy.tabs.map((t) => ({
                ...t,
                dirty: t.value !== t.savedValue,
              })),
              activeTabId: legacy.activeTabId,
              layout: legacy.layout,
              explorer: {
                ...s.explorer(),
                openFolderPaths: legacy.explorer.openFolderPaths,
              },
              ai: { ...s.ai(), useMock: legacy.ai.useMock },
            });
            await persistence.saveIdeState(currentId, snapshotForPersistence());
          } else {
            await persistence.saveIdeState(currentId, snapshotForPersistence());
          }
        }),
      ),
    );

    hydrate();

    effect(() => {
      if (!s.workspace().loaded) return;
      void persistence.saveIdeState(
        s.workspace().currentId,
        snapshotForPersistence(),
      );
    });

    const onAiEvent = (evt: AiStreamEvent): void => {
      if ("done" in evt) {
        const ai = s.ai();
        const entry = {
          id: randomId(),
          at: nowIso(),
          prompt: ai.prompt,
          output: ai.output,
        };
        patchState(s, {
          ai: {
            ...ai,
            streaming: false,
            history: [entry].concat(ai.history).slice(0, 20),
          },
        });
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
          service.cancelActiveRequest();
          patchState(s, { ai: { ...s.ai(), streaming: false } });
        }),
      ),
    );

    return {
      createWorkspace(name: string): void {
        void (async () => {
          const ws = await persistence.createWorkspace(name);
          const index = await persistence.loadWorkspaceIndex();
          patchState(s, {
            workspace: {
              ...s.workspace(),
              currentId: ws.id,
              items: index.workspaces,
              loaded: true,
            },
          });
          patchState(s, initialState);
        })();
      },
      switchWorkspace(id: string): void {
        void (async () => {
          await persistence.setCurrentWorkspace(id);
          const index = await persistence.loadWorkspaceIndex();
          const loaded = await persistence.loadIdeState(id);
          patchState(s, {
            workspace: {
              ...s.workspace(),
              currentId: id,
              items: index.workspaces,
              loaded: true,
            },
          });
          if (isIdeState(loaded)) {
            patchState(s, loaded);
          } else {
            patchState(s, initialState);
            await persistence.saveIdeState(id, snapshotForPersistence());
          }
        })();
      },
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
            commandPalette: {
              ...s.ui().commandPalette,
              open: true,
              query: "",
              selectedIndex: 0,
            },
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
            commandPalette: {
              ...s.ui().commandPalette,
              query,
              selectedIndex: 0,
            },
          },
        });
      },
      selectCommandPaletteIndex(index: number): void {
        const items = filteredCommandItems(s.ui().commandPalette.query);
        const clamped = Math.min(
          Math.max(0, Math.floor(index)),
          Math.max(0, items.length - 1),
        );
        patchState(s, {
          ui: {
            ...s.ui(),
            commandPalette: {
              ...s.ui().commandPalette,
              selectedIndex: clamped,
            },
          },
        });
      },
      runSelectedCommand(): void {
        const items = filteredCommandItems(s.ui().commandPalette.query);
        const idx = s.ui().commandPalette.selectedIndex;
        const item = items[idx];
        if (!item) return;
        this.runCommand(item.id);
      },
      runCommand(id: CommandId): void {
        const recent = [id]
          .concat(s.ui().commandPalette.recent.filter((x) => x !== id))
          .slice(0, 8);
        patchState(s, {
          ui: {
            ...s.ui(),
            commandPalette: { ...s.ui().commandPalette, recent },
          },
        });
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
      createFile(parentPath: string, name: string): void {
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        const parent = findNodeByPath(s.explorer().root, parentPath);
        if (!parent || !isFolder(parent)) return;
        const path =
          parentPath === "/" ? `/${trimmed}` : `${parentPath}/${trimmed}`;
        const file: IdeFsNode = {
          id: randomId(),
          kind: "file",
          name: trimmed,
          path,
          language: trimmed.endsWith(".md")
            ? "markdown"
            : trimmed.endsWith(".ts")
              ? "typescript"
              : "plaintext",
          value: "",
        };
        patchState(s, {
          explorer: {
            ...s.explorer(),
            root: ensureFolderChild(s.explorer().root, parentPath, file),
          },
        });
      },
      createFolder(parentPath: string, name: string): void {
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        const parent = findNodeByPath(s.explorer().root, parentPath);
        if (!parent || !isFolder(parent)) return;
        const path =
          parentPath === "/" ? `/${trimmed}` : `${parentPath}/${trimmed}`;
        const folder: IdeFsNode = {
          id: randomId(),
          kind: "folder",
          name: trimmed,
          path,
          children: [],
        };
        patchState(s, {
          explorer: {
            ...s.explorer(),
            root: ensureFolderChild(s.explorer().root, parentPath, folder),
          },
        });
      },
      renameNode(path: string, newName: string): void {
        const trimmed = newName.trim();
        if (trimmed.length === 0) return;
        const node = findNodeByPath(s.explorer().root, path);
        if (!node) return;
        const parentPath = path.split("/").slice(0, -1).join("/") || "/";
        const nextPath =
          parentPath === "/" ? `/${trimmed}` : `${parentPath}/${trimmed}`;
        patchState(s, {
          explorer: {
            ...s.explorer(),
            root: updateNodeByPath(s.explorer().root, path, (n) => ({
              ...n,
              name: trimmed,
              path: nextPath,
            })),
          },
        });
        patchState(s, {
          tabs: s
            .tabs()
            .map((t) =>
              t.path === path ? { ...t, title: trimmed, path: nextPath } : t,
            ),
        });
      },
      deleteNode(path: string): void {
        patchState(s, {
          explorer: {
            ...s.explorer(),
            root: removeNodeByPath(s.explorer().root, path),
            openFolderPaths: s
              .explorer()
              .openFolderPaths.filter(
                (p) => p !== path && !p.startsWith(`${path}/`),
              ),
          },
        });
        patchState(s, { tabs: s.tabs().filter((t) => t.path !== path) });
        if (
          s.activeTabId() &&
          !s.tabs().some((t) => t.id === s.activeTabId())
        ) {
          patchState(s, { activeTabId: s.tabs().at(-1)?.id ?? null });
        }
      },
      setUseMock(useMock: boolean): void {
        patchState(s, { ai: { ...s.ai(), useMock } });
      },
      clearAiOutput(): void {
        patchState(s, { ai: { ...s.ai(), output: "" } });
      },
      startPromptStream(): void {
        streamPrompt(s.ai().prompt);
      },
      cancelStream,
      streamPrompt,
      onAiEvent,
      hydrate,
    };
  }),
);
