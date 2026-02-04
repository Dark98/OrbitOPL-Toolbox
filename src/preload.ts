import { contextBridge, ipcRenderer } from "electron";
import { downloadArtByGameId, getArtFolder } from "./library.service";

contextBridge.exposeInMainWorld("libraryAPI", {
  openAskDirectory: () => ipcRenderer.invoke("open-ask-directory"),
  getGamesFiles: (dirPath: string) =>
    ipcRenderer.invoke("get-games-files", dirPath),
  getArtFolder: (dirPath: string) =>
    ipcRenderer.invoke("get-art-folder", dirPath),
  renameGamefile: (dirPath: string, gameId: string, gameName: string) =>
    ipcRenderer.invoke("rename-gamefile", dirPath, gameId, gameName),
  downloadArtByGameId: (dirPath: string, gameId: string, system?: string) =>
    ipcRenderer.invoke("download-art-by-gameid", dirPath, gameId, system),
  tryDetermineGameIdFromHex: (filepath: string) =>
    ipcRenderer.invoke("try-determine-gameid-from-hex", filepath),
  convertBinToIso: (cueFilePath: string, outputDir: string) =>
    ipcRenderer.invoke("convert-bin-to-iso", cueFilePath, outputDir),
  convertCueToVcd: (cueFilePath: string, outputVcdPath: string) =>
    ipcRenderer.invoke("convert-cue-to-vcd", cueFilePath, outputVcdPath),
  openAskGameFile: (isGameCd: boolean, isGameDvd: boolean) =>
    ipcRenderer.invoke("open-ask-game-file", isGameCd, isGameDvd),
  isBundledCue2PopsAvailable: () =>
    ipcRenderer.invoke("is-bundled-cue2pops-available"),
  ensurePopsElfForVcd: (vcdPath: string, oplRoot: string) =>
    ipcRenderer.invoke("ensure-pops-elf-for-vcd", vcdPath, oplRoot),
  addToConfApps: (oplRoot: string, gameName: string, elfName: string) =>
    ipcRenderer.invoke("add-to-conf-apps", oplRoot, gameName, elfName),
  deleteGameAndRelatedFiles: (payload: any) =>
    ipcRenderer.invoke("delete-game-and-related-files", payload),
  onMainLog: (callback: (entry: any) => void) => {
    ipcRenderer.on("main-log", (event, entry) => callback(entry));
  },
  removeAllMainLogListeners: () => {
    ipcRenderer.removeAllListeners("main-log");
  },
  onConvertVcdProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("convert-vcd-progress", (event, progress) =>
      callback(progress)
    );
  },
  removeAllConvertVcdProgressListeners: () => {
    ipcRenderer.removeAllListeners("convert-vcd-progress");
  },
  onConvertVcdStage: (callback: (stage: string) => void) => {
    ipcRenderer.on("convert-vcd-stage", (event, stage) => callback(stage));
  },
  removeAllConvertVcdStageListeners: () => {
    ipcRenderer.removeAllListeners("convert-vcd-stage");
  },
  moveFile: (sourcePath: string, destPath: string) =>
    ipcRenderer.invoke("move-file", sourcePath, destPath),
  onMoveFileProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("move-file-progress", (event, progress) =>
      callback(progress)
    );
  },
  removeAllMoveFileProgressListeners: () => {
    ipcRenderer.removeAllListeners("move-file-progress");
  },
});
