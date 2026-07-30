import { MediaProtocolAccess } from "./protocol-access";
import type {
  CatalogProgress,
  ProjectReference,
  ProjectScanProgress,
  ProjectScanQuery,
  ProjectScanRequest,
  ProjectScanResult,
} from "./types";

export class StaleMediaSessionError extends Error {
  constructor() {
    super("Stale media session result");
    this.name = "StaleMediaSessionError";
  }
}

export class MediaSessionState {
  readonly fileAccess = new MediaProtocolAccess();
  #activeRoot: string | null = null;
  #selectedProject: ProjectReference | null = null;
  #scanOptions: ProjectScanQuery | null = null;
  #catalogGeneration = 0;
  #projectGeneration = 0;

  requireRoot(): string {
    if (!this.#activeRoot) throw new Error("No active .ralphy library");
    return this.#activeRoot;
  }

  isActiveRoot(rootPath: string): boolean {
    return rootPath === this.#activeRoot;
  }

  activateRoot(rootPath: string): void {
    this.#catalogGeneration += 1;
    this.#activeRoot = rootPath;
    this.deselectProject();
  }

  beginCatalog(rootPath = this.requireRoot()): number {
    if (rootPath !== this.#activeRoot) throw new StaleMediaSessionError();
    this.#catalogGeneration += 1;
    return this.#catalogGeneration;
  }

  acceptCatalog(rootPath: string, generation: number): void {
    if (rootPath !== this.#activeRoot || generation !== this.#catalogGeneration) {
      throw new StaleMediaSessionError();
    }
  }

  isCurrentCatalogProgress(progress: CatalogProgress): boolean {
    return progress.generation === this.#catalogGeneration;
  }

  beginProject(
    project: ProjectReference,
    options: ProjectScanQuery = {},
  ): ProjectScanRequest {
    if (
      this.#selectedProject?.workspaceId !== project.workspaceId
      || this.#selectedProject.projectId !== project.projectId
    ) {
      this.fileAccess.clear();
    }
    this.#selectedProject = { ...project };
    this.#scanOptions = { includeIntermediate: options.includeIntermediate === true };
    this.#projectGeneration += 1;
    return {
      rootPath: this.requireRoot(),
      ...project,
      generation: this.#projectGeneration,
      includeIntermediate: options.includeIntermediate === true,
    };
  }

  acceptProject(request: ProjectScanRequest, result: ProjectScanResult): void {
    if (
      !this.isCurrentProject(request)
      || result.rootPath !== request.rootPath
      || result.workspaceId !== request.workspaceId
      || result.projectId !== request.projectId
      || result.generation !== request.generation
    ) {
      throw new StaleMediaSessionError();
    }
    this.fileAccess.replace(result);
  }

  isCurrentProject(
    value: ProjectScanRequest | ProjectScanProgress,
  ): boolean {
    const selected = this.#selectedProject;
    if (
      !selected
      || value.generation !== this.#projectGeneration
      || value.workspaceId !== selected.workspaceId
      || value.projectId !== selected.projectId
    ) {
      return false;
    }
    return !("rootPath" in value) || value.rootPath === this.#activeRoot;
  }

  selectedForWatcher(rootPath: string): ProjectReference | null {
    return rootPath === this.#activeRoot && this.#selectedProject
      ? { ...this.#selectedProject }
      : null;
  }

  scanOptionsForWatcher(rootPath: string): ProjectScanQuery | null {
    return rootPath === this.#activeRoot && this.#selectedProject && this.#scanOptions
      ? { ...this.#scanOptions }
      : null;
  }

  deselectProject(): void {
    this.#selectedProject = null;
    this.#scanOptions = null;
    this.#projectGeneration += 1;
    this.fileAccess.clear();
  }

  close(): void {
    this.#activeRoot = null;
    this.#catalogGeneration += 1;
    this.deselectProject();
  }
}

interface StartableResource {
  start(): Promise<boolean>;
  close(): void;
}

export class ActiveRootResource<Resource extends StartableResource> {
  #resource: Resource | null = null;
  #tail: Promise<void> = Promise.resolve();

  replace(
    state: MediaSessionState,
    rootPath: string,
    create: () => Resource,
    commit: () => Promise<void>,
  ): Promise<void> {
    const operation = this.#tail.then(async () => {
      if (!state.isActiveRoot(rootPath)) throw new StaleMediaSessionError();
      const candidate = create();
      let installed = false;
      try {
        const started = await candidate.start();
        if (!started || !state.isActiveRoot(rootPath)) throw new StaleMediaSessionError();
        const previous = this.#resource;
        this.#resource = candidate;
        installed = true;
        previous?.close();
        await commit();
        if (!state.isActiveRoot(rootPath)) throw new StaleMediaSessionError();
      } catch (error) {
        if (!installed) {
          candidate.close();
        } else if (!state.isActiveRoot(rootPath) && this.#resource === candidate) {
          this.#resource = null;
          candidate.close();
        }
        throw error;
      }
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  close(): void {
    this.#resource?.close();
    this.#resource = null;
  }
}

interface ClosableWatcher {
  close(): void;
}

interface ClosableWorker {
  cancelProject(): void;
  close(): void;
}

export function stopMediaRuntime(
  state: MediaSessionState,
  resources: {
    watcher?: ClosableWatcher | null;
    worker?: ClosableWorker | null;
  },
): void {
  state.close();
  resources.watcher?.close();
  resources.worker?.cancelProject();
  resources.worker?.close();
}

interface EventWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
}

export function sendIfWindowAlive(
  window: EventWindow | null,
  channel: string,
  payload: unknown,
): boolean {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  try {
    window.webContents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}
