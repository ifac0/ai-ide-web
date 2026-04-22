import { Injectable, inject } from "@angular/core";

import {
  IndexedDbService,
  type IndexedDbConfig,
} from "../../../core/persistence/indexed-db.service";

import type { IdeState } from "./ide.store";

export interface WorkspaceItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedIdeDocument {
  version: 1;
  workspaceId: string;
  updatedAt: string;
  state: IdeState;
}

export interface PersistedWorkspaceIndex {
  version: 1;
  updatedAt: string;
  currentWorkspaceId: string;
  workspaces: WorkspaceItem[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function dbConfig(): IndexedDbConfig {
  return { dbName: "ai-ide-web", version: 1 };
}

function ensureSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("ide")) {
    db.createObjectStore("ide");
  }
  if (!db.objectStoreNames.contains("workspaces")) {
    db.createObjectStore("workspaces");
  }
}

function randomId(): string {
  return crypto.randomUUID();
}

@Injectable({ providedIn: "root" })
export class IdePersistenceService {
  private readonly idb = inject(IndexedDbService);

  async ensureWorkspaceIndex(): Promise<PersistedWorkspaceIndex> {
    const existing = await this.idb.get<PersistedWorkspaceIndex>(
      dbConfig(),
      "workspaces",
      "index",
    );
    if (existing) return existing;

    const firstId = randomId();
    const at = nowIso();
    const created: PersistedWorkspaceIndex = {
      version: 1,
      updatedAt: at,
      currentWorkspaceId: firstId,
      workspaces: [
        { id: firstId, name: "Default", createdAt: at, updatedAt: at },
      ],
    };
    await this.idb.put(
      dbConfig(),
      "workspaces",
      "index",
      created,
      ensureSchema,
    );
    return created;
  }

  async createWorkspace(name: string): Promise<WorkspaceItem> {
    const index = await this.ensureWorkspaceIndex();
    const at = nowIso();
    const ws: WorkspaceItem = {
      id: randomId(),
      name: name.trim().length > 0 ? name.trim() : "Workspace",
      createdAt: at,
      updatedAt: at,
    };
    const next: PersistedWorkspaceIndex = {
      ...index,
      updatedAt: at,
      currentWorkspaceId: ws.id,
      workspaces: index.workspaces.concat(ws),
    };
    await this.idb.put(dbConfig(), "workspaces", "index", next, ensureSchema);
    return ws;
  }

  async setCurrentWorkspace(id: string): Promise<void> {
    const index = await this.ensureWorkspaceIndex();
    const at = nowIso();
    const next: PersistedWorkspaceIndex = {
      ...index,
      updatedAt: at,
      currentWorkspaceId: id,
    };
    await this.idb.put(dbConfig(), "workspaces", "index", next, ensureSchema);
  }

  async loadWorkspaceIndex(): Promise<PersistedWorkspaceIndex> {
    return this.ensureWorkspaceIndex();
  }

  async loadIdeState(workspaceId: string): Promise<IdeState | null> {
    const doc = await this.idb.get<PersistedIdeDocument>(
      dbConfig(),
      "ide",
      workspaceId,
    );
    return doc?.state ?? null;
  }

  async saveIdeState(workspaceId: string, state: IdeState): Promise<void> {
    const at = nowIso();
    const doc: PersistedIdeDocument = {
      version: 1,
      workspaceId,
      updatedAt: at,
      state,
    };
    await this.idb.put(dbConfig(), "ide", workspaceId, doc, ensureSchema);
  }
}
