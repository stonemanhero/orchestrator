import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const execFileAsync = promisify(execFile);

export const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), "Projects");
export const CONFIG_DIR = path.join(os.homedir(), ".config", "orchestrator");
export const CONFIG_PATH = path.join(CONFIG_DIR, "projects.json");
export const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");
export const CHROME_LOCAL_STATE = path.join(
  os.homedir(),
  ".config",
  "google-chrome",
  "Local State"
);
export const PHPSTORM_BIN = path.join(
  os.homedir(),
  ".local",
  "share",
  "JetBrains",
  "Toolbox",
  "scripts",
  "phpstorm"
);

export interface AppSettings {
  projectsRoot: string;
}

export interface CustomCommand {
  id: string;
  label: string;
  target: "container" | "host";
  service?: string;
  workingDir?: string; // relative path from project root (e.g. "." or "wp-content/themes/certa")
  command: string;
  autoRunOnSwitch?: boolean;
}

export interface SshSessionConfig {
  id: string;
  label?: string;
  command: string; // e.g. "ssh user@1.2.3.4 -p 22"
  password?: string; // optional, can be empty
}

export interface ProjectConfig {
  favorite?: boolean;
  notes?: string;
  stopOthersOnSwitch?: boolean;
  startDockerOnSwitch?: boolean;
  openPhpStormOnSwitch?: boolean;
  openChromeOnSwitch?: boolean;
  chromeProfile?: string;
  urls?: string[];
  commands?: CustomCommand[];
  sshSessions?: SshSessionConfig[];
  lastOpenedAt?: number;
}

export interface RunningContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  composeProject: string;
  composeService: string;
  workingDir: string;
}

export interface PackageJsonLocation {
  relDir: string; // e.g. "." or "wp-content/themes/certa"
  scripts: Record<string, string>;
}

export interface ProjectInfo {
  name: string;
  path: string;
  gitRemote: string | null;
  hasDockerCompose: boolean;
  composeFile: string | null;
  composeServices: string[];
  hasPhpStorm: boolean;
  isPhpStormOpen: boolean;
  hasPackageJson: boolean;
  npmScripts: Record<string, string>;
  packageJsonLocations: PackageJsonLocation[];
  detectedUrls: string[];
  detectedEnvProjectName: string | null;
  runningContainers: RunningContainer[];
  isRunning: boolean;
  config: ProjectConfig;
}

export interface ChromeProfile {
  directory: string;
  name: string;
  userName: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  project: string;
  source: string;
  line: string;
  stream: "stdout" | "stderr" | "system";
}

export interface ActiveProcessInfo {
  id: string;
  project: string;
  label: string;
  command: string;
  workingDir?: string;
  startedAt: string;
  running: boolean;
  exitCode: number | null;
}

class OrchestratorState {
  logs: LogEntry[] = [];
  processes: Map<
    string,
    {
      info: ActiveProcessInfo;
      kill: () => void;
    }
  > = new Map();

  addLog(project: string, source: string, line: string, stream: "stdout" | "stderr" | "system" = "stdout") {
    const clean = line.replace(/\r$/, "");
    if (!clean.trim() && stream !== "system") return;
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      project,
      source,
      line: clean,
      stream,
    };
    this.logs.push(entry);
    if (this.logs.length > 1500) {
      this.logs.splice(0, this.logs.length - 1500);
    }
  }
}

export const state = new OrchestratorState();

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      if (parsed.projectsRoot && typeof parsed.projectsRoot === "string") {
        return { projectsRoot: parsed.projectsRoot };
      }
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return { projectsRoot: DEFAULT_PROJECTS_ROOT };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
  };
  if (next.projectsRoot.startsWith("~")) {
    next.projectsRoot = path.join(os.homedir(), next.projectsRoot.slice(1));
  }
  next.projectsRoot = path.resolve(next.projectsRoot);

  if (!fs.existsSync(next.projectsRoot) || !fs.statSync(next.projectsRoot).isDirectory()) {
    throw new Error(`Directory does not exist: ${next.projectsRoot}`);
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function getProjectsRoot(): string {
  return loadSettings().projectsRoot;
}

export function loadSavedConfigs(): Record<string, ProjectConfig> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load config:", e);
  }
  return {};
}

export function saveProjectConfig(projectName: string, config: ProjectConfig): Record<string, ProjectConfig> {
  const all = loadSavedConfigs();
  all[projectName] = { ...(all[projectName] || {}), ...config };
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(all, null, 2), "utf-8");
  return all;
}

const recentPhpStormLaunches = new Map<string, number>();

export function markPhpStormLaunching(projectPath: string) {
  recentPhpStormLaunches.set(path.resolve(projectPath), Date.now());
}

/**
 * Detects which project paths are currently open in PhpStorm on Linux:
 * 1. Verifies the main PhpStorm IDE process is actually running (ignoring stale stdioMcpServer / helper processes).
 * 2. Reads ~/.config/JetBrains/PhpStorm<version>/options/recentProjects.xml for entries with opened="true".
 * 3. Replays live project open/close events from ~/.cache/JetBrains/PhpStorm<version>/log/idea.log
 *    because PhpStorm does not always flush recentProjects.xml to disk immediately when a second project window is opened.
 */
export function getOpenPhpStormProjectPaths(): Set<string> {
  const openPaths = new Set<string>();
  const mainPhpStormPids = new Set<string>();

  try {
    const procEntries = fs.readdirSync("/proc", { withFileTypes: true });
    for (const entry of procEntries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pidDir = path.join("/proc", entry.name);
      try {
        const rawCmdline = fs.readFileSync(path.join(pidDir, "cmdline"), "utf-8");
        const args = rawCmdline.split("\0").filter(Boolean);
        if (args.length === 0) continue;

        const exe = args[0].toLowerCase();
        const fullCmd = args.join(" ").toLowerCase();

        // Match actual PhpStorm IDE process, excluding stdioMcpServer / fsnotifier / acp helpers
        if (
          (exe.endsWith("/bin/phpstorm") || exe.endsWith("/phpstorm64.vmoptions") || exe === "phpstorm") &&
          !fullCmd.includes("stdiomcpserver") &&
          !fullCmd.includes("fsnotifier")
        ) {
          mainPhpStormPids.add(entry.name);
          // If a project path was passed directly as a CLI argument to phpstorm
          for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (!arg.startsWith("-") && arg.startsWith("/")) {
              openPaths.add(path.resolve(arg));
            }
          }
        }
      } catch {
        // process may have exited
      }
    }
  } catch {
    // ignore
  }

  // If the main PhpStorm IDE is not running at all, no projects are open
  if (mainPhpStormPids.size === 0) {
    recentPhpStormLaunches.clear();
    return new Set<string>();
  }

  let latestDir: string | undefined;

  // 1. Parse recentProjects.xml from the latest PhpStorm config folder for opened="true"
  try {
    const jbBase = path.join(os.homedir(), ".config", "JetBrains");
    if (fs.existsSync(jbBase)) {
      const dirs = fs
        .readdirSync(jbBase)
        .filter((d) => d.startsWith("PhpStorm"))
        .sort()
        .reverse();
      latestDir = dirs[0];
      if (latestDir) {
        const xmlPath = path.join(jbBase, latestDir, "options", "recentProjects.xml");
        if (fs.existsSync(xmlPath)) {
          const xml = fs.readFileSync(xmlPath, "utf-8");
          const entryRegex =
            /<entry\s+key="([^"]+)">[\s\S]*?<RecentProjectMetaInfo([^>]*)>/g;
          let match;
          while ((match = entryRegex.exec(xml)) !== null) {
            const rawKey = match[1];
            const attrs = match[2];
            if (attrs.includes('opened="true"')) {
              const resolved = rawKey.replace("$USER_HOME$", os.homedir());
              openPaths.add(path.resolve(resolved));
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Parse live idea.log events (PhpStorm logs project open/close immediately even before XML flush)
  try {
    const cacheBase = path.join(os.homedir(), ".cache", "JetBrains");
    const cacheDir =
      latestDir && fs.existsSync(path.join(cacheBase, latestDir))
        ? latestDir
        : fs.existsSync(cacheBase)
        ? fs
            .readdirSync(cacheBase)
            .filter((d) => d.startsWith("PhpStorm"))
            .sort()
            .reverse()[0]
        : undefined;

    if (cacheDir) {
      const logPath = path.join(cacheBase, cacheDir, "log", "idea.log");
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, "utf-8");
        const nameToPath = new Map<string, string>();
        for (const p of openPaths) {
          nameToPath.set(path.basename(p), p);
        }

        for (const line of logContent.split("\n")) {
          if (line.includes("IDE STARTED") || line.includes("IDE SHUTDOWN")) {
            // Reset transient log state across full IDE restarts
            continue;
          }

          // Match: Setting project frame to Project(name=ast, ..., componentStore=/home/stone/Projects/ast)
          // or: Saving Project(name=ast, ..., componentStore=/home/stone/Projects/ast)
          const storeMatch = line.match(
            /Project\(name=([^,\s)]+)[^)]*componentStore=([^)\s]+)\)/
          );
          if (storeMatch) {
            const projName = storeMatch[1].trim();
            const projPath = path.resolve(storeMatch[2].trim());
            nameToPath.set(projName, projPath);
            if (line.includes("ProjectFrameHelper")) {
              openPaths.add(projPath);
            }
          }

          // Match: Add project root /home/stone/Projects/ast to project ast
          const addRootMatch = line.match(
            /Add project root (\/[^\s]+) to project ([^\s(]+)/
          );
          if (addRootMatch) {
            const projPath = path.resolve(addRootMatch[1].trim());
            const projName = addRootMatch[2].trim();
            nameToPath.set(projName, projPath);
            openPaths.add(projPath);
          }

          // Match: reason=project_closed, project=ast, path=/home/stone/Projects/ast
          const closedPathMatch = line.match(
            /reason=project_closed,\s*project=([^,\s]+),\s*path=(\/[^\s]+)/
          );
          if (closedPathMatch) {
            const projPath = path.resolve(closedPathMatch[2].trim());
            openPaths.delete(projPath);
            recentPhpStormLaunches.delete(projPath);
          }

          // Match: Project ast is removed from the list of initializing and open projects.
          const disposedMatch = line.match(
            /Project ([^\s]+) is removed from the list of initializing and open projects/
          );
          if (disposedMatch) {
            const projName = disposedMatch[1].trim();
            const mapped = nameToPath.get(projName);
            if (mapped) {
              openPaths.delete(mapped);
              recentPhpStormLaunches.delete(mapped);
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Include any project launched via Orchestrator within the last 12 seconds while PhpStorm window initializes
  const now = Date.now();
  for (const [launchedPath, ts] of recentPhpStormLaunches.entries()) {
    if (now - ts < 12000) {
      openPaths.add(launchedPath);
    } else {
      recentPhpStormLaunches.delete(launchedPath);
    }
  }

  return openPaths;
}

export function getChromeProfiles(): ChromeProfile[] {
  const profiles: ChromeProfile[] = [];
  try {
    if (fs.existsSync(CHROME_LOCAL_STATE)) {
      const raw = JSON.parse(fs.readFileSync(CHROME_LOCAL_STATE, "utf-8"));
      const cache = raw?.profile?.info_cache || {};
      for (const [dir, info] of Object.entries<any>(cache)) {
        profiles.push({
          directory: dir,
          name: info?.name || dir,
          userName: info?.user_name || "",
        });
      }
    }
  } catch (e) {
    console.error("Error reading Chrome profiles:", e);
  }
  if (profiles.length === 0) {
    profiles.push({ directory: "Default", name: "Default", userName: "" });
  }
  return profiles;
}

function parseEnvFile(envPath: string): Record<string, string> {
  const res: Record<string, string> = {};
  try {
    if (!fs.existsSync(envPath)) return res;
    const content = fs.readFileSync(envPath, "utf-8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        res[key] = val;
      }
    }
  } catch {
    // ignore
  }
  return res;
}

function parseComposeServices(composePath: string): string[] {
  const services: string[] = [];
  try {
    const content = fs.readFileSync(composePath, "utf-8");
    const lines = content.split("\n");
    let inServices = false;
    let serviceIndent: number | null = null;

    for (const rawLine of lines) {
      if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
      const indent = rawLine.search(/\S/);
      const trimmed = rawLine.trim();

      if (indent === 0) {
        if (trimmed.startsWith("services:")) {
          inServices = true;
          serviceIndent = null;
          continue;
        } else {
          inServices = false;
        }
      } else if (inServices) {
        if (serviceIndent === null && trimmed.endsWith(":")) {
          serviceIndent = indent;
        }
        if (indent === serviceIndent && /^[a-zA-Z0-9._-]+:\s*(#.*)?$/.test(trimmed)) {
          const svcName = trimmed.split(":")[0].trim();
          services.push(svcName);
        }
      }
    }
  } catch {
    // ignore
  }
  return services;
}

/**
 * Finds package.json in root, wp-content/themes/*, wp-content/plugins/*, apps/*, packages/*, Modules/*
 */
function findPackageJsonLocations(projectPath: string): PackageJsonLocation[] {
  const locations: PackageJsonLocation[] = [];

  const readPkg = (relDir: string) => {
    const full = relDir === "." ? path.join(projectPath, "package.json") : path.join(projectPath, relDir, "package.json");
    try {
      if (fs.existsSync(full)) {
        const pkg = JSON.parse(fs.readFileSync(full, "utf-8"));
        locations.push({
          relDir,
          scripts: pkg.scripts || {},
        });
      }
    } catch {
      // ignore
    }
  };

  readPkg(".");

  const parentDirs = [
    "wp-content/themes",
    "wp-content/plugins",
    "src/wp-content/themes",
    "public/wp-content/themes",
    "apps",
    "packages",
    "Modules",
    "frontend",
    "client",
  ];

  for (const parentRel of parentDirs) {
    const fullParent = path.join(projectPath, parentRel);
    try {
      if (!fs.existsSync(fullParent) || !fs.statSync(fullParent).isDirectory()) continue;
      if (fs.existsSync(path.join(fullParent, "package.json"))) {
        readPkg(parentRel);
      }
      const children = fs.readdirSync(fullParent, { withFileTypes: true });
      for (const child of children) {
        if (child.isDirectory() && !child.name.startsWith(".")) {
          readPkg(path.join(parentRel, child.name));
        }
      }
    } catch {
      // ignore
    }
  }

  return locations;
}

function detectUrlsForProject(projectName: string, projectPath: string, env: Record<string, string>, composeContent: string): string[] {
  const urls = new Set<string>();

  if (env.APP_URL && env.APP_URL.startsWith("http")) {
    urls.add(env.APP_URL);
  }
  if (env.WP_SITEURL && env.WP_SITEURL.startsWith("http")) {
    urls.add(env.WP_SITEURL);
  }
  if (env.WP_PORT_HOST) {
    const port = env.WP_PORT_HOST;
    urls.add(port === "80" ? "http://localhost" : `http://localhost:${port}`);
  }
  if (env.HTTP_PORT) {
    urls.add(`http://localhost:${env.HTTP_PORT}`);
  }
  if (env.APP_PORT && env.APP_PORT !== "80") {
    urls.add(`http://localhost:${env.APP_PORT}`);
  }
  if (env.PMA_PORT_HOST) {
    urls.add(`http://localhost:${env.PMA_PORT_HOST}`);
  }
  if (env.FORWARD_PHPMYADMIN_PORT) {
    urls.add(`http://localhost:${env.FORWARD_PHPMYADMIN_PORT}`);
  }

  const portRegex = /["']?(\d{2,5}):80["']?/g;
  let match;
  while ((match = portRegex.exec(composeContent)) !== null) {
    const hostPort = match[1];
    urls.add(hostPort === "80" ? "http://localhost" : `http://localhost:${hostPort}`);
  }

  try {
    const hosts = fs.readFileSync("/etc/hosts", "utf-8");
    const cleanName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const hostMatches = hosts.match(new RegExp(`\\b([a-z0-9-]+\\.local)\\b`, "gi")) || [];
    for (const h of hostMatches) {
      const prefix = h.replace(/\.local$/i, "").toLowerCase();
      if (prefix === cleanName || (cleanName.length >= 4 && prefix.includes(cleanName))) {
        urls.add(`http://${h}`);
      }
    }
  } catch {
    // ignore
  }

  if (urls.size === 0 && composeContent) {
    urls.add("http://localhost");
  }

  return Array.from(urls);
}

export async function getRunningContainers(): Promise<RunningContainer[]> {
  try {
    const format =
      "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}\t{{.Label \"com.docker.compose.project.working_dir\"}}";
    const { stdout } = await execFileAsync("docker", ["ps", "--format", format]);
    const list: RunningContainer[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [id, name, image, status, ports, composeProject, composeService, workingDir] =
        line.split("\t");
      list.push({
        id: id || "",
        name: name || "",
        image: image || "",
        status: status || "",
        ports: ports || "",
        composeProject: composeProject || "",
        composeService: composeService || "",
        workingDir: workingDir || "",
      });
    }
    return list;
  } catch (e) {
    console.error("Failed to list running docker containers:", e);
    return [];
  }
}

function buildDefaultConfig(
  name: string,
  hasDockerCompose: boolean,
  composeServices: string[],
  packageJsonLocations: PackageJsonLocation[],
  detectedUrls: string[],
  existing?: ProjectConfig
): ProjectConfig {
  const defaultCommands: CustomCommand[] = [];

  const primaryService =
    composeServices.find((s) =>
      ["laravel.test", "app", "wordpress", "web", "node", "frontend"].includes(s)
    ) ||
    composeServices.find(
      (s) =>
        !["db", "mysql", "mariadb", "postgres", "redis", "phpmyadmin", "mailhog", "wpcli"].includes(
          s
        )
    ) ||
    composeServices[0];

  for (const loc of packageJsonLocations) {
    const dirLabel = loc.relDir === "." ? "root" : loc.relDir;
    const scripts = loc.scripts;

    for (const scriptName of ["dev", "watch", "build"]) {
      if (!scripts[scriptName]) continue;
      defaultCommands.push({
        id: `npm-${scriptName}-host-${loc.relDir.replace(/[^a-z0-9]/gi, "-")}`,
        label: `npm run ${scriptName} (${dirLabel})`,
        target: "host",
        workingDir: loc.relDir,
        command: `npm run ${scriptName}`,
        autoRunOnSwitch: false,
      });

      if (
        hasDockerCompose &&
        primaryService &&
        loc.relDir === "." &&
        (primaryService.includes("laravel") ||
          primaryService === "app" ||
          primaryService.includes("local"))
      ) {
        defaultCommands.push({
          id: `npm-${scriptName}-container`,
          label: `Container (${primaryService}): npm run ${scriptName}`,
          target: "container",
          service: primaryService,
          workingDir: ".",
          command: `npm run ${scriptName}`,
          autoRunOnSwitch: false,
        });
      }
    }
  }

  return {
    favorite: existing?.favorite ?? false,
    notes: existing?.notes ?? "",
    stopOthersOnSwitch: existing?.stopOthersOnSwitch ?? true,
    startDockerOnSwitch: existing?.startDockerOnSwitch ?? hasDockerCompose,
    openPhpStormOnSwitch: existing?.openPhpStormOnSwitch ?? true,
    openChromeOnSwitch: existing?.openChromeOnSwitch ?? detectedUrls.length > 0,
    chromeProfile: existing?.chromeProfile ?? "Default",
    urls: existing?.urls ?? detectedUrls,
    commands:
      existing?.commands && existing.commands.length > 0
        ? existing.commands
        : defaultCommands,
    sshSessions: existing?.sshSessions ?? [],
    lastOpenedAt: existing?.lastOpenedAt ?? 0,
  };
}

function detectGitRemote(projectPath: string): string | null {
  try {
    const gitConfigPath = path.join(projectPath, ".git", "config");
    if (!fs.existsSync(gitConfigPath)) return null;
    const content = fs.readFileSync(gitConfigPath, "utf-8");
    const match = content.match(/^\s*url\s*=\s*(.+)$/m);
    if (!match) return null;
    return match[1].trim();
  } catch {
    return null;
  }
}

export async function scanProjects(): Promise<ProjectInfo[]> {
  const projectsRoot = getProjectsRoot();
  const savedConfigs = loadSavedConfigs();
  const runningContainers = await getRunningContainers();
  const openPhpStormPaths = getOpenPhpStormProjectPaths();

  if (!fs.existsSync(projectsRoot)) {
    return [];
  }

  const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const projectPath = path.join(projectsRoot, entry.name);
    const resolvedProjectPath = path.resolve(projectPath);
    const gitRemote = detectGitRemote(projectPath);

    const composeCandidates = [
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yaml",
      "compose.yml",
    ];
    let composeFile: string | null = null;
    for (const candidate of composeCandidates) {
      if (fs.existsSync(path.join(projectPath, candidate))) {
        composeFile = candidate;
        break;
      }
    }

    const hasDockerCompose = composeFile !== null;
    const composePath = composeFile ? path.join(projectPath, composeFile) : null;
    const composeServices = composePath ? parseComposeServices(composePath) : [];
    const composeContent = composePath ? fs.readFileSync(composePath, "utf-8") : "";

    const hasPhpStorm = fs.existsSync(path.join(projectPath, ".idea"));
    const isPhpStormOpen =
      openPhpStormPaths.has(resolvedProjectPath) ||
      Array.from(openPhpStormPaths).some((p) => p.startsWith(resolvedProjectPath + path.sep));

    const packageJsonLocations = findPackageJsonLocations(projectPath);
    const hasPackageJson = packageJsonLocations.length > 0;
    const npmScripts = packageJsonLocations[0]?.scripts || {};

    const envVars = parseEnvFile(path.join(projectPath, ".env"));
    const detectedUrls = detectUrlsForProject(entry.name, projectPath, envVars, composeContent);

    const projectContainers = runningContainers.filter((c) => {
      if (c.workingDir && path.resolve(c.workingDir) === resolvedProjectPath) {
        return true;
      }
      if (c.composeProject && c.composeProject.toLowerCase() === entry.name.toLowerCase()) {
        return true;
      }
      if (envVars.PROJECT_NAME && c.name.startsWith(`${envVars.PROJECT_NAME}_`)) {
        return true;
      }
      return false;
    });

    const config = buildDefaultConfig(
      entry.name,
      hasDockerCompose,
      composeServices,
      packageJsonLocations,
      detectedUrls,
      savedConfigs[entry.name]
    );

    projects.push({
      name: entry.name,
      path: projectPath,
      gitRemote,
      hasDockerCompose,
      composeFile,
      composeServices,
      hasPhpStorm,
      isPhpStormOpen,
      hasPackageJson,
      npmScripts,
      packageJsonLocations,
      detectedUrls,
      detectedEnvProjectName: envVars.PROJECT_NAME || null,
      runningContainers: projectContainers,
      isRunning: projectContainers.length > 0,
      config,
    });
  }

  projects.sort((a, b) => {
    if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
    if (Boolean(a.config.favorite) !== Boolean(b.config.favorite)) {
      return a.config.favorite ? -1 : 1;
    }
    if ((a.config.lastOpenedAt || 0) !== (b.config.lastOpenedAt || 0)) {
      return (b.config.lastOpenedAt || 0) - (a.config.lastOpenedAt || 0);
    }
    return a.name.localeCompare(b.name);
  });

  return projects;
}

export async function stopOtherDockerProjects(exceptProjectPath?: string, exceptProjectName?: string): Promise<string[]> {
  const containers = await getRunningContainers();
  const stopped: string[] = [];

  const workingDirs = new Map<string, RunningContainer[]>();
  const standaloneContainers: RunningContainer[] = [];

  for (const c of containers) {
    if (
      exceptProjectPath &&
      c.workingDir &&
      path.resolve(c.workingDir) === path.resolve(exceptProjectPath)
    ) {
      continue;
    }
    if (
      exceptProjectName &&
      c.composeProject &&
      c.composeProject.toLowerCase() === exceptProjectName.toLowerCase()
    ) {
      continue;
    }

    if (c.workingDir && fs.existsSync(c.workingDir)) {
      const list = workingDirs.get(c.workingDir) || [];
      list.push(c);
      workingDirs.set(c.workingDir, list);
    } else {
      standaloneContainers.push(c);
    }
  }

  for (const [dir, list] of workingDirs.entries()) {
    const projName = list[0]?.composeProject || path.basename(dir);
    state.addLog(projName, "docker", `Stopping project stack in ${dir}...`, "system");
    try {
      await execFileAsync("docker", ["compose", "stop"], { cwd: dir });
      stopped.push(projName);
      state.addLog(projName, "docker", `Stopped ${projName} stack.`, "system");
    } catch (e: any) {
      state.addLog(projName, "docker", `Fallback stopping containers for ${projName}: ${e.message}`, "stderr");
      for (const c of list) {
        await execFileAsync("docker", ["stop", c.id]).catch(() => {});
      }
      stopped.push(projName);
    }
  }

  if (standaloneContainers.length > 0) {
    for (const c of standaloneContainers) {
      state.addLog(c.composeProject || c.name, "docker", `Stopping container ${c.name}...`, "system");
      await execFileAsync("docker", ["stop", c.id]).catch(() => {});
      stopped.push(c.name);
    }
  }

  return stopped;
}

export function startProjectDocker(projectName: string, projectPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    state.addLog(projectName, "docker compose", `Starting Docker containers in ${projectPath}...`, "system");
    const proc = spawn("docker", ["compose", "up", "-d"], {
      cwd: projectPath,
      env: { ...process.env },
    });

    proc.stdout.on("data", (data) => {
      for (const line of data.toString().split("\n")) {
        state.addLog(projectName, "docker compose", line, "stdout");
      }
    });

    proc.stderr.on("data", (data) => {
      for (const line of data.toString().split("\n")) {
        state.addLog(projectName, "docker compose", line, "stdout");
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        state.addLog(projectName, "docker compose", `Docker stack for ${projectName} is UP.`, "system");
        resolve();
      } else {
        state.addLog(projectName, "docker compose", `docker compose up exited with code ${code}`, "stderr");
        reject(new Error(`docker compose up exited with code ${code}`));
      }
    });
  });
}

export function stopProjectDocker(projectName: string, projectPath: string): Promise<void> {
  return new Promise((resolve) => {
    state.addLog(projectName, "docker compose", `Stopping Docker containers for ${projectName}...`, "system");
    const proc = spawn("docker", ["compose", "stop"], {
      cwd: projectPath,
      env: { ...process.env },
    });

    proc.stdout.on("data", (data) => {
      for (const line of data.toString().split("\n")) {
        state.addLog(projectName, "docker compose", line, "stdout");
      }
    });

    proc.stderr.on("data", (data) => {
      for (const line of data.toString().split("\n")) {
        state.addLog(projectName, "docker compose", line, "stdout");
      }
    });

    proc.on("close", (code) => {
      state.addLog(projectName, "docker compose", `Stopped Docker containers for ${projectName} (code ${code}).`, "system");
      resolve();
    });
  });
}

export function openInPhpStorm(projectName: string, projectPath: string) {
  markPhpStormLaunching(projectPath);
  state.addLog(projectName, "phpstorm", `Launching PhpStorm for ${projectPath}`, "system");
  const bin = fs.existsSync(PHPSTORM_BIN) ? PHPSTORM_BIN : "phpstorm";
  const child = spawn(bin, [projectPath], {
    cwd: projectPath,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function openInTerminal(projectName: string, projectPath: string, containerService?: string, relDir?: string) {
  const targetHostDir =
    relDir && relDir !== "." ? path.join(projectPath, relDir) : projectPath;

  state.addLog(
    projectName,
    "terminal",
    containerService
      ? `Opening interactive terminal inside container service '${containerService}'`
      : `Opening host terminal at ${targetHostDir}`,
    "system"
  );

  if (containerService) {
    const cdCmd = relDir && relDir !== "." ? `cd "${relDir}" 2>/dev/null || true; ` : "";
    const child = spawn(
      "gnome-terminal",
      [
        "--working-directory",
        projectPath,
        "--",
        "bash",
        "-c",
        `docker compose exec ${containerService} bash -c '${cdCmd}exec bash' || docker compose exec ${containerService} sh; exec bash`,
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
  } else {
    const child = spawn("gnome-terminal", ["--working-directory", targetHostDir], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

function getSshHelperScript(): string {
  const baseDir =
    typeof import.meta.dirname === "string"
      ? import.meta.dirname
      : path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(baseDir, "ssh-helper.py"),
    path.resolve(baseDir, "server/ssh-helper.py"),
    path.resolve(baseDir, "../server/ssh-helper.py"),
  ];
  return (
    candidates.find((p) => fs.existsSync(p)) ||
    path.resolve(baseDir, "ssh-helper.py")
  );
}

export function openSshSession(
  projectName: string,
  projectPath: string,
  ssh: { command: string; password?: string; label?: string }
) {
  const cmd = (ssh.command || "").trim();
  if (!cmd) return;
  const helperScript = getSshHelperScript();
  state.addLog(
    projectName,
    "ssh",
    `Launching SSH session${ssh.label ? ` (${ssh.label})` : ""}: ${cmd}`,
    "system"
  );

  const child = spawn(
    "gnome-terminal",
    [
      "--working-directory",
      fs.existsSync(projectPath) ? projectPath : os.homedir(),
      "--",
      "bash",
      "-c",
      `python3 "${helperScript}"; echo ""; echo "SSH session ended."; exec bash`,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ORCHESTRATOR_SSH_CMD: cmd,
        ORCHESTRATOR_SSH_PASS: ssh.password || "",
      },
    }
  );
  child.unref();
}

export function testSshConnection(
  projectName: string,
  projectPath: string,
  ssh: { command: string; password?: string; label?: string }
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const cmd = (ssh.command || "").trim();
    if (!cmd) {
      resolve({ ok: false, message: "No SSH command specified." });
      return;
    }

    const helperScript = getSshHelperScript();
    state.addLog(
      projectName,
      "ssh-test",
      `Testing SSH connection${ssh.label ? ` (${ssh.label})` : ""}: ${cmd}`,
      "system"
    );

    const child = spawn("python3", [helperScript, "--test"], {
      cwd: fs.existsSync(projectPath) ? projectPath : os.homedir(),
      env: {
        ...process.env,
        ORCHESTRATOR_SSH_CMD: cmd,
        ORCHESTRATOR_SSH_PASS: ssh.password || "",
      },
    });

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });

    child.on("close", (code) => {
      const msg =
        output.trim() ||
        (code === 0 ? "SSH connection verified." : `SSH test failed (code ${code})`);
      state.addLog(
        projectName,
        "ssh-test",
        msg,
        code === 0 ? "system" : "stderr"
      );
      resolve({ ok: code === 0, message: msg });
    });
  });
}

export function openInChrome(projectName: string, profileDir: string, urls: string[]) {
  const targetUrls = urls.filter((u) => u && u.trim().length > 0);
  const args = [`--profile-directory=${profileDir || "Default"}`, ...targetUrls];
  state.addLog(
    projectName,
    "chrome",
    `Launching Chrome (${profileDir || "Default"}) -> ${targetUrls.join(", ") || "new window"}`,
    "system"
  );
  const child = spawn("google-chrome", args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function spawnProjectCommand(projectName: string, projectPath: string, cmd: CustomCommand): ActiveProcessInfo {
  const procId = `${projectName}:${cmd.id}:${Date.now()}`;
  const relDir = (cmd.workingDir || ".").trim() || ".";
  const label =
    cmd.label ||
    `${cmd.target === "container" ? `container(${cmd.service})` : "host"} [${relDir}]: ${cmd.command}`;

  let binary = "bash";
  let args: string[] = [];
  let spawnCwd = projectPath;

  const enhancedPath = `${path.dirname(process.execPath)}:${process.env.PATH || ""}`;

  if (cmd.target === "container" && cmd.service) {
    binary = "docker";
    const isWpCli = cmd.service.toLowerCase().includes("wpcli") || cmd.service.toLowerCase() === "wp";

    if (isWpCli) {
      const cleanedWpArgs = cmd.command.trim().replace(/^wp\s+/i, "");
      args = [
        "compose",
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        cmd.service,
        "-lc",
        `wp ${cleanedWpArgs}`,
      ];
      spawnCwd = projectPath;
      state.addLog(
        projectName,
        label,
        `$ docker compose run --rm ${cmd.service} wp ${cleanedWpArgs}`,
        "system"
      );
    } else {
      const innerCommand =
        relDir && relDir !== "."
          ? `cd "${relDir}" && ${cmd.command}`
          : cmd.command;
      args = [
        "compose",
        "exec",
        "-T",
        cmd.service,
        "sh",
        "-lc",
        innerCommand,
      ];
      spawnCwd = projectPath;
      state.addLog(
        projectName,
        label,
        `$ docker compose exec ${cmd.service} sh -lc '${innerCommand}'`,
        "system"
      );
    }
  } else {
    binary = "bash";
    args = ["-lc", cmd.command];
    const resolvedDir = path.resolve(projectPath, relDir);
    if (fs.existsSync(resolvedDir)) {
      spawnCwd = resolvedDir;
    }
    state.addLog(projectName, label, `[cwd: ${spawnCwd}] $ ${cmd.command}`, "system");
  }

  const child = spawn(binary, args, {
    cwd: spawnCwd,
    env: {
      ...process.env,
      PATH: enhancedPath,
      FORCE_COLOR: "1",
    },
  });

  const info: ActiveProcessInfo = {
    id: procId,
    project: projectName,
    label,
    command: cmd.command,
    workingDir: relDir,
    startedAt: new Date().toLocaleTimeString(),
    running: true,
    exitCode: null,
  };

  state.processes.set(procId, {
    info,
    kill: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    },
  });

  child.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n")) {
      state.addLog(projectName, label, line, "stdout");
    }
  });

  child.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n")) {
      state.addLog(projectName, label, line, "stderr");
    }
  });

  child.on("close", (code) => {
    info.running = false;
    info.exitCode = code;
    state.addLog(projectName, label, `Process exited with code ${code}`, code === 0 ? "system" : "stderr");
  });

  return info;
}

export async function switchProject(projectName: string, overrideOptions?: Partial<ProjectConfig>) {
  const projects = await scanProjects();
  const project = projects.find((p) => p.name === projectName);
  if (!project) {
    throw new Error(`Project '${projectName}' not found`);
  }

  const cfg: ProjectConfig = {
    ...project.config,
    ...(overrideOptions || {}),
    lastOpenedAt: Date.now(),
  };

  saveProjectConfig(projectName, cfg);

  state.addLog(projectName, "switch", `=== Activating project: ${projectName} ===`, "system");

  if (cfg.stopOthersOnSwitch) {
    await stopOtherDockerProjects(project.path, project.name);
  }

  if (cfg.startDockerOnSwitch && project.hasDockerCompose) {
    await startProjectDocker(project.name, project.path);
  }

  if (cfg.openPhpStormOnSwitch && !project.isPhpStormOpen) {
    openInPhpStorm(project.name, project.path);
  }

  if (cfg.openChromeOnSwitch && cfg.urls && cfg.urls.length > 0) {
    openInChrome(project.name, cfg.chromeProfile || "Default", cfg.urls);
  }

  if (cfg.commands && cfg.commands.length > 0) {
    for (const cmd of cfg.commands) {
      if (cmd.autoRunOnSwitch) {
        spawnProjectCommand(project.name, project.path, cmd);
      }
    }
  }

  state.addLog(projectName, "switch", `=== Ready: ${projectName} is active ===`, "system");
  return scanProjects();
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: string) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const sendJson = (status: number, data: any) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };

  const readBody = (): Promise<any> =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });

  try {
    if (req.method === "GET" && url === "/api/bootstrap") {
      const settings = loadSettings();
      const [projects, chromeProfiles] = await Promise.all([
        scanProjects(),
        Promise.resolve(getChromeProfiles()),
      ]);
      return sendJson(200, {
        settings,
        projects,
        chromeProfiles,
        logs: state.logs.slice(-400),
        processes: Array.from(state.processes.values()).map((p) => p.info),
      });
    }

    if (req.method === "POST" && url === "/api/settings") {
      const body = await readBody();
      const settings = saveSettings({ projectsRoot: body.projectsRoot });
      const projects = await scanProjects();
      return sendJson(200, { settings, projects });
    }

    if (req.method === "GET" && url === "/api/logs") {
      return sendJson(200, {
        logs: state.logs.slice(-400),
        processes: Array.from(state.processes.values()).map((p) => p.info),
      });
    }

    if (req.method === "POST" && url === "/api/logs/clear") {
      state.logs = [];
      return sendJson(200, { ok: true });
    }

    if (req.method === "POST" && url === "/api/project/config") {
      const body = await readBody();
      saveProjectConfig(body.projectName, body.config);
      const projects = await scanProjects();
      return sendJson(200, { projects });
    }

    if (req.method === "POST" && url === "/api/project/switch") {
      const body = await readBody();
      const projects = await switchProject(body.projectName, body.overrideOptions);
      return sendJson(200, { projects });
    }

    if (req.method === "POST" && url === "/api/docker/start") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName);
      if (body.stopOthers) {
        await stopOtherDockerProjects(projectPath, body.projectName);
      }
      await startProjectDocker(body.projectName, projectPath);
      const projects = await scanProjects();
      return sendJson(200, { projects });
    }

    if (req.method === "POST" && url === "/api/docker/stop") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName);
      await stopProjectDocker(body.projectName, projectPath);
      const projects = await scanProjects();
      return sendJson(200, { projects });
    }

    if (req.method === "POST" && url === "/api/docker/stop-all") {
      await stopOtherDockerProjects();
      const projects = await scanProjects();
      return sendJson(200, { projects });
    }

    if (req.method === "POST" && url === "/api/open/phpstorm") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName);
      openInPhpStorm(body.projectName, projectPath);
      return sendJson(200, { ok: true });
    }

    if (req.method === "POST" && url === "/api/open/chrome") {
      const body = await readBody();
      openInChrome(body.projectName, body.chromeProfile, body.urls || []);
      return sendJson(200, { ok: true });
    }

    if (req.method === "POST" && url === "/api/open/terminal") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName);
      openInTerminal(body.projectName, projectPath, body.service, body.workingDir);
      return sendJson(200, { ok: true });
    }

    if (req.method === "POST" && url === "/api/open/ssh") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName || "");
      openSshSession(body.projectName || "ssh", projectPath, body.ssh || {});
      return sendJson(200, { ok: true });
    }

    if (req.method === "POST" && url === "/api/ssh/test") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName || "");
      const result = await testSshConnection(body.projectName || "ssh", projectPath, body.ssh || {});
      return sendJson(200, result);
    }

    if (req.method === "POST" && url === "/api/command/run") {
      const body = await readBody();
      const projectPath = path.join(getProjectsRoot(), body.projectName);
      const proc = spawnProjectCommand(body.projectName, projectPath, body.command);
      return sendJson(200, { process: proc });
    }

    if (req.method === "POST" && url === "/api/command/kill") {
      const body = await readBody();
      const entry = state.processes.get(body.processId);
      if (entry) {
        entry.kill();
      }
      return sendJson(200, { ok: true });
    }

    sendJson(404, { error: "Not found" });
  } catch (e: any) {
    console.error("API error:", e);
    sendJson(500, { error: e?.message || "Internal server error" });
  }
}
