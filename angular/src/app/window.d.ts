declare interface Window {
  libraryAPI: {
    openAskDirectory: () => Promise<any>;
    getGamesFiles: (dirPath: string) => Promise<any>;
    getArtFolder: (dirPath: string) => Promise<any>;
    renameGamefile: (
      dirPath: string,
      gameId: string,
      gameName: string
    ) => Promise<any>;
    downloadArtByGameId: (
      dirPath: string,
      gameId: string,
      system?: 'PS2' | 'PS1'
    ) => Promise<any>;
    tryDetermineGameIdFromHex: (filepath: string) => Promise<any>;
    convertBinToIso: (cueFilePath: string, outputDir: string) => Promise<any>;
    convertCueToVcd: (
      cueFilePath: string,
      outputVcdPath: string
    ) => Promise<any>;
    openAskGameFile: (isGameCd: boolean, isGameDvd: boolean) => Promise<any>;
    isBundledCue2PopsAvailable: () => Promise<any>;
    ensurePopsElfForVcd: (vcdPath: string, oplRoot: string) => Promise<any>;
    addToConfApps: (
      oplRoot: string,
      gameName: string,
      elfName: string
    ) => Promise<any>;
    deleteGameAndRelatedFiles: (payload: any) => Promise<any>;
    onMainLog: (callback: (entry: any) => void) => void;
    removeAllMainLogListeners: () => void;
    onConvertVcdProgress: (callback: (progress: any) => void) => void;
    removeAllConvertVcdProgressListeners: () => void;
    onConvertVcdStage: (callback: (stage: string) => void) => void;
    removeAllConvertVcdStageListeners: () => void;
    moveFile: (sourcePath: string, destPath: string) => Promise<any>;
    onMoveFileProgress: (
      callback: (progress: {
        percent: number;
        copiedMB: number;
        totalMB: number;
        elapsed: number;
      }) => void
    ) => void;
    removeAllMoveFileProgressListeners: () => void;
  };
}
