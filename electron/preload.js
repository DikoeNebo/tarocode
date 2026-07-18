const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("keycode", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveSettings: (partial) => ipcRenderer.invoke("save-settings", partial),
  previewSettings: (partial) => ipcRenderer.invoke("preview-settings", partial),
  setDock: (dock) => ipcRenderer.invoke("set-dock", dock),
  setActiveDeck: (id) => ipcRenderer.invoke("set-active-deck", id),
  saveDeck: (deck) => ipcRenderer.invoke("save-deck", deck),
  listWindows: () => ipcRenderer.invoke("list-windows"),
  pasteCard: (cardId) => ipcRenderer.invoke("paste-card", cardId),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke("set-ignore-mouse", ignore),
  setPreviewHold: (on) => ipcRenderer.invoke("set-preview-hold", on),
  deckUiReady: () => ipcRenderer.invoke("deck-ui-ready"),
  startTargetPick: () => ipcRenderer.invoke("start-target-pick"),
  toggleDeck: () => ipcRenderer.invoke("toggle-deck"),
  setExpanded: (expanded) => ipcRenderer.invoke("set-expanded", expanded),
  setFullscreenEdit: (on) => ipcRenderer.invoke("set-fullscreen-edit", on),
  togglePin: () => ipcRenderer.invoke("toggle-pin"),
  hideDeck: () => ipcRenderer.invoke("hide-deck"),
  showDeck: () => ipcRenderer.invoke("show-deck"),
  exportDeck: (id) => ipcRenderer.invoke("export-deck", id),
  importDeck: () => ipcRenderer.invoke("import-deck"),
  newDeck: (name) => ipcRenderer.invoke("new-deck", name),
  deleteDeck: (id) => ipcRenderer.invoke("delete-deck", id),
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  closeSettings: () => ipcRenderer.invoke("close-settings"),
  openTargets: () => ipcRenderer.invoke("open-targets"),
  closeTargets: () => ipcRenderer.invoke("close-targets"),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  pickClick: (screenX, screenY) =>
    ipcRenderer.invoke("pick-click", { screenX, screenY }),
  pickCancel: () => ipcRenderer.invoke("pick-cancel"),
  onToast: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("toast", handler);
    return () => ipcRenderer.removeListener("toast", handler);
  },
  onPasteDone: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("paste-done", handler);
    return () => ipcRenderer.removeListener("paste-done", handler);
  },
  onDeckReveal: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("deck-reveal", handler);
    return () => ipcRenderer.removeListener("deck-reveal", handler);
  },
  onDeckConceal: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("deck-conceal", handler);
    return () => ipcRenderer.removeListener("deck-conceal", handler);
  },
  onPanelExpanded: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("panel-expanded", handler);
    return () => ipcRenderer.removeListener("panel-expanded", handler);
  },
  onPinChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("pin-changed", handler);
    return () => ipcRenderer.removeListener("pin-changed", handler);
  },
  onFullscreenEdit: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("fullscreen-edit", handler);
    return () => ipcRenderer.removeListener("fullscreen-edit", handler);
  },
  onDockChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("dock-changed", handler);
    return () => ipcRenderer.removeListener("dock-changed", handler);
  },
  onTargetsUpdated: (cb) => {
    const handler = (_e, targets) => cb(targets);
    ipcRenderer.on("targets-updated", handler);
    return () => ipcRenderer.removeListener("targets-updated", handler);
  },
  onStateChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("state-changed", handler);
    return () => ipcRenderer.removeListener("state-changed", handler);
  },
  onSettingsOpen: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("settings-open", handler);
    return () => ipcRenderer.removeListener("settings-open", handler);
  },
  onSettingsClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("settings-closed", handler);
    return () => ipcRenderer.removeListener("settings-closed", handler);
  },
  onTargetsOpen: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("targets-open", handler);
    return () => ipcRenderer.removeListener("targets-open", handler);
  },
  onTargetsClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("targets-closed", handler);
    return () => ipcRenderer.removeListener("targets-closed", handler);
  },
  onSettingsPreview: (cb) => {
    const handler = (_e, partial) => cb(partial);
    ipcRenderer.on("settings-preview", handler);
    return () => ipcRenderer.removeListener("settings-preview", handler);
  },
});
