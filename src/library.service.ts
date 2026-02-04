import { dialog, OpenDialogOptions } from "electron";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import https from "https";
import { spawn } from "child_process";
import os from "os";

const PS2_GAME_ID_PREFIXES = [
  "SLUS",
  "SCUS",
  "SLES",
  "SCES",
  "SLPM",
  "SLPS",
  "SCPS",
  "SCPM",
  "SLAJ",
  "SCAJ",
  "SLKA",
  "SCKA",
  "SCED",
  "SCCS",
];

const PS1_GAME_ID_PREFIXES = [
  "SLUS",
  "SLES",
  "SCUS",
  "SCES",
  "SLPS",
  "SCPS",
  "SLPM",
  "SCED",
  "SLED",
  "SLKA",
  "SCKA",
  "SIPS",
];

const PS2_GAME_ID_REGEX = new RegExp(
  `(?:${PS2_GAME_ID_PREFIXES.join("|")})_[0-9]{3}\\.[0-9]{2}(?:;1)?`,
  "g"
);
const PS1_GAME_ID_REGEX = new RegExp(
  `(?:${PS1_GAME_ID_PREFIXES.join("|")})_[0-9]{3}\\.[0-9]{2}(?:;1)?`,
  "g"
);

const FILE_SCAN_CHUNK_BYTES = 1024 * 1024; // 1 MB chunks keep memory usage predictable.
const FILE_SCAN_OVERLAP_BYTES = 64; // Overlap to catch IDs spanning chunk boundaries.
const PS2_GAMES_LIST_CANDIDATE_PATHS = [
  path.resolve(__dirname, "../assets/ps2-gameslist.txt"),
  path.resolve(__dirname, "../../assets/ps2-gameslist.txt"),
  path.resolve(process.cwd(), "assets/ps2-gameslist.txt"),
];
const PS1_GAMES_LIST_CANDIDATE_PATHS = [
  path.resolve(__dirname, "../assets/ps1-gameslist.txt"),
  path.resolve(__dirname, "../../assets/ps1-gameslist.txt"),
  path.resolve(process.cwd(), "assets/ps1-gameslist.txt"),
];
const POPS_CONVERTER_PLACEHOLDER_CUE = "{cue}";
const POPS_CONVERTER_PLACEHOLDER_VCD = "{vcd}";
const POPS_CONVERTER_ENV = "POPS_CONVERTER_CMD";
const POPS_ELF_TEMPLATE_ENV = "POPS_ELF_TEMPLATE";
const BINMERGE_PATH_ENV = "BINMERGE_PATH";
const BUNDLED_CUE2POPS_DIR = path.join(
  "assets",
  "tools",
  "cue2pops",
  "windows-x64"
);
const BUNDLED_CUE2POPS_EXE = "cue2pops.exe";
const BUNDLED_BINMERGE_DIR = path.join(
  "assets",
  "tools",
  "binmerge",
  "windows-x64"
);
const BUNDLED_BINMERGE_EXE = "binmerge.exe";

type MainLogEmitter = (entry: {
  type: "INF" | "ERR" | "VRB";
  location: string;
  message: string;
}) => void;

let mainLogEmitter: MainLogEmitter | undefined;

export function setMainLogEmitter(emitter?: MainLogEmitter) {
  mainLogEmitter = emitter;
}

function emitMainLog(
  type: "INF" | "ERR" | "VRB",
  location: string,
  message: string
) {
  console.log(`[${type}] [${location}] ${message}`);
  if (mainLogEmitter) {
    mainLogEmitter({ type, location, message });
  }
}

let cachedPs2GamesList: Map<string, string> | null = null;
let attemptedToLoadPs2GamesList = false;
let cachedPs1GamesList: Map<string, string> | null = null;
let attemptedToLoadPs1GamesList = false;

function normaliseGameIdForLookup(rawId: string) {
  return rawId.replace("_", "-").replace(/\./g, "").toUpperCase();
}

async function loadPs2GamesList() {
  if (attemptedToLoadPs2GamesList) {
    return cachedPs2GamesList;
  }

  attemptedToLoadPs2GamesList = true;

  for (const candidate of PS2_GAMES_LIST_CANDIDATE_PATHS) {
    try {
      const content = await fs.readFile(candidate, "utf-8");
      const map = new Map<string, string>();

      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        const [id, ...nameParts] = trimmed.split(/\s+/);
        if (!id || nameParts.length === 0) {
          return;
        }

        map.set(id.toUpperCase(), nameParts.join(" "));
      });

      if (map.size > 0) {
        cachedPs2GamesList = map;
        return cachedPs2GamesList;
      }
    } catch (err) {
      // Intentionally ignore missing file/location attempts.
    }
  }

  cachedPs2GamesList = null;
  return cachedPs2GamesList;
}

async function findPs2GameName(gameId: string) {
  const list = await loadPs2GamesList();
  if (!list) {
    return undefined;
  }

  return list.get(gameId.toUpperCase());
}

async function loadPs1GamesList() {
  if (attemptedToLoadPs1GamesList) {
    return cachedPs1GamesList;
  }

  attemptedToLoadPs1GamesList = true;

  for (const candidate of PS1_GAMES_LIST_CANDIDATE_PATHS) {
    try {
      const content = await fs.readFile(candidate, "utf-8");
      const map = new Map<string, string>();

      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        const [id, ...nameParts] = trimmed.split(/\s+/);
        if (!id || nameParts.length === 0) {
          return;
        }

        map.set(id.toUpperCase(), nameParts.join(" "));
      });

      if (map.size > 0) {
        cachedPs1GamesList = map;
        return cachedPs1GamesList;
      }
    } catch (err) {
      // Intentionally ignore missing file/location attempts.
    }
  }

  cachedPs1GamesList = null;
  return cachedPs1GamesList;
}

async function findPs1GameName(gameId: string) {
  const list = await loadPs1GamesList();
  if (!list) {
    return undefined;
  }

  return list.get(gameId.toUpperCase());
}

async function readDirIfExists(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function findPopsElfTemplate(oplRoot: string) {
  const envTemplate = process.env[POPS_ELF_TEMPLATE_ENV];
  if (envTemplate) {
    return envTemplate;
  }

  const popsDir = path.join(oplRoot, "POPS");
  const popstarterPath = path.join(popsDir, "POPSTARTER.ELF");
  try {
    const stat = await fs.stat(popstarterPath);
    if (stat.isFile()) {
      return popstarterPath;
    }
  } catch {
    // ignore missing POPSTARTER.ELF
  }

  const entries = await readDirIfExists(popsDir);

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (/^XX\..+\.ELF$/i.test(name)) {
      return path.join(popsDir, name);
    }
  }

  return undefined;
}

export async function ensurePopsElfForVcd(
  vcdPath: string,
  oplRoot: string
) {
  try {
    const templatePath = await findPopsElfTemplate(oplRoot);
    if (!templatePath) {
      return {
        success: false,
        message: `Missing POPS ELF template. Set ${POPS_ELF_TEMPLATE_ENV} or place the POPSTARTER.ELF file in POPS.`,
      };
    }

    const popsDir = path.join(oplRoot, "POPS");
    const vcdBase = path.basename(vcdPath, path.extname(vcdPath));
    const elfName = `XX.${vcdBase}.ELF`;
    const targetPath = path.join(popsDir, elfName);

    try {
      await fs.stat(targetPath);
      return { success: true, newPath: targetPath, skipped: true, elfName };
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }

    await fs.mkdir(popsDir, { recursive: true });
    await fs.copyFile(templatePath, targetPath);
    return { success: true, newPath: targetPath, elfName };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Failed to create POPS ELF.",
    };
  }
}

function sanitizeConfLabel(value: string) {
  return value.replace(/["\r\n]/g, "").trim();
}

export async function addToConfApps(
  oplRoot: string,
  gameName: string,
  elfName: string
) {
  try {
    const confPath = path.join(oplRoot, "conf_apps.cfg");
    const safeName = sanitizeConfLabel(gameName || elfName);
    const entry = `(PSX) ${safeName}=mass:/POPS/${elfName}`;

    let content = "";
    try {
      content = await fs.readFile(confPath, "utf-8");
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }

    const lines = content.split(/\r?\n/).filter((line) => line.trim().length);
    if (lines.some((line) => line.includes(`/POPS/${elfName}`))) {
      return { success: true, skipped: true, path: confPath };
    }

    const newContent = [...lines, entry].join("\n") + "\n";
    await fs.writeFile(confPath, newContent, "utf-8");
    return { success: true, path: confPath, entry };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Failed to update conf_apps.cfg.",
    };
  }
}

function normaliseConfAppsLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length);
}

export async function removeFromConfApps(oplRoot: string, elfName: string) {
  try {
    const confPath = path.join(oplRoot, "conf_apps.cfg");
    let content = "";
    try {
      content = await fs.readFile(confPath, "utf-8");
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return { success: true, skipped: true, path: confPath };
      }
      throw err;
    }

    const lines = normaliseConfAppsLines(content);
    const filtered = lines.filter(
      (line) => !line.includes(`/POPS/${elfName}`)
    );
    if (filtered.length === lines.length) {
      return { success: true, skipped: true, path: confPath };
    }

    const newContent = filtered.length ? filtered.join("\n") + "\n" : "";
    await fs.writeFile(confPath, newContent, "utf-8");
    return { success: true, path: confPath };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Failed to update conf_apps.cfg.",
    };
  }
}

export async function deleteGameAndRelatedFiles(params: {
  oplRoot: string;
  gameId: string;
  path: string;
  filename: string;
  extension: string;
  parentPath: string;
}) {
  const { oplRoot, gameId, path: gamePath, filename, extension, parentPath } =
    params;
  const removed: string[] = [];
  const missing: string[] = [];
  const errors: { path: string; message: string }[] = [];

  const safeRemove = async (targetPath: string) => {
    try {
      await fs.unlink(targetPath);
      removed.push(targetPath);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        missing.push(targetPath);
      } else {
        errors.push({ path: targetPath, message: err?.message || String(err) });
      }
    }
  };

  await safeRemove(gamePath);

  const artDir = path.join(oplRoot, "ART");
  try {
    const artEntries = await readDirIfExists(artDir);
    await Promise.all(
      artEntries
        .filter((entry) => entry.isFile())
        .filter((entry) =>
          entry.name.toUpperCase().startsWith(gameId.toUpperCase() + "_")
        )
        .map((entry) => safeRemove(path.join(artDir, entry.name)))
    );
  } catch (err: any) {
    errors.push({ path: artDir, message: err?.message || String(err) });
  }

  const isPops =
    extension.toLowerCase() === ".vcd" ||
    parentPath.toUpperCase().endsWith("POPS");
  if (isPops) {
    const vcdBase = path.basename(filename, extension);
    const elfName = `XX.${vcdBase}.ELF`;
    const elfPath = path.join(oplRoot, "POPS", elfName);
    await safeRemove(elfPath);
    await removeFromConfApps(oplRoot, elfName);
  }

  return {
    success: errors.length === 0,
    removed,
    missing,
    errors,
  };
}

async function resolveCueBinPath(cueFilePath: string) {
  const cueDir = path.dirname(cueFilePath);
  const cueContents = await fs.readFile(cueFilePath, "utf-8");

  for (const line of cueContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith("FILE")) {
      continue;
    }

    const quotedMatch = trimmed.match(/^FILE\s+"(.+?)"\s+\w+/i);
    if (quotedMatch?.[1]) {
      return path.resolve(cueDir, quotedMatch[1]);
    }

    const unquotedMatch = trimmed.match(/^FILE\s+(.+?)\s+\w+/i);
    if (unquotedMatch?.[1]) {
      return path.resolve(cueDir, unquotedMatch[1]);
    }
  }

  throw new Error("Unable to locate a referenced BIN file in the CUE sheet.");
}

async function getCueFilePaths(cueFilePath: string) {
  const cueDir = path.dirname(cueFilePath);
  const cueContents = await fs.readFile(cueFilePath, "utf-8");
  const filePaths: string[] = [];

  for (const line of cueContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith("FILE")) {
      continue;
    }

    const quotedMatch = trimmed.match(/^FILE\s+"(.+?)"\s+\w+/i);
    if (quotedMatch?.[1]) {
      filePaths.push(path.resolve(cueDir, quotedMatch[1]));
      continue;
    }

    const unquotedMatch = trimmed.match(/^FILE\s+(.+?)\s+\w+/i);
    if (unquotedMatch?.[1]) {
      filePaths.push(path.resolve(cueDir, unquotedMatch[1]));
    }
  }

  return filePaths;
}

async function getCueTotalSize(cueFilePath: string) {
  const files = await getCueFilePaths(cueFilePath);
  if (!files.length) {
    return 0;
  }

  let total = 0;
  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        total += stat.size;
      }
    } catch {
      // ignore missing files
    }
  }

  return total;
}

async function countCueFileEntries(cueFilePath: string) {
  const cueContents = await fs.readFile(cueFilePath, "utf-8");
  const matches = cueContents.match(/^\s*FILE\s+/gim);
  return matches ? matches.length : 0;
}

function sanitizeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

async function mergeCueIfNeeded(
  cueFilePath: string,
  onStage?: (stage: string) => void
) {
  const fileEntries = await countCueFileEntries(cueFilePath);
  if (fileEntries <= 1) {
    return { cuePath: cueFilePath, merged: false };
  }

  onStage?.("Merging BIN/CUE...");
  emitMainLog(
    "INF",
    "binmerge",
    `Multi-track CUE detected (${fileEntries} tracks). Running binmerge...`
  );

  const envPath = process.env[BINMERGE_PATH_ENV];
  const binmergePath = envPath || getBundledBinmergePath();
  if (!binmergePath) {
    throw new Error(
      `Multi-track BIN/CUE detected but binmerge.exe is missing. Set ${BINMERGE_PATH_ENV} or bundle binmerge.`
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "binmerge-"));
  const baseName = sanitizeFilename(`${path.parse(cueFilePath).name}_merged`);
  emitMainLog("VRB", "binmerge", `binmerge: ${binmergePath}`);
  emitMainLog("VRB", "binmerge", `binmerge output dir: ${tempDir}`);
  await runExecutable(binmergePath, [
    "--outdir",
    tempDir,
    cueFilePath,
    baseName,
  ]);

  const mergedCuePath = path.join(tempDir, `${baseName}.cue`);
  await fs.stat(mergedCuePath);
  emitMainLog("INF", "binmerge", `binmerge completed: ${mergedCuePath}`);
  return { cuePath: mergedCuePath, cleanupDir: tempDir, merged: true };
}

function buildConverterCommand(cueFilePath: string, outputVcdPath: string) {
  const template = process.env[POPS_CONVERTER_ENV];
  if (!template) {
    return undefined;
  }

  let command = template;
  command = command.replace(
    new RegExp(`"${POPS_CONVERTER_PLACEHOLDER_CUE}"`, "g"),
    `"${cueFilePath}"`
  );
  command = command.replace(
    new RegExp(`'${POPS_CONVERTER_PLACEHOLDER_CUE}'`, "g"),
    `'${cueFilePath}'`
  );
  command = command.replace(
    new RegExp(`"${POPS_CONVERTER_PLACEHOLDER_VCD}"`, "g"),
    `"${outputVcdPath}"`
  );
  command = command.replace(
    new RegExp(`'${POPS_CONVERTER_PLACEHOLDER_VCD}'`, "g"),
    `'${outputVcdPath}'`
  );
  command = command.replace(
    new RegExp(POPS_CONVERTER_PLACEHOLDER_CUE, "g"),
    `"${cueFilePath}"`
  );
  command = command.replace(
    new RegExp(POPS_CONVERTER_PLACEHOLDER_VCD, "g"),
    `"${outputVcdPath}"`
  );

  if (
    !command.includes(cueFilePath) ||
    !command.includes(outputVcdPath)
  ) {
    return undefined;
  }

  return command;
}

function runShellCommand(command: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, { shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const message = stderr || stdout || `Converter exited with code ${code}`;
        reject(new Error(message.trim()));
      }
    });
  });
}

function runExecutable(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const message = stderr || stdout || `Converter exited with code ${code}`;
        reject(new Error(message.trim()));
      }
    });
  });
}

function getBundledCue2PopsPath() {
  const candidates = [
    path.resolve(
      process.resourcesPath || "",
      "app.asar.unpacked",
      BUNDLED_CUE2POPS_DIR
    ),
    path.resolve(process.resourcesPath || "", BUNDLED_CUE2POPS_DIR),
    path.resolve(process.cwd(), BUNDLED_CUE2POPS_DIR),
    path.resolve(__dirname, "..", BUNDLED_CUE2POPS_DIR),
    path.resolve(__dirname, "../../", BUNDLED_CUE2POPS_DIR),
  ]
    .map((candidate) => path.join(candidate, BUNDLED_CUE2POPS_EXE))
    .filter((candidate) => !!candidate);

  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

function getBundledBinmergePath() {
  const candidates = [
    path.resolve(
      process.resourcesPath || "",
      "app.asar.unpacked",
      BUNDLED_BINMERGE_DIR
    ),
    path.resolve(process.resourcesPath || "", BUNDLED_BINMERGE_DIR),
    path.resolve(process.cwd(), BUNDLED_BINMERGE_DIR),
    path.resolve(__dirname, "..", BUNDLED_BINMERGE_DIR),
    path.resolve(__dirname, "../../", BUNDLED_BINMERGE_DIR),
  ]
    .map((candidate) => path.join(candidate, BUNDLED_BINMERGE_EXE))
    .filter((candidate) => !!candidate);

  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

export async function isBundledCue2PopsAvailable() {
  return !!getBundledCue2PopsPath();
}

async function findRecentVcdFiles(
  dirPath: string,
  sinceTimestamp: number
) {
  const entries = await readDirIfExists(dirPath);
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (path.extname(entry.name).toLowerCase() !== ".vcd") {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    const stats = await fs.stat(fullPath);
    if (stats.mtimeMs >= sinceTimestamp) {
      candidates.push({ path: fullPath, mtimeMs: stats.mtimeMs });
    }
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function openAskDirectory(options: any) {
  const defaultOptions = {
    properties: ["openDirectory"],
    title: "Select OPL Root Directory",
  };

  const result = await dialog.showOpenDialog({
    ...defaultOptions,
    ...options,
  });

  return result;
}

export async function getGamesFiles(dirPath: string) {
  try {
    const [items_cd, items_dvd, items_pops] = await Promise.all([
      readDirIfExists(path.join(dirPath, "CD")),
      readDirIfExists(path.join(dirPath, "DVD")),
      readDirIfExists(path.join(dirPath, "POPS")),
    ]);
    // Only include files, skip directories
    const items = [
      ...items_cd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/CD" })
      ),
      ...items_dvd.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/DVD" })
      ),
      ...items_pops.map((item) =>
        Object.assign(item, { parentDir: dirPath + "/POPS" })
      ),
    ].filter(
      (item) =>
        item.isFile() &&
        !item.name.startsWith(".") &&
        [".iso", ".zso", ".vcd"].includes(path.extname(item.name).toLowerCase())
    );

    const files = [];

    for (const item of items) {
      const stats = await fs.stat(item.parentDir + "/" + item.name);

      const itemInfo = {
        extension: path.extname(item.name),
        name: path.parse(item.name).name,
        parentPath: item.parentDir,
        path: item.parentDir + "/" + item.name,
        stats,
      };

      files.push(itemInfo);
    }
    return { success: true, data: files };
  } catch (err) {
    return { success: false, message: err };
  }
}

export async function getArtFolder(dirpath: string) {
  try {
    const artDir = path.join(dirpath, "ART");
    const items = await fs.readdir(artDir, { withFileTypes: true });
    const artFiles = await Promise.all(
      items
        .filter(
          (item) =>
            item.isFile() &&
            !item.name.startsWith(".") &&
            (item.name.toLowerCase().endsWith(".jpg") ||
              item.name.toLowerCase().endsWith(".png"))
        )
        .map(async (item) => {
          const filePath = path.join(artDir, item.name);
          const fileBuffer = await fs.readFile(filePath);
          return {
            name: path.parse(item.name).name,
            extension: path.extname(item.name),
            path: filePath,
            gameId: item.name.split("_")[0] + "_" + item.name.split("_")[1],
            type: item.name.split("_")[2]?.split(".")[0] || "",
            base64: fileBuffer.toString("base64"),
          };
        })
    );
    return { success: true, data: artFiles };
  } catch (err) {
    return { success: false, message: err };
  }
}

export async function downloadArtByGameId(
  dirPath: string,
  gameId: string,
  system: "PS2" | "PS1" = "PS2"
) {
  const baseUrl = `https://raw.githubusercontent.com/Luden02/psx-ps2-opl-art-database/refs/heads/main/${system}`;
  const types = ["COV", "ICO", "SCR"];
  const results: any[] = [];

  for (const type of types) {
    const fileName = `${gameId}_${type}.png`;
    const url = `${baseUrl}/${gameId}/${fileName}`;

    try {
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        https
          .get(url, (res) => {
            if (res.statusCode !== 200) {
              return reject(
                new Error(`Failed to download ${fileName}: ${res.statusCode}`)
              );
            }
            const data: Buffer[] = [];
            res.on("data", (chunk) => data.push(chunk));
            res.on("end", () => resolve(Buffer.concat(data)));
          })
          .on("error", reject);
      });

      const savePath = path.join(dirPath, `${gameId}_${type}.png`);
      await fs.writeFile(savePath, buffer);
      results.push({
        name: gameId,
        type,
        url,
        savedPath: savePath,
      });
    } catch (err: any) {
      results.push({
        name: gameId,
        type,
        url,
        error: err.message,
      });
    }
  }

  return { success: true, data: results };
}

export async function renameGamefile(
  dirpath: string,
  gameId: string,
  gameName: string
) {
  console.log(dirpath, gameId, gameName);
  const ext = path.extname(dirpath);
  const parentDir = path.dirname(dirpath);
  const newFileName = `${gameId}.${gameName}${ext}`;
  const newFilePath = path.join(parentDir, newFileName);

  try {
    await fs.rename(dirpath, newFilePath);
    return { success: true, newPath: newFilePath };
  } catch (err) {
    return { success: false, message: err };
  }
}

export async function tryDetermineGameIdFromHex(filepath: string) {
  let fileHandle: fs.FileHandle | undefined;
  let scanPath = filepath;
  const ext = path.extname(filepath).toLowerCase();
  const isVcd = ext === ".vcd";
  const isCue = ext === ".cue";

  try {
    if (isCue) {
      scanPath = await resolveCueBinPath(filepath);
    }
    fileHandle = await fs.open(scanPath, "r");
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Unable to open file.",
    };
  }

  try {
    const buffer = Buffer.alloc(FILE_SCAN_CHUNK_BYTES);
    let position = 0;
    let carry = "";

    while (true) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        FILE_SCAN_CHUNK_BYTES,
        position
      );

      if (bytesRead === 0) {
        break;
      }

      position += bytesRead;

      const chunk = carry + buffer.subarray(0, bytesRead).toString("latin1");
      const regex = isVcd || isCue ? PS1_GAME_ID_REGEX : PS2_GAME_ID_REGEX;
      regex.lastIndex = 0;
      const matches = chunk.match(regex);

      if (matches && matches.length > 0) {
        const gameId = matches[0].replace(/;1$/, "");
        const lookupId = normaliseGameIdForLookup(gameId);
        const gameName =
          isVcd || isCue
            ? await findPs1GameName(lookupId)
            : await findPs2GameName(lookupId);

        return {
          success: true,
          gameId,
          formattedGameId: lookupId,
          ...(gameName ? { gameName } : {}),
        };
      }

      carry =
        chunk.length > FILE_SCAN_OVERLAP_BYTES
          ? chunk.slice(-FILE_SCAN_OVERLAP_BYTES)
          : chunk;
    }

    return {
      success: false,
      message: "Could not locate a game ID inside the provided file.",
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Failed while reading file contents.",
    };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

export async function convertBinToIso(
  cueFilePath: string,
  outputIsoPath: string
) {
  try {
    return { success: true, message: "Conversion completed successfully." };
  } catch (err: any) {
    return { success: false, message: err?.message || "Conversion failed." };
  }
}

export async function convertCueToVcd(
  cueFilePath: string,
  outputVcdPath: string,
  onProgress?: (progress: {
    percent: number;
    writtenMB: number;
    totalMB: number;
  }) => void,
  onStage?: (stage: string) => void
) {
  let cleanupDir: string | undefined;
  let cueToUse = cueFilePath;
  let progressTimer: NodeJS.Timeout | undefined;
  try {
    const mergeResult = await mergeCueIfNeeded(cueFilePath, onStage);
    cueToUse = mergeResult.cuePath;
    cleanupDir = mergeResult.cleanupDir;

    const totalBytes = await getCueTotalSize(cueToUse);

    const bundledConverter = getBundledCue2PopsPath();
    const command = bundledConverter
      ? undefined
      : buildConverterCommand(cueToUse, outputVcdPath);
    if (!bundledConverter && !command) {
      return {
        success: false,
        message: `Missing converter. Bundle cue2pops.exe or set ${POPS_CONVERTER_ENV} with {cue} and {vcd} placeholders.`,
      };
    }

    await fs.mkdir(path.dirname(outputVcdPath), { recursive: true });
    const startTimestamp = Date.now() - 500;

    onStage?.("Importing...");
    if (onProgress && totalBytes > 0) {
      progressTimer = setInterval(async () => {
        try {
          const stat = await fs.stat(outputVcdPath);
          const written = stat.size;
          const percent = Math.min(99.9, (written / totalBytes) * 100);
          onProgress({
            percent: Number(percent.toFixed(1)),
            writtenMB: Number((written / (1024 * 1024)).toFixed(2)),
            totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
          });
        } catch {
          // file may not exist yet
        }
      }, 1000);
    }

    if (bundledConverter) {
      await runExecutable(bundledConverter, [cueToUse, outputVcdPath]);
    } else if (command) {
      await runShellCommand(command);
    }

    onStage?.("Finalizing...");
    if (onProgress && totalBytes > 0) {
      onProgress({
        percent: 100,
        writtenMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      });
    }

    try {
      await fs.stat(outputVcdPath);
      return { success: true, newPath: outputVcdPath };
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }

    const recentFiles = await findRecentVcdFiles(
      path.dirname(outputVcdPath),
      startTimestamp
    );
    if (recentFiles.length === 0) {
      return {
        success: false,
        message:
          "Conversion completed but no VCD output was detected in the POPS directory.",
      };
    }

    const detectedPath = recentFiles[0].path;
    if (detectedPath !== outputVcdPath) {
      try {
        await fs.rename(detectedPath, outputVcdPath);
      } catch (renameErr: any) {
        return {
          success: false,
          message:
            renameErr?.message ||
            "Unable to rename the generated VCD to the expected filename.",
        };
      }
    }

    return { success: true, newPath: outputVcdPath };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Conversion failed.",
    };
  } finally {
    onStage?.("Done");
    if (progressTimer) {
      clearInterval(progressTimer);
    }
    if (cleanupDir) {
      try {
        await fs.rm(cleanupDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

export async function openAskGameFile(isGameCd: boolean, isGameDvd: boolean) {
  const properties = ["openFile"];
  // if gameCd ask for .cue file, if gameDvd ask for .iso/.zso
  const filters = [];
  if (isGameCd) {
    filters.push({ name: "CUE Files", extensions: ["cue"] });
  }
  if (isGameDvd) {
    filters.push({ name: "ISO/ZSO Files", extensions: ["iso", "zso"] });
  }
  const result = await dialog.showOpenDialog({
    ...properties,
    filters,
    title: "Select Game File to Import",
  });

  return result;
}

export async function moveFile(
  sourcePath: string,
  destPath: string,
  onProgress?: (progress: {
    percent: number;
    copiedMB: number;
    totalMB: number;
    elapsed: number;
  }) => void
) {
  console.log("Moving file from", sourcePath, "to", destPath);

  let targetPath = destPath;

  try {
    const destStats = await fs.stat(destPath);
    if (destStats.isDirectory()) {
      targetPath = path.join(destPath, path.basename(sourcePath));
    }
  } catch (statErr: any) {
    if (statErr?.code !== "ENOENT") {
      return { success: false, message: statErr?.message || String(statErr) };
    }
  }

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
  } catch (mkdirErr: any) {
    if (mkdirErr?.code !== "EEXIST") {
      return { success: false, message: mkdirErr?.message || String(mkdirErr) };
    }
  }

  try {
    await fs.rename(sourcePath, targetPath);
    console.log("File moved successfully using rename");
    return { success: true, newPath: targetPath };
  } catch (err: any) {
    if (err?.code === "EXDEV") {
      try {
        console.log("Cross-device move detected, starting file copy...");
        const stats = await fs.stat(sourcePath);
        const totalSize = stats.size;
        const startTime = Date.now();

        // Use streams for progress tracking
        await new Promise<void>((resolve, reject) => {
          const readStream = fsSync.createReadStream(sourcePath);
          const writeStream = fsSync.createWriteStream(targetPath);

          let copiedBytes = 0;
          let lastLogTime = Date.now();
          const LOG_INTERVAL_MS = 1000; // Log every second

          readStream.on("data", (chunk: string | Buffer) => {
            copiedBytes += Buffer.isBuffer(chunk)
              ? chunk.length
              : Buffer.byteLength(chunk);
            const now = Date.now();

            if (now - lastLogTime >= LOG_INTERVAL_MS) {
              const progress = ((copiedBytes / totalSize) * 100).toFixed(1);
              const copiedMB = (copiedBytes / (1024 * 1024)).toFixed(2);
              const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
              const elapsed = ((now - startTime) / 1000).toFixed(1);
              console.log(
                `Progress: ${progress}% (${copiedMB}/${totalMB} MB) - ${elapsed}s elapsed`
              );

              if (onProgress) {
                onProgress({
                  percent: parseFloat(progress),
                  copiedMB: parseFloat(copiedMB),
                  totalMB: parseFloat(totalMB),
                  elapsed: parseFloat(elapsed),
                });
              }

              lastLogTime = now;
            }
          });

          readStream.on("error", reject);
          writeStream.on("error", reject);
          writeStream.on("finish", resolve);

          readStream.pipe(writeStream);
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`File copied successfully: ${sizeMB} MB in ${duration}s`);
        console.log("move complete");
        return { success: true, newPath: targetPath };
      } catch (copyErr: any) {
        return { success: false, message: copyErr?.message || String(copyErr) };
      }
    }
    return { success: false, message: err?.message || String(err) };
  }
}
