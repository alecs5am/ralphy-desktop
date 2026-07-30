import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ContextSidebar } from "./components/ContextSidebar";
import { Inspector } from "./components/Inspector";
import { MainHeader } from "./components/Titlebar";
import {
  bridge,
  type MediaAnnotation,
  type MediaItem,
  type ProjectSummary,
} from "./lib/ipc";
import { LibraryScreen } from "./screens/LibraryScreen";
import { AssetViewer } from "./screens/AssetViewer";
import { ProjectScreen } from "./screens/ProjectScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import {
  createInitialWorkbenchState,
  readWorkbenchPreferences,
  workbenchReducer,
  writeWorkbenchPreferences,
} from "./state/workbench";
import { adjacentMediaItem } from "./lib/review";

export function App() {
  const initialPreferences = useRef(readWorkbenchPreferences(localStorage));
  const [state, dispatch] = useReducer(
    workbenchReducer,
    initialPreferences.current,
    createInitialWorkbenchState,
  );
  const [restoring, setRestoring] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [sidebarSearchRequest, setSidebarSearchRequest] = useState(0);
  const [includeIntermediate, setIncludeIntermediate] = useState(false);
  const [annotations, setAnnotations] = useState<Record<string, MediaAnnotation>>({});
  const [selectedAsset, setSelectedAsset] = useState<MediaItem | null>(null);
  const [viewer, setViewer] = useState<{ itemId: string; items: MediaItem[] } | null>(null);
  const projectRequest = useRef(0);
  const annotationRequests = useRef(new Map<string, number>());
  const restorationStarted = useRef(false);

  const catalog = state.catalog;
  const workspaces = catalog?.workspaces ?? [];
  const projects = catalog?.projects ?? [];
  const selectedWorkspace = useMemo(() => {
    if (state.route.kind === "library") return null;
    const workspaceId = state.route.workspaceId;
    return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  }, [state.route, workspaces]);
  const selectedProject = useMemo(() => {
    if (state.route.kind !== "project") return null;
    const { workspaceId, projectId } = state.route;
    return projects.find(
      (project) =>
        project.workspaceId === workspaceId && project.projectId === projectId,
    ) ?? null;
  }, [projects, state.route]);

  useEffect(() => {
    const unsubscribe = bridge.onMediaEvent((event) => {
      if (event.type === "catalog-result") {
        dispatch({ type: "catalog-received", catalog: event.result });
      } else if (event.type === "project-result") {
        dispatch({ type: "project-received", project: event.result });
      } else if (event.type === "error") {
        setError(event.message);
      }
    });

    if (!restorationStarted.current) {
      restorationStarted.current = true;
      void bridge
        .restoreLibrary()
        .then((result) => {
          if (!result) return;
          dispatch({ type: "library-opened", catalog: result.catalog });
          void bridge.loadAnnotations().then((store) => setAnnotations(store.items));
          const saved = initialPreferences.current;
          if (saved.rootPath !== result.rootPath || !saved.workspaceId) return;
          const workspaceExists = result.catalog.workspaces.some(
            (workspace) => workspace.id === saved.workspaceId,
          );
          if (!workspaceExists) return;
          dispatch({ type: "open-workspace", workspaceId: saved.workspaceId });
          if (
            saved.projectId &&
            result.catalog.projects.some(
              (project) =>
                project.workspaceId === saved.workspaceId &&
                project.projectId === saved.projectId,
            )
          ) {
            dispatch({
              type: "open-project",
              project: {
                workspaceId: saved.workspaceId,
                projectId: saved.projectId,
              },
            });
          }
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => setRestoring(false));
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (state.route.kind !== "project") {
      projectRequest.current += 1;
      setProjectLoading(false);
      void bridge.cancelProjectScan();
      return;
    }
    const token = ++projectRequest.current;
    setProjectLoading(true);
    setError(null);
    void bridge
      .scanProject({
        workspaceId: state.route.workspaceId,
        projectId: state.route.projectId,
      }, { includeIntermediate })
      .then((project) => {
        if (projectRequest.current === token) {
          dispatch({ type: "project-received", project });
        }
      })
      .catch((cause: unknown) => {
        if (projectRequest.current === token) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (projectRequest.current === token) setProjectLoading(false);
      });
  }, [includeIntermediate, state.route]);

  useEffect(() => {
    setSelectedAsset(null);
    setViewer(null);
    setInspectorVisible(false);
  }, [
    state.route.kind === "project" ? state.route.projectId : null,
    state.route.kind === "project" ? state.route.workspaceId : null,
  ]);

  useEffect(() => {
    const workspaceId = state.route.kind === "library" ? null : state.route.workspaceId;
    const projectId = state.route.kind === "project" ? state.route.projectId : null;
    writeWorkbenchPreferences(localStorage, {
      rootPath: catalog?.rootPath ?? null,
      workspaceId,
      projectId,
      pinnedWorkspaceIds: state.pinnedWorkspaceIds,
      pinnedProjectIds: state.pinnedProjectIds,
    });
  }, [
    catalog?.rootPath,
    state.pinnedProjectIds,
    state.pinnedWorkspaceIds,
    state.route,
  ]);

  const chooseLibrary = useCallback(async () => {
    setError(null);
    try {
      const result = await bridge.chooseLibrary();
      if (result) {
        dispatch({ type: "library-opened", catalog: result.catalog });
        const store = await bridge.loadAnnotations();
        setAnnotations(store.items);
        setSelectedAsset(null);
        setIncludeIntermediate(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const navigateBack = useCallback(() => {
    if (viewer) setViewer(null);
    else dispatch({ type: "back" });
  }, [viewer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "[") {
        event.preventDefault();
        navigateBack();
      } else if (event.metaKey && event.key === "]") {
        event.preventDefault();
        dispatch({ type: "forward" });
      } else if (event.metaKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setSidebarSearchRequest((request) => request + 1);
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) navigateBack();
      if (event.button === 4) dispatch({ type: "forward" });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [navigateBack]);

  const openProject = (project: ProjectSummary) => {
    dispatch({
      type: "open-project",
      project: {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
      },
    });
  };

  const viewerItem = viewer?.items.find((item) => item.id === viewer.itemId) ?? null;
  const viewerItems = viewer?.items ?? [];
  const breadcrumbs = selectedProject
    ? [selectedProject.name, viewerItem?.name ?? "Project"]
    : selectedWorkspace
      ? [selectedWorkspace.name]
      : ["Workspaces"];

  const updateAnnotation = async (item: MediaItem, input: Parameters<typeof bridge.updateAnnotations>[0][string]) => {
    const request = (annotationRequests.current.get(item.id) ?? 0) + 1;
    annotationRequests.current.set(item.id, request);
    setAnnotations((current) => ({
      ...current,
      [item.id]: { ...input, updatedAt: new Date().toISOString() },
    }));
    try {
      const store = await bridge.updateAnnotations({ [item.id]: input });
      if (annotationRequests.current.get(item.id) === request) {
        const saved = store.items[item.id];
        if (saved) {
          setAnnotations((current) => ({ ...current, [item.id]: saved }));
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const trashSelected = async () => {
    if (!selectedAsset) return;
    const result = await bridge.trashItems([selectedAsset.absolutePath]);
    if (result.failed.length > 0) {
      setError(result.failed[0].error);
      return;
    }
    setViewer(null);
    setSelectedAsset(null);
    setInspectorVisible(false);
  };

  if (restoring) {
    return (
      <div className="boot-screen">
        <span className="brand-mark">R</span>
        <span>Opening library…</span>
      </div>
    );
  }

  let content = (
    <LibraryScreen
      catalog={catalog}
      pinnedWorkspaceIds={state.pinnedWorkspaceIds}
      onChooseLibrary={chooseLibrary}
      onOpenWorkspace={(workspaceId) => dispatch({ type: "open-workspace", workspaceId })}
      onOpenProject={openProject}
    />
  );
  if (state.route.kind === "workspace" && selectedWorkspace) {
    content = (
      <WorkspaceScreen
        workspace={selectedWorkspace}
        projects={projects.filter((project) => project.workspaceId === selectedWorkspace.id)}
        pinnedProjectIds={state.pinnedProjectIds}
        onOpenProject={openProject}
      />
    );
  } else if (state.route.kind === "project" && selectedProject) {
    content = (
      <>
        <div className="project-screen-slot" hidden={viewerItem !== null}>
          <ProjectScreen
            project={selectedProject}
            scan={state.project}
            annotations={annotations}
            loading={projectLoading}
            includeIntermediate={includeIntermediate}
            onIncludeIntermediateChange={setIncludeIntermediate}
            onSelectAsset={(item) => {
              setSelectedAsset(item);
              if (!item) setInspectorVisible(false);
            }}
            onOpenAsset={(item, visibleItems) => {
              setSelectedAsset(item);
              setViewer({ itemId: item.id, items: visibleItems });
              setInspectorVisible(false);
            }}
          />
        </div>
        {viewerItem && viewer && (
          <AssetViewer
            item={viewerItem}
            project={selectedProject}
            annotation={annotations[viewerItem.id]}
            canPrevious={adjacentMediaItem(viewerItems, viewerItem.id, -1) !== null}
            canNext={adjacentMediaItem(viewerItems, viewerItem.id, 1) !== null}
            onBack={() => setViewer(null)}
            onPrevious={() => {
              const item = adjacentMediaItem(viewerItems, viewerItem.id, -1);
              if (item) {
                setViewer({ itemId: item.id, items: viewerItems });
                setSelectedAsset(item);
              }
            }}
            onNext={() => {
              const item = adjacentMediaItem(viewerItems, viewerItem.id, 1);
              if (item) {
                setViewer({ itemId: item.id, items: viewerItems });
                setSelectedAsset(item);
              }
            }}
          />
        )}
      </>
    );
  }

  const showInspector =
    state.route.kind === "project" &&
    selectedProject !== null &&
    selectedAsset !== null &&
    inspectorVisible;

  return (
    <div className={`workbench${showInspector ? " has-inspector" : ""}`}>
      {catalog && (
        <ContextSidebar
          route={state.route}
          rootPath={catalog.rootPath}
          workspaces={workspaces}
          projects={projects}
          pinnedWorkspaceIds={state.pinnedWorkspaceIds}
          pinnedProjectIds={state.pinnedProjectIds}
          searchRequest={sidebarSearchRequest}
          canGoBack={viewerItem !== null || state.historyIndex > 0}
          canGoForward={state.historyIndex < state.history.length - 1}
          onBack={navigateBack}
          onForward={() => dispatch({ type: "forward" })}
          onChooseLibrary={chooseLibrary}
          onOpenLibrary={() => dispatch({ type: "open-library" })}
          onOpenWorkspace={(workspaceId) => dispatch({ type: "open-workspace", workspaceId })}
          onOpenProject={openProject}
          onToggleWorkspacePin={(workspaceId) =>
            dispatch({ type: "toggle-workspace-pin", workspaceId })
          }
          onToggleProjectPin={(projectId) =>
            dispatch({ type: "toggle-project-pin", projectId })
          }
        />
      )}
      <section className="main-shell">
        <MainHeader
          breadcrumbs={breadcrumbs}
          canToggleInspector={
            state.route.kind === "project" && selectedAsset !== null
          }
          inspectorVisible={
            state.route.kind === "project" && inspectorVisible && selectedAsset !== null
          }
          showChooseLibrary={!catalog}
          onChooseLibrary={chooseLibrary}
          onToggleInspector={() => setInspectorVisible((visible) => !visible)}
        />
        {content}
      </section>
      {showInspector && (
        <Inspector
          item={selectedAsset}
          project={selectedProject}
          annotation={annotations[selectedAsset.id]}
          onChange={(input) => void updateAnnotation(selectedAsset, input)}
          onTrash={() => void trashSelected()}
        />
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
