import { contextBridge, ipcRenderer } from "electron";
import { type IpcResult, unwrapIpcResult } from "./ipc-security";
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

async function invoke<Value>(channel: string, ...args: unknown[]): Promise<Value> {
  return unwrapIpcResult(
    await ipcRenderer.invoke(channel, ...args) as IpcResult<Value>,
  );
}

const mediaBridge: MediaWorkbenchBridge = {
  chooseLibrary: () => invoke(MEDIA_CHANNELS.chooseLibrary),
  restoreLibrary: () => invoke(MEDIA_CHANNELS.restoreLibrary),
  scanProject: (project: ProjectReference, options?: ProjectScanQuery) => (
    invoke(MEDIA_CHANNELS.scanProject, project, options)
  ),
  cancelProjectScan: () => invoke(MEDIA_CHANNELS.cancelProjectScan),
  onMediaEvent(callback: (event: MediaEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: MediaEvent): void => {
      callback(payload);
    };
    ipcRenderer.on(MEDIA_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(MEDIA_CHANNELS.event, listener);
  },
  loadAnnotations: () => invoke(MEDIA_CHANNELS.loadAnnotations),
  updateAnnotations: (updates: Record<string, AnnotationInput>) => (
    invoke(MEDIA_CHANNELS.updateAnnotations, updates)
  ),
  trashItems: (paths) => invoke(MEDIA_CHANNELS.trashItems, paths),
  showInFinder: (path) => invoke(MEDIA_CHANNELS.showInFinder, path),
  openExternal: (path) => invoke(MEDIA_CHANNELS.openExternal, path),
  startFileDrag: (path) => ipcRenderer.send(MEDIA_CHANNELS.startFileDrag, path),
  copyText: (text) => invoke(MEDIA_CHANNELS.copyText, text),
  copyMigrationRecoveryCommand: () => invoke(MEDIA_CHANNELS.copyMigrationRecoveryCommand),
  readText: (path, maxBytes) => invoke(MEDIA_CHANNELS.readText, path, maxBytes),
  getMediaUrl: (path) => invoke(MEDIA_CHANNELS.getMediaUrl, path),
  createTerminal: (dimensions) => invoke(TERMINAL_CHANNELS.create, dimensions),
  writeTerminal: (sessionId, data) => {
    ipcRenderer.send(TERMINAL_CHANNELS.write, sessionId, data);
  },
  resizeTerminal: (sessionId, dimensions) => {
    ipcRenderer.send(TERMINAL_CHANNELS.resize, sessionId, dimensions);
  },
  killTerminal: (sessionId) => invoke(TERMINAL_CHANNELS.kill, sessionId),
  onTerminalEvent(callback: (event: TerminalEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalEvent): void => {
      callback(payload);
    };
    ipcRenderer.on(TERMINAL_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.event, listener);
  },
  getAgentProviders: () => invoke(AGENT_CHANNELS.providers),
  loginAgentProvider: (provider) => invoke(AGENT_CHANNELS.login, provider),
  setAgentApiKey: (provider, apiKey) => (
    invoke(AGENT_CHANNELS.setApiKey, provider, apiKey)
  ),
  clearAgentApiKey: (provider) => invoke(AGENT_CHANNELS.clearApiKey, provider),
  sendAgentMessage: (request: AgentChatRequest) => (
    invoke(AGENT_CHANNELS.send, request)
  ),
  stopAgent: () => invoke(AGENT_CHANNELS.stop),
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
