import { contextBridge, ipcRenderer } from "electron";
import {
  AGENT_CHANNELS,
  APP_CHANNELS,
  MEDIA_CHANNELS,
  TERMINAL_CHANNELS,
  type AnnotationInput,
  type AgentChatEnvelope,
  type AgentChatRequest,
  type MediaEvent,
  type MediaWorkbenchBridge,
  type ProjectReference,
  type ProjectScanQuery,
  type TerminalEvent,
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
  startFileDrag: (path) => ipcRenderer.send(MEDIA_CHANNELS.startFileDrag, path),
  copyText: (text) => ipcRenderer.invoke(MEDIA_CHANNELS.copyText, text),
  readText: (path, maxBytes) => ipcRenderer.invoke(MEDIA_CHANNELS.readText, path, maxBytes),
  getMediaUrl: (path) => ipcRenderer.invoke(MEDIA_CHANNELS.getMediaUrl, path),
  createTerminal: (dimensions) => ipcRenderer.invoke(TERMINAL_CHANNELS.create, dimensions),
  writeTerminal: (sessionId, data) => {
    ipcRenderer.send(TERMINAL_CHANNELS.write, sessionId, data);
  },
  resizeTerminal: (sessionId, dimensions) => {
    ipcRenderer.send(TERMINAL_CHANNELS.resize, sessionId, dimensions);
  },
  killTerminal: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, sessionId),
  onTerminalEvent(callback: (event: TerminalEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalEvent): void => {
      callback(payload);
    };
    ipcRenderer.on(TERMINAL_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.event, listener);
  },
  getAgentProviders: () => ipcRenderer.invoke(AGENT_CHANNELS.providers),
  loginAgentProvider: (provider) => ipcRenderer.invoke(AGENT_CHANNELS.login, provider),
  setAgentApiKey: (provider, apiKey) => (
    ipcRenderer.invoke(AGENT_CHANNELS.setApiKey, provider, apiKey)
  ),
  clearAgentApiKey: (provider) => ipcRenderer.invoke(AGENT_CHANNELS.clearApiKey, provider),
  sendAgentMessage: (request: AgentChatRequest) => (
    ipcRenderer.invoke(AGENT_CHANNELS.send, request)
  ),
  stopAgent: () => ipcRenderer.invoke(AGENT_CHANNELS.stop),
  onAgentEvent(callback: (event: AgentChatEnvelope) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: AgentChatEnvelope,
    ): void => callback(payload);
    ipcRenderer.on(AGENT_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(AGENT_CHANNELS.event, listener);
  },
  onToggleRightPanel(callback) {
    const listener = (): void => callback();
    ipcRenderer.on(APP_CHANNELS.toggleRightPanel, listener);
    return () => ipcRenderer.removeListener(APP_CHANNELS.toggleRightPanel, listener);
  },
};

contextBridge.exposeInMainWorld("ralphy", mediaBridge);
