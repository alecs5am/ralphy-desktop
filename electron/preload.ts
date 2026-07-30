import { contextBridge, ipcRenderer } from "electron";
import {
  MEDIA_CHANNELS,
  type AnnotationInput,
  type MediaEvent,
  type MediaWorkbenchBridge,
  type ProjectReference,
  type ProjectScanQuery,
} from "./media/types";

const mediaBridge: MediaWorkbenchBridge = {
  chooseLibrary: () => ipcRenderer.invoke(MEDIA_CHANNELS.chooseLibrary),
  restoreLibrary: () => ipcRenderer.invoke(MEDIA_CHANNELS.restoreLibrary),
  openLibrary: (rootPath) => ipcRenderer.invoke(MEDIA_CHANNELS.openLibrary, rootPath),
  scanProject: (project: ProjectReference, options?: ProjectScanQuery) => (
    ipcRenderer.invoke(MEDIA_CHANNELS.scanProject, project, options)
  ),
  cancelProjectScan: () => ipcRenderer.invoke(MEDIA_CHANNELS.cancelProjectScan),
  onMediaEvent(callback: (event: MediaEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: MediaEvent): void => {
      callback(payload);
    };
    ipcRenderer.on(MEDIA_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(MEDIA_CHANNELS.event, listener);
  },
  loadAnnotations: () => ipcRenderer.invoke(MEDIA_CHANNELS.loadAnnotations),
  updateAnnotations: (updates: Record<string, AnnotationInput>) => (
    ipcRenderer.invoke(MEDIA_CHANNELS.updateAnnotations, updates)
  ),
  trashItems: (paths) => ipcRenderer.invoke(MEDIA_CHANNELS.trashItems, paths),
  showInFinder: (path) => ipcRenderer.invoke(MEDIA_CHANNELS.showInFinder, path),
  openExternal: (path) => ipcRenderer.invoke(MEDIA_CHANNELS.openExternal, path),
  copyText: (text) => ipcRenderer.invoke(MEDIA_CHANNELS.copyText, text),
  readText: (path, maxBytes) => ipcRenderer.invoke(MEDIA_CHANNELS.readText, path, maxBytes),
  getMediaUrl: (path) => ipcRenderer.invoke(MEDIA_CHANNELS.getMediaUrl, path),
};

contextBridge.exposeInMainWorld("ralphy", mediaBridge);
