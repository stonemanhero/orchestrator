import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  Search,
  Play,
  Square,
  Terminal,
  Globe,
  Code2,
  Star,
  Trash2,
  RefreshCw,
  ExternalLink,
  ArrowLeft,
  Settings2,
  FolderOpen,
  ChevronDown,
  Check,
  Edit3,
  GitBranch,
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Info,
  StickyNote,
  X,
} from "lucide-react";

export interface CustomCommand {
  id: string;
  label: string;
  target: "container" | "host";
  service?: string;
  workingDir?: string; // relative path from project root, e.g. "." or "wp-content/themes/certa"
  command: string;
  autoRunOnSwitch?: boolean;
}

export interface SshSessionConfig {
  id: string;
  label?: string;
  command: string;
  password?: string;
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
  relDir: string;
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

const API_BASE =
  typeof window !== "undefined" && window.location.port !== "1420"
    ? "http://127.0.0.1:1420"
    : "";

// Reusable soft-green and soft-red button classes
const BTN_GREEN =
  "bg-[#238636]/20 hover:bg-[#238636]/35 text-[#3fb950] border border-[#238636]";
const BTN_RED =
  "bg-[#da3633]/20 hover:bg-[#da3633]/35 text-[#f85149] border border-[#da3633]";
const INPUT_BASE =
  "h-8 bg-[#090d11] text-[#e6edf3] border border-[#30363d] rounded-md px-2.5 text-xs focus:outline-none focus:border-[#238636]";

/**
 * Custom dark-themed Dropdown Select that matches exact 32px (h-8) input height
 */
function CustomSelect({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="h-8 w-full bg-[#090d11] hover:bg-[#0d1117] text-[#e6edf3] border border-[#30363d] focus:border-[#238636] rounded-md px-2.5 text-xs flex items-center justify-between gap-2 transition cursor-pointer"
      >
        <span className="truncate">{selected?.label || value}</span>
        <ChevronDown className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-[#161b22] border border-[#30363d] rounded-md shadow-xl z-50 max-h-56 overflow-y-auto py-1">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                  isSelected
                    ? "bg-[#238636]/25 text-[#3fb950] font-medium"
                    : "text-[#e6edf3] hover:bg-[#21262d]"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [projectsRoot, setProjectsRoot] = useState("~/Projects");
  const [editingRoot, setEditingRoot] = useState(false);
  const [rootInput, setRootInput] = useState("~/Projects");
  const [rootError, setRootError] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [chromeProfiles, setChromeProfiles] = useState<ChromeProfile[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [processes, setProcesses] = useState<ActiveProcessInfo[]>([]);

  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "running" | "docker" | "favorites">("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);

  // Confirmation modal state for "Stop" and "Stop All"
  const [confirmAction, setConfirmAction] = useState<
    | { type: "stop-one"; project: ProjectInfo }
    | { type: "stop-all"; projectNames: string[] }
    | null
  >(null);

  // Project Notes modal state
  const [notesModalProject, setNotesModalProject] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");

  // Inputs for adding URL or Command
  const [newUrlInput, setNewUrlInput] = useState("");
  const [newCmdLabel, setNewCmdLabel] = useState("");
  const [newCmdTarget, setNewCmdTarget] = useState<"container" | "host">("host");
  const [newCmdService, setNewCmdService] = useState("");
  const [newCmdWorkingDir, setNewCmdWorkingDir] = useState(".");
  const [newCmdCommand, setNewCmdCommand] = useState("npm run dev");
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);

  // Per-service one-off CLI command inputs (for wpcli or stopped/CLI containers)
  const [serviceCommands, setServiceCommands] = useState<Record<string, string>>({});

  // SSH session form inputs & password visibility toggles
  const [newSshLabel, setNewSshLabel] = useState("");
  const [newSshCommand, setNewSshCommand] = useState("");
  const [newSshPassword, setNewSshPassword] = useState("");
  const [showNewSshPass, setShowNewSshPass] = useState(false);
  const [visibleSshPasswords, setVisibleSshPasswords] = useState<Record<string, boolean>>({});
  const [sshTestStatus, setSshTestStatus] = useState<
    Record<string, { testing: boolean; ok?: boolean; message?: string }>
  >({});
  const [sshDropdownOpen, setSshDropdownOpen] = useState(false);
  const sshDropdownRef = useRef<HTMLDivElement>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchBootstrap = async (force = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/bootstrap${force ? "?force=1" : ""}`);
      const data = await res.json();
      if (data.settings?.projectsRoot) {
        setProjectsRoot(data.settings.projectsRoot);
        if (!editingRoot) setRootInput(data.settings.projectsRoot);
      }
      setProjects(data.projects || []);
      setChromeProfiles(data.chromeProfiles || []);
      setLogs(data.logs || []);
      setProcesses(data.processes || []);
    } catch (e) {
      console.error("Bootstrap error:", e);
    }
  };

  const fetchLogsOnly = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs`);
      const data = await res.json();
      setLogs(data.logs || []);
      setProcesses(data.processes || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchBootstrap();
    searchInputRef.current?.focus();

    // Refresh immediately whenever the user switches back to the Orchestrator window
    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        fetchBootstrap(false);
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    // Lightweight background sync only while window is visible (15s instead of 4s)
    const projPoll = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchBootstrap(false);
      }
    }, 15000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      clearInterval(projPoll);
    };
  }, []);

  const hasRunningProcesses = useMemo(
    () => processes.some((p) => p.running),
    [processes]
  );

  // Only poll /api/logs (every 1.5s) while a task/Docker command is actively running or the log drawer is open
  useEffect(() => {
    if (!showLogsDrawer && !hasRunningProcesses && !busyProject && !stoppingAll) {
      return;
    }
    fetchLogsOnly();
    const logPoll = setInterval(fetchLogsOnly, 1500);
    return () => clearInterval(logPoll);
  }, [showLogsDrawer, hasRunningProcesses, busyProject, stoppingAll]);

  useEffect(() => {
    setSshDropdownOpen(false);
  }, [selectedName]);

  useEffect(() => {
    if (!sshDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sshDropdownRef.current && !sshDropdownRef.current.contains(e.target as Node)) {
        setSshDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [sshDropdownOpen]);

  const handleSaveProjectsRoot = async () => {
    setRootError(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectsRoot: rootInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRootError(data.error || "Invalid folder path");
        return;
      }
      setProjectsRoot(data.settings.projectsRoot);
      setRootInput(data.settings.projectsRoot);
      setProjects(data.projects || []);
      setEditingRoot(false);
    } catch (e: any) {
      setRootError(e.message || "Failed to update folder");
    }
  };

  const runningProjects = useMemo(
    () => projects.filter((p) => p.isRunning),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterMode === "docker" && !p.hasDockerCompose) return false;
      if (filterMode === "running" && !p.isRunning) return false;
      if (filterMode === "favorites" && !p.config.favorite) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.gitRemote && p.gitRemote.toLowerCase().includes(q)) ||
        p.detectedUrls.some((u) => u.toLowerCase().includes(q)) ||
        (p.config.urls || []).some((u) => u.toLowerCase().includes(q)) ||
        p.composeServices.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [projects, search, filterMode]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.name === selectedName) || null,
    [projects, selectedName]
  );

  useEffect(() => {
    if (!selectedProject) return;
    if (selectedProject.composeServices.length > 0) {
      const defaultSvc =
        selectedProject.composeServices.find((s) =>
          ["laravel.test", "app", "wordpress", "web", "node"].includes(s)
        ) || selectedProject.composeServices[0];
      setNewCmdService(defaultSvc);
    }
    if (
      selectedProject.packageJsonLocations &&
      selectedProject.packageJsonLocations.length > 0
    ) {
      setNewCmdWorkingDir(selectedProject.packageJsonLocations[0].relDir);
    } else {
      setNewCmdWorkingDir(".");
    }
    setNewCmdTarget("host");
  }, [selectedProject?.name]);

  // Escape key closes modal, folder editor, or returns to main project list
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmAction) {
          setConfirmAction(null);
        } else if (editingRoot) {
          setEditingRoot(false);
          setRootError(null);
        } else if (selectedName) {
          setSelectedName(null);
        } else if (search) {
          setSearch("");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedName, search, editingRoot, confirmAction]);

  const updateProjectConfig = async (projectName: string, patch: Partial<ProjectConfig>) => {
    const proj = projects.find((p) => p.name === projectName);
    if (!proj) return;
    const updatedConfig = { ...proj.config, ...patch };
    const res = await fetch(`${API_BASE}/api/project/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName, config: updatedConfig }),
    });
    const data = await res.json();
    if (data.projects) setProjects(data.projects);
  };

  const handleSwitchProject = async (projectName: string) => {
    setBusyProject(projectName);
    try {
      const res = await fetch(`${API_BASE}/api/project/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName }),
      });
      const data = await res.json();
      if (data.projects) setProjects(data.projects);
    } finally {
      setBusyProject(null);
    }
  };

  const executeToggleDocker = async (proj: ProjectInfo) => {
    setBusyProject(proj.name);
    try {
      const endpoint = proj.isRunning
        ? `${API_BASE}/api/docker/stop`
        : `${API_BASE}/api/docker/start`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: proj.name,
          stopOthers: !proj.isRunning && proj.config.stopOthersOnSwitch,
        }),
      });
      const data = await res.json();
      if (data.projects) setProjects(data.projects);
    } finally {
      setBusyProject(null);
    }
  };

  const handleRequestStopDocker = (proj: ProjectInfo) => {
    if (proj.isRunning) {
      setConfirmAction({ type: "stop-one", project: proj });
    } else {
      executeToggleDocker(proj);
    }
  };

  const executeStopAllDocker = async () => {
    setStoppingAll(true);
    try {
      const res = await fetch(`${API_BASE}/api/docker/stop-all`, { method: "POST" });
      const data = await res.json();
      if (data.projects) setProjects(data.projects);
    } finally {
      setStoppingAll(false);
    }
  };

  const handleRequestStopAllDocker = () => {
    if (runningProjects.length === 0) return;
    setConfirmAction({
      type: "stop-all",
      projectNames: runningProjects.map((p) => p.name),
    });
  };

  const handleOpenPhpStorm = async (projectName: string) => {
    await fetch(`${API_BASE}/api/open/phpstorm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName }),
    });
    setTimeout(fetchBootstrap, 1500);
  };

  const handleOpenChrome = async (proj: ProjectInfo, specificUrl?: string) => {
    const urls = specificUrl
      ? [specificUrl]
      : proj.config.urls && proj.config.urls.length > 0
      ? proj.config.urls
      : proj.detectedUrls;
    await fetch(`${API_BASE}/api/open/chrome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectName: proj.name,
        chromeProfile: proj.config.chromeProfile || "Default",
        urls,
      }),
    });
  };

  const handleOpenTerminal = async (
    projectName: string,
    service?: string,
    workingDir?: string
  ) => {
    await fetch(`${API_BASE}/api/open/terminal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName, service, workingDir }),
    });
  };

  const handleOpenSsh = async (
    projectName: string,
    ssh: { command: string; password?: string; label?: string }
  ) => {
    if (!ssh.command || !ssh.command.trim()) return;
    await fetch(`${API_BASE}/api/open/ssh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName, ssh }),
    });
  };

  const handleTestSsh = async (
    key: string,
    projectName: string,
    ssh: { command: string; password?: string; label?: string }
  ) => {
    if (!ssh.command || !ssh.command.trim()) {
      setSshTestStatus((prev) => ({
        ...prev,
        [key]: { testing: false, ok: false, message: "Please enter an SSH command first." },
      }));
      return;
    }
    setSshTestStatus((prev) => ({
      ...prev,
      [key]: { testing: true },
    }));
    try {
      const res = await fetch(`${API_BASE}/api/ssh/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ssh }),
      });
      const data = await res.json();
      setSshTestStatus((prev) => ({
        ...prev,
        [key]: {
          testing: false,
          ok: Boolean(data.ok),
          message: data.message || (data.ok ? "SSH connection verified." : "SSH connection failed."),
        },
      }));
    } catch (e: any) {
      setSshTestStatus((prev) => ({
        ...prev,
        [key]: {
          testing: false,
          ok: false,
          message: e?.message || "Failed to test SSH connection.",
        },
      }));
    }
  };

  const handleRunCommand = async (projectName: string, command: CustomCommand) => {
    await fetch(`${API_BASE}/api/command/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName, command }),
    });
    setShowLogsDrawer(true);
  };

  const handleKillProcess = async (processId: string) => {
    await fetch(`${API_BASE}/api/command/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processId }),
    });
  };

  const getSwitchSummary = (proj: ProjectInfo): string => {
    const steps: string[] = [];
    const otherRunning = runningProjects
      .filter((r) => r.name !== proj.name)
      .map((r) => r.name);

    if (proj.config.stopOthersOnSwitch && otherRunning.length > 0) {
      steps.push(`Stop ${otherRunning.join(", ")}`);
    }
    if (proj.hasDockerCompose && proj.config.startDockerOnSwitch && !proj.isRunning) {
      steps.push("Start Docker");
    }
    if (proj.config.openPhpStormOnSwitch && !proj.isPhpStormOpen) {
      steps.push("Open PhpStorm");
    }
    if (proj.config.openChromeOnSwitch && (proj.config.urls || []).length > 0) {
      const prof = chromeProfiles.find(
        (c) => c.directory === (proj.config.chromeProfile || "Default")
      );
      steps.push(`Open Chrome (${prof?.name || "Default"})`);
    }
    const autoCmds = (proj.config.commands || []).filter((c) => c.autoRunOnSwitch);
    if (autoCmds.length > 0) {
      steps.push(`Run ${autoCmds.length} task(s)`);
    }
    return steps.length > 0 ? steps.join(" → ") : "Open configured tools";
  };

  const handleOpenNotesModal = (proj: ProjectInfo) => {
    setNotesModalProject(proj.name);
    setNotesDraft(proj.config.notes || "");
  };

  const handleSaveNotes = async () => {
    if (!notesModalProject) return;
    await updateProjectConfig(notesModalProject, { notes: notesDraft });
    setNotesModalProject(null);
  };

  const activeProcessCount = processes.filter((p) => p.running).length;
  const isAnyBusy = Boolean(busyProject) || stoppingAll;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-[#e6edf3] select-none overflow-hidden relative">
      {/* PROJECT NOTES MODAL */}
      {notesModalProject && (
        <div
          onClick={() => setNotesModalProject(null)}
          className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#30363d] pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-md bg-[#238636]/20 border border-[#238636] text-[#3fb950] shrink-0">
                  <StickyNote className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    Notes — {notesModalProject}
                  </h3>
                  <p className="text-[11px] text-[#8b949e]">
                    Saved locally in ~/.config/orchestrator/projects.json
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNotesModalProject(null)}
                className="text-[#8b949e] hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  handleSaveNotes();
                } else if (e.key === "Escape") {
                  setNotesModalProject(null);
                }
              }}
              placeholder="Write project notes, credentials, test accounts, URLs, or reminders..."
              rows={9}
              autoFocus
              className="w-full p-3 rounded-md bg-[#090d11] border border-[#30363d] text-xs font-mono text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#238636] resize-y select-text"
            />

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#30363d]">
              <span className="text-[11px] text-[#484f58]">
                Tip: Press Ctrl+Enter to save
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNotesModalProject(null)}
                  className="h-8 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-[#e6edf3] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  className={`h-8 px-3.5 rounded-md text-xs font-semibold transition cursor-pointer ${BTN_GREEN}`}
                >
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "ARE YOU SURE?" CONFIRMATION MODAL FOR STOP & STOP ALL */}
      {confirmAction && (
        <div
          onClick={() => setConfirmAction(null)}
          className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-[#da3633]/20 border border-[#da3633] text-[#f85149] shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Are you sure?</h3>
                {confirmAction.type === "stop-one" ? (
                  <p className="text-xs text-[#8b949e] leading-relaxed">
                    Stop all running Docker containers for{" "}
                    <span className="font-semibold text-white">
                      {confirmAction.project.name}
                    </span>
                    ?
                  </p>
                ) : (
                  <p className="text-xs text-[#8b949e] leading-relaxed">
                    Stop all running Docker containers across{" "}
                    <span className="font-semibold text-white">
                      {confirmAction.projectNames.join(", ")}
                    </span>
                    ?
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363d]">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="h-8 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-[#e6edf3] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  if (action.type === "stop-one") {
                    await executeToggleDocker(action.project);
                  } else {
                    await executeStopAllDocker();
                  }
                }}
                className={`h-8 px-3.5 rounded-md text-xs font-semibold transition cursor-pointer ${BTN_RED}`}
              >
                {confirmAction.type === "stop-one"
                  ? `Yes, Stop ${confirmAction.project.name}`
                  : "Yes, Stop All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP BAR: Active Environment Banner + Search + Filters */}
      <header className="bg-[#161b22] border-b border-[#30363d] px-4 sm:px-5 py-3 flex flex-col gap-3 shrink-0">
        {/* Top Row: App Title & Changeable Projects Directory + Active Docker Status */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {selectedProject ? (
              <button
                onClick={() => setSelectedName(null)}
                disabled={isAnyBusy}
                className="h-8 flex items-center gap-1.5 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-[#e6edf3] transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to All Projects</span>
              </button>
            ) : (
              <>
                <span className="text-sm font-bold tracking-tight text-white">
                  Orchestrator
                </span>

                {/* Changeable Projects Folder Path */}
                {!editingRoot ? (
                  <button
                    onClick={() => {
                      setRootInput(projectsRoot);
                      setEditingRoot(true);
                    }}
                    disabled={isAnyBusy}
                    title="Click to change your root Projects directory"
                    className="h-7 px-2.5 rounded-md bg-[#090d11] hover:bg-[#21262d] border border-[#30363d] text-xs text-[#8b949e] hover:text-[#e6edf3] flex items-center gap-1.5 font-mono transition cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#3fb950]" />
                    <span>{projectsRoot}</span>
                    <span className="text-[11px] text-[#484f58]">({projects.length})</span>
                    <Edit3 className="w-3 h-3 text-[#8b949e] ml-0.5" />
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="text"
                      value={rootInput}
                      onChange={(e) => setRootInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveProjectsRoot();
                      }}
                      placeholder="~/Projects"
                      className={`w-64 font-mono ${INPUT_BASE}`}
                      autoFocus
                    />
                    <button
                      onClick={handleSaveProjectsRoot}
                      className={`h-8 px-2.5 rounded-md text-xs font-medium cursor-pointer ${BTN_GREEN}`}
                    >
                      Save Folder
                    </button>
                    <button
                      onClick={() => {
                        setEditingRoot(false);
                        setRootError(null);
                      }}
                      className="h-8 px-2.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#8b949e] cursor-pointer"
                    >
                      Cancel
                    </button>
                    {rootError && (
                      <span className="text-xs text-[#f85149]">{rootError}</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right side: Currently Running Docker Status + Task Logs Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {runningProjects.length > 0 ? (
              <div className="h-8 flex items-center gap-2 px-3 rounded-md bg-[#238636]/15 border border-[#238636] text-xs">
                <span className="w-2 h-2 rounded-full bg-[#3fb950]" />
                <span className="text-[#8b949e] hidden sm:inline">Active Docker:</span>
                <span className="font-semibold text-[#3fb950]">
                  {runningProjects.map((p) => p.name).join(", ")}
                </span>
                <button
                  onClick={handleRequestStopAllDocker}
                  disabled={isAnyBusy}
                  className={`ml-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${BTN_RED}`}
                >
                  {stoppingAll ? "Stopping..." : "Stop All"}
                </button>
              </div>
            ) : (
              <div className="h-8 flex items-center px-3 rounded-md bg-[#1c2128] border border-[#30363d] text-xs text-[#8b949e]">
                No Docker running
              </div>
            )}

            <button
              onClick={() => setShowLogsDrawer(!showLogsDrawer)}
              title="Show live terminal output from Docker Compose, WP-CLI, and npm run dev/build tasks"
              className={`h-8 flex items-center gap-1.5 px-3 rounded-md text-xs font-medium transition cursor-pointer ${
                showLogsDrawer
                  ? BTN_GREEN
                  : "bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3]"
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>
                {activeProcessCount > 0
                  ? `Task Output (${activeProcessCount} running)`
                  : "Task Output"}
              </span>
            </button>

            <button
              onClick={() => fetchBootstrap(true)}
              disabled={isAnyBusy}
              title="Refresh projects, PhpStorm windows & Docker status"
              className="h-8 w-8 flex items-center justify-center rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Second Row (Only on Main List View): Search Bar + Filter Buttons */}
        {!selectedProject && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-[#8b949e] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full h-9 pl-9 pr-16 bg-[#090d11] border border-[#30363d] rounded-md text-sm text-[#e6edf3] placeholder-[#8b949e] focus:outline-none focus:border-[#238636]"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8b949e] hover:text-white cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center bg-[#090d11] p-1 rounded-md border border-[#30363d] text-xs overflow-x-auto gap-1">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "running", label: `Running (${runningProjects.length})` },
                  { id: "docker", label: "Docker" },
                  { id: "favorites", label: "Favorites" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterMode(f.id)}
                  className={`px-3 py-1 rounded whitespace-nowrap transition cursor-pointer ${
                    filterMode === f.id
                      ? `${BTN_GREEN} font-medium`
                      : "text-[#8b949e] hover:text-[#e6edf3] border border-transparent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* MAIN BODY */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedProject ? (
          /* VIEW 1: CLEAN, RESPONSIVE PROJECT LIST */
          <div className="flex-1 overflow-y-auto">
            {/* Table Column Headers (Hidden on narrow screens) */}
            <div className="hidden md:grid md:grid-cols-12 gap-4 px-5 py-2 bg-[#161b22]/60 border-b border-[#30363d] text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] sticky top-0 z-10 backdrop-blur">
              <div className="col-span-3">Project</div>
              <div className="col-span-3">Details</div>
              <div className="col-span-6 text-right">Actions</div>
            </div>

            {filteredProjects.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#8b949e]">
                No projects match "{search}"
              </div>
            ) : (
              <div className="divide-y divide-[#21262d]">
                {filteredProjects.map((proj) => {
                  const isBusy = busyProject === proj.name;
                  const activeProfile = chromeProfiles.find(
                    (c) => c.directory === (proj.config.chromeProfile || "Default")
                  );
                  const primaryUrl =
                    (proj.config.urls && proj.config.urls[0]) ||
                    proj.detectedUrls[0] ||
                    null;
                  const hasNotes = Boolean(proj.config.notes && proj.config.notes.trim().length > 0);
                  const switchSummary = getSwitchSummary(proj);

                  return (
                    <div
                      key={proj.name}
                      className={`flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-4 md:items-center px-4 sm:px-5 py-3 transition ${
                        proj.isRunning
                          ? "bg-[#238636]/10 hover:bg-[#238636]/15"
                          : "hover:bg-[#161b22]"
                      }`}
                    >
                      {/* Col 1: Favorite + Status Dot + Project Name + Hover Info Tooltip */}
                      <div className="md:col-span-3 flex items-center gap-3 min-w-0">
                        <button
                          onClick={() =>
                            updateProjectConfig(proj.name, {
                              favorite: !proj.config.favorite,
                            })
                          }
                          disabled={isAnyBusy}
                          title="Pin to top"
                          className={`shrink-0 cursor-pointer ${
                            proj.config.favorite
                              ? "text-[#3fb950]"
                              : "text-[#30363d] hover:text-[#8b949e]"
                          }`}
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>

                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            proj.isRunning
                              ? "bg-[#3fb950]"
                              : proj.hasDockerCompose
                              ? "bg-[#484f58]"
                              : "bg-[#21262d]"
                          }`}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setSelectedName(proj.name)}
                              disabled={isAnyBusy}
                              className="font-semibold text-sm text-[#e6edf3] hover:text-[#3fb950] truncate text-left cursor-pointer"
                            >
                              {proj.name}
                            </button>

                            {/* Info icon with hover popover displaying the Activation flow */}
                            <div className="relative group/info shrink-0 flex items-center">
                              <span
                                title={`On Activate: ${switchSummary}`}
                                className="text-[#8b949e] hover:text-[#e6edf3] p-0.5 rounded transition cursor-help"
                              >
                                <Info className="w-3.5 h-3.5" />
                              </span>
                              <div className="hidden group-hover/info:block absolute left-0 top-full mt-1.5 z-30 w-max max-w-xs sm:max-w-sm px-3 py-2 rounded-md bg-[#161b22] border border-[#30363d] shadow-xl text-[11px] text-[#e6edf3] pointer-events-none">
                                <div className="font-semibold text-[#3fb950] mb-0.5">
                                  On Activate
                                </div>
                                <div className="text-[#8b949e] whitespace-normal leading-relaxed">
                                  {switchSummary}
                                </div>
                                {proj.isRunning && (
                                  <div className="mt-1 pt-1 border-t border-[#30363d] text-[#3fb950]">
                                    Running:{" "}
                                    {proj.runningContainers
                                      .map((c) => c.composeService || c.name)
                                      .join(", ")}
                                  </div>
                                )}
                              </div>
                            </div>

                            {proj.isRunning && (
                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-[#238636]/20 text-[#3fb950] border border-[#238636] rounded shrink-0">
                                ACTIVE ({proj.runningContainers.length})
                              </span>
                            )}
                          </div>
                          {proj.isRunning && (
                            <div className="text-[11px] text-[#8b949e] truncate mt-0.5">
                              Running:{" "}
                              {proj.runningContainers
                                .map((c) => c.composeService || c.name)
                                .join(", ")}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Col 2: Chrome Profile, Primary URL (Green), and Git Remote */}
                      <div className="md:col-span-3 min-w-0 text-xs pl-7 md:pl-0">
                        {primaryUrl ? (
                          <div className="truncate text-[#3fb950] font-mono">
                            {primaryUrl}
                          </div>
                        ) : (
                          <div className="text-[#484f58]">No URL configured</div>
                        )}
                        <div className="text-[11px] text-[#8b949e] truncate mt-0.5">
                          Chrome: {activeProfile?.name || "Default"}
                        </div>
                        {proj.gitRemote && (
                          <div
                            title={proj.gitRemote}
                            className="flex items-center gap-1 text-[11px] text-[#8b949e] font-mono truncate mt-0.5"
                          >
                            <GitBranch className="w-3 h-3 text-[#3fb950] shrink-0" />
                            <span className="truncate">{proj.gitRemote}</span>
                          </div>
                        )}
                      </div>

                      {/* Col 3: Action Buttons */}
                      <div className="md:col-span-6 flex flex-wrap items-center md:justify-end gap-2 pl-7 md:pl-0">
                        {proj.isRunning ? (
                          <button
                            onClick={() => handleRequestStopDocker(proj)}
                            disabled={isAnyBusy}
                            title="Stop Docker containers for this project"
                            className={`w-28 h-8 whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5 px-3 rounded-md text-xs font-medium transition cursor-pointer ${BTN_RED}`}
                          >
                            {isBusy ? (
                              <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                            ) : (
                              <Square className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{isBusy ? "Stopping..." : "Stop"}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSwitchProject(proj.name)}
                            disabled={isAnyBusy}
                            title={switchSummary}
                            className={`w-28 h-8 whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5 px-3 rounded-md text-xs font-medium transition cursor-pointer ${BTN_GREEN}`}
                          >
                            {isBusy ? (
                              <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{isBusy ? "Starting..." : "Activate"}</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleOpenPhpStorm(proj.name)}
                          disabled={proj.isPhpStormOpen || isAnyBusy}
                          title={
                            proj.isPhpStormOpen
                              ? "Already open in PhpStorm"
                              : "Open in PhpStorm"
                          }
                          className={`h-8 whitespace-nowrap shrink-0 px-2.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition ${
                            proj.isPhpStormOpen
                              ? "bg-[#161b22] border-[#21262d] text-[#484f58] cursor-not-allowed"
                              : "bg-[#21262d] hover:bg-[#30363d] border-[#30363d] text-[#e6edf3] cursor-pointer"
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{proj.isPhpStormOpen ? "IDE Open" : "PhpStorm"}</span>
                        </button>

                        <button
                          onClick={() => handleOpenChrome(proj)}
                          disabled={isAnyBusy}
                          title={`Open Chrome (${activeProfile?.name || "Default"})`}
                          className="h-8 whitespace-nowrap shrink-0 px-2.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Globe className="w-3.5 h-3.5 shrink-0 text-[#8b949e]" />
                          <span>Chrome</span>
                        </button>

                        <button
                          onClick={() => handleOpenNotesModal(proj)}
                          disabled={isAnyBusy}
                          title={
                            hasNotes
                              ? `Notes: ${proj.config.notes}`
                              : "Add or view project notes"
                          }
                          className="h-8 whitespace-nowrap shrink-0 px-2.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <StickyNote
                            className={`w-3.5 h-3.5 shrink-0 ${
                              hasNotes ? "text-[#3fb950]" : "text-[#8b949e]"
                            }`}
                          />
                          <span>Notes</span>
                        </button>

                        <button
                          onClick={() => setSelectedName(proj.name)}
                          disabled={isAnyBusy}
                          title="Configure startup steps, Chrome profile, URLs, SSH sessions, and working directories for commands"
                          className="h-8 whitespace-nowrap shrink-0 px-2.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Settings2 className="w-3.5 h-3.5 shrink-0 text-[#8b949e]" />
                          <span>Manage</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* VIEW 2: FULL-WIDTH RESPONSIVE MANAGE PROJECT PAGE */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="w-full space-y-5">
              {/* Project Status & Action Header Card */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1 className="text-lg sm:text-xl font-bold text-white truncate">
                        {selectedProject.name}
                      </h1>
                      {selectedProject.isRunning ? (
                        <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-[#238636]/20 text-[#3fb950] border border-[#238636] shrink-0">
                          ACTIVE ({selectedProject.runningContainers.length} containers running)
                        </span>
                      ) : selectedProject.hasDockerCompose ? (
                        <span className="px-2.5 py-0.5 rounded text-xs bg-[#21262d] text-[#8b949e] border border-[#30363d] shrink-0">
                          Docker Stopped
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded text-xs bg-[#21262d] text-[#8b949e] border border-[#30363d] shrink-0">
                          No Docker Compose
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#8b949e] font-mono mt-1 break-all">
                      {selectedProject.path}
                    </p>
                    {selectedProject.gitRemote && (
                      <p className="text-xs text-[#8b949e] font-mono mt-1 flex items-center gap-1.5 break-all">
                        <GitBranch className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
                        <span>{selectedProject.gitRemote}</span>
                      </p>
                    )}
                    <p className="text-xs text-[#3fb950] mt-1.5">
                      <strong>On Activate:</strong> {getSwitchSummary(selectedProject)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {selectedProject.isRunning ? (
                      <>
                        <button
                          onClick={() => handleRequestStopDocker(selectedProject)}
                          disabled={isAnyBusy}
                          className={`h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3.5 rounded-md text-xs font-medium transition cursor-pointer ${BTN_RED}`}
                        >
                          <Square className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {busyProject === selectedProject.name
                              ? "Stopping..."
                              : "Stop"}
                          </span>
                        </button>
                        <button
                          onClick={() => handleSwitchProject(selectedProject.name)}
                          disabled={isAnyBusy}
                          title="Re-open PhpStorm (if not open), Chrome URLs, and run startup commands"
                          className={`h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3.5 rounded-md text-xs font-medium transition cursor-pointer ${BTN_GREEN}`}
                        >
                          <Play className="w-3.5 h-3.5 shrink-0" />
                          <span>Launch IDE & Browser</span>
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleSwitchProject(selectedProject.name)}
                        disabled={isAnyBusy}
                        className={`h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-4 rounded-md text-xs font-semibold transition cursor-pointer ${BTN_GREEN}`}
                      >
                        <Play className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {busyProject === selectedProject.name
                            ? "Activating..."
                            : "Activate"}
                        </span>
                      </button>
                    )}

                    <button
                      onClick={() => handleOpenPhpStorm(selectedProject.name)}
                      disabled={selectedProject.isPhpStormOpen || isAnyBusy}
                      title={
                        selectedProject.isPhpStormOpen
                          ? "Already open in PhpStorm"
                          : "Open in PhpStorm"
                      }
                      className={`h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3 rounded-md border text-xs font-medium transition ${
                        selectedProject.isPhpStormOpen
                          ? "bg-[#161b22] border-[#21262d] text-[#484f58] cursor-not-allowed"
                          : "bg-[#21262d] hover:bg-[#30363d] border-[#30363d] text-[#e6edf3] cursor-pointer"
                      }`}
                    >
                      <Code2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {selectedProject.isPhpStormOpen ? "IDE Open" : "PhpStorm"}
                      </span>
                    </button>

                    <button
                      onClick={() => handleOpenTerminal(selectedProject.name)}
                      disabled={isAnyBusy}
                      className="h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium transition cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5 shrink-0" />
                      <span>Host Terminal</span>
                    </button>

                    <button
                      onClick={() => handleOpenNotesModal(selectedProject)}
                      disabled={isAnyBusy}
                      title={
                        selectedProject.config.notes?.trim()
                          ? `Notes: ${selectedProject.config.notes}`
                          : "Add or view project notes"
                      }
                      className="h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium transition cursor-pointer"
                    >
                      <StickyNote
                        className={`w-3.5 h-3.5 shrink-0 ${
                          selectedProject.config.notes?.trim()
                            ? "text-[#3fb950]"
                            : "text-[#8b949e]"
                        }`}
                      />
                      <span>Notes</span>
                    </button>

                    {/* SSH Access: Single button if 1 session, Dropdown menu if 2+ sessions */}
                    {(selectedProject.config.sshSessions || []).length === 1 && (
                      <button
                        onClick={() =>
                          handleOpenSsh(
                            selectedProject.name,
                            selectedProject.config.sshSessions![0]
                          )
                        }
                        disabled={isAnyBusy}
                        title={`Launch SSH: ${selectedProject.config.sshSessions![0].command}`}
                        className="h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium transition cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5 shrink-0 text-[#3fb950]" />
                        <span>
                          {selectedProject.config.sshSessions![0].label
                            ? `SSH (${selectedProject.config.sshSessions![0].label})`
                            : "SSH Access"}
                        </span>
                      </button>
                    )}

                    {(selectedProject.config.sshSessions || []).length > 1 && (
                      <div ref={sshDropdownRef} className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setSshDropdownOpen((prev) => !prev)}
                          disabled={isAnyBusy}
                          title="Choose an SSH session to launch"
                          className="h-8 whitespace-nowrap flex items-center gap-1.5 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium transition cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5 shrink-0 text-[#3fb950]" />
                          <span>
                            SSH Access ({(selectedProject.config.sshSessions || []).length})
                          </span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-[#8b949e] transition-transform ${
                              sshDropdownOpen ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {sshDropdownOpen && (
                          <div className="absolute right-0 top-full mt-1.5 z-40 w-64 rounded-md bg-[#161b22] border border-[#30363d] shadow-2xl py-1 divide-y divide-[#21262d]">
                            {(selectedProject.config.sshSessions || []).map(
                              (ssh, idx) => (
                                <button
                                  key={ssh.id}
                                  type="button"
                                  onClick={() => {
                                    setSshDropdownOpen(false);
                                    handleOpenSsh(selectedProject.name, ssh);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-[#21262d] transition flex items-start gap-2.5 cursor-pointer"
                                >
                                  <KeyRound className="w-3.5 h-3.5 text-[#3fb950] shrink-0 mt-0.5" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold text-[#e6edf3] truncate">
                                      {ssh.label || `SSH Session #${idx + 1}`}
                                    </div>
                                    <div className="text-[11px] text-[#8b949e] font-mono truncate">
                                      {ssh.command}
                                    </div>
                                  </div>
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {(selectedProject.config.sshSessions || []).length === 0 &&
                      newSshCommand.trim().length > 0 && (
                        <button
                          onClick={() =>
                            handleOpenSsh(selectedProject.name, {
                              label: newSshLabel.trim() || undefined,
                              command: newSshCommand.trim(),
                              password: newSshPassword,
                            })
                          }
                          disabled={isAnyBusy}
                          title={`Launch SSH: ${newSshCommand.trim()}`}
                          className="h-8 whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium transition cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5 shrink-0 text-[#3fb950]" />
                          <span>SSH Access</span>
                        </button>
                      )}
                  </div>
                </div>
              </div>

              {/* Responsive Two-Column Layout for Startup Steps & Chrome Profile */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Card 1: What happens when you click "Activate" */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white border-b border-[#30363d] pb-2">
                    1. Startup Steps (When Activating Project)
                  </h2>

                  <div className="space-y-3 text-xs">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedProject.config.stopOthersOnSwitch)}
                        onChange={(e) =>
                          updateProjectConfig(selectedProject.name, {
                            stopOthersOnSwitch: e.target.checked,
                          })
                        }
                        className="mt-0.5 w-4 h-4 accent-[#238636]"
                      />
                      <div>
                        <div className="font-medium text-[#e6edf3]">
                          Stop other running Docker projects first
                        </div>
                        <div className="text-[#8b949e]">
                          Frees ports 80, 3306, 8080, 8081 before starting this project
                        </div>
                      </div>
                    </label>

                    {selectedProject.hasDockerCompose && (
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedProject.config.startDockerOnSwitch)}
                          onChange={(e) =>
                            updateProjectConfig(selectedProject.name, {
                              startDockerOnSwitch: e.target.checked,
                            })
                          }
                          className="mt-0.5 w-4 h-4 accent-[#238636]"
                        />
                        <div>
                          <div className="font-medium text-[#e6edf3]">
                            Start Docker Compose containers
                          </div>
                          <div className="text-[#8b949e]">
                            Runs <code>docker compose up -d</code>
                          </div>
                        </div>
                      </label>
                    )}

                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedProject.config.openPhpStormOnSwitch)}
                        onChange={(e) =>
                          updateProjectConfig(selectedProject.name, {
                            openPhpStormOnSwitch: e.target.checked,
                          })
                        }
                        className="mt-0.5 w-4 h-4 accent-[#238636]"
                      />
                      <div>
                        <div className="font-medium text-[#e6edf3]">
                          Open project in PhpStorm (skipped if already open)
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedProject.config.openChromeOnSwitch)}
                        onChange={(e) =>
                          updateProjectConfig(selectedProject.name, {
                            openChromeOnSwitch: e.target.checked,
                          })
                        }
                        className="mt-0.5 w-4 h-4 accent-[#238636]"
                      />
                      <div>
                        <div className="font-medium text-[#e6edf3]">
                          Open Google Chrome with selected profile & URLs
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Card 2: Chrome Profile & URLs */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-[#30363d] pb-2">
                    <h2 className="text-sm font-semibold text-white">
                      2. Chrome Profile & Project URLs
                    </h2>
                    <button
                      onClick={() => handleOpenChrome(selectedProject)}
                      disabled={isAnyBusy}
                      className="text-xs text-[#3fb950] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open All in Chrome</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs text-[#8b949e] mb-1">
                      Google Chrome Profile
                    </label>
                    <CustomSelect
                      value={selectedProject.config.chromeProfile || "Default"}
                      onChange={(val) =>
                        updateProjectConfig(selectedProject.name, {
                          chromeProfile: val,
                        })
                      }
                      options={chromeProfiles.map((prof) => ({
                        value: prof.directory,
                        label: `${prof.name} (${prof.userName || prof.directory})`,
                      }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs text-[#8b949e]">
                      URLs to open
                    </label>
                    {(selectedProject.config.urls || []).map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={u}
                          onChange={(e) => {
                            const next = [...(selectedProject.config.urls || [])];
                            next[i] = e.target.value;
                            updateProjectConfig(selectedProject.name, { urls: next });
                          }}
                          className={`flex-1 min-w-0 font-mono !text-[#3fb950] ${INPUT_BASE}`}
                        />
                        <button
                          onClick={() => handleOpenChrome(selectedProject, u)}
                          disabled={isAnyBusy}
                          title="Open this URL in Chrome"
                          className="h-8 px-2.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#e6edf3] shrink-0 cursor-pointer"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => {
                            const next = (selectedProject.config.urls || []).filter(
                              (_, idx) => idx !== i
                            );
                            updateProjectConfig(selectedProject.name, { urls: next });
                          }}
                          disabled={isAnyBusy}
                          className="p-1.5 text-[#8b949e] hover:text-[#da3633] shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={newUrlInput}
                        onChange={(e) => setNewUrlInput(e.target.value)}
                        placeholder="http://localhost:8088"
                        className={`flex-1 min-w-0 font-mono ${INPUT_BASE}`}
                      />
                      <button
                        onClick={() => {
                          if (!newUrlInput.trim()) return;
                          const next = [
                            ...(selectedProject.config.urls || []),
                            newUrlInput.trim(),
                          ];
                          updateProjectConfig(selectedProject.name, { urls: next });
                          setNewUrlInput("");
                        }}
                        disabled={isAnyBusy}
                        className={`h-8 px-3 rounded-md text-xs font-medium shrink-0 cursor-pointer ${BTN_GREEN}`}
                      >
                        + Add URL
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Docker Containers & WP-CLI / One-off Container Runner */}
              {selectedProject.hasDockerCompose && (
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-white border-b border-[#30363d] pb-2">
                    3. Docker Containers ({selectedProject.composeFile})
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedProject.composeServices.map((svc) => {
                      const runningContainer = selectedProject.runningContainers.find(
                        (c) =>
                          c.composeService === svc ||
                          c.name.endsWith(`_${svc}`) ||
                          c.name.includes(svc)
                      );
                      const isWpCli =
                        svc.toLowerCase().includes("wpcli") ||
                        svc.toLowerCase() === "wp";
                      const cmdInputVal =
                        serviceCommands[svc] ??
                        (isWpCli ? "plugin list" : "");

                      return (
                        <div
                          key={svc}
                          className="flex flex-col justify-between gap-2.5 p-3 rounded-md bg-[#090d11] border border-[#30363d]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    runningContainer
                                      ? "bg-[#3fb950]"
                                      : isWpCli
                                      ? "bg-[#e3b341]"
                                      : "bg-[#484f58]"
                                  }`}
                                />
                                <span className="text-xs font-semibold text-[#e6edf3]">
                                  {svc}
                                </span>
                                <span className="text-[11px] text-[#8b949e]">
                                  {runningContainer
                                    ? runningContainer.status
                                    : isWpCli
                                    ? "On-Demand CLI (docker compose run)"
                                    : "Stopped"}
                                </span>
                              </div>
                              {runningContainer?.ports && (
                                <div className="text-[11px] text-[#8b949e] font-mono mt-1 truncate">
                                  {runningContainer.ports}
                                </div>
                              )}
                            </div>

                            {runningContainer && (
                              <button
                                onClick={() =>
                                  handleOpenTerminal(selectedProject.name, svc)
                                }
                                disabled={isAnyBusy}
                                title={`Open interactive bash/sh terminal inside running ${svc} container`}
                                className="h-8 px-2.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#e6edf3] flex items-center gap-1.5 shrink-0 cursor-pointer"
                              >
                                <Terminal className="w-3.5 h-3.5" />
                                <span>Container Shell</span>
                              </button>
                            )}
                          </div>

                          {(!runningContainer || isWpCli) && (
                            <div className="flex items-center gap-2 pt-1 border-t border-[#21262d]">
                              {isWpCli && (
                                <span className="text-xs font-mono text-[#3fb950] shrink-0">
                                  wp
                                </span>
                              )}
                              <input
                                type="text"
                                value={cmdInputVal}
                                onChange={(e) =>
                                  setServiceCommands((prev) => ({
                                    ...prev,
                                    [svc]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && cmdInputVal.trim() && !isAnyBusy) {
                                    handleRunCommand(selectedProject.name, {
                                      id: `svc-${svc}-${Date.now()}`,
                                      label: isWpCli
                                        ? `wp ${cmdInputVal.trim()}`
                                        : `${svc}: ${cmdInputVal.trim()}`,
                                      target: "container",
                                      service: svc,
                                      workingDir: ".",
                                      command: cmdInputVal.trim(),
                                    });
                                  }
                                }}
                                placeholder={
                                  isWpCli
                                    ? "e.g. cache flush, plugin list, search-replace..."
                                    : `Run command in ${svc}...`
                                }
                                className={`flex-1 min-w-0 font-mono ${INPUT_BASE}`}
                              />
                              <button
                                onClick={() => {
                                  if (!cmdInputVal.trim()) return;
                                  handleRunCommand(selectedProject.name, {
                                    id: `svc-${svc}-${Date.now()}`,
                                    label: isWpCli
                                      ? `wp ${cmdInputVal.trim()}`
                                      : `${svc}: ${cmdInputVal.trim()}`,
                                    target: "container",
                                    service: svc,
                                    workingDir: ".",
                                    command: cmdInputVal.trim(),
                                  });
                                }}
                                disabled={isAnyBusy}
                                className={`h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer ${BTN_GREEN}`}
                              >
                                <Play className="w-3 h-3" />
                                <span>{isWpCli ? "Run WP-CLI" : "Run"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Card 4: NPM / Build / Custom Commands with Working Directory support */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-2">
                  <h2 className="text-sm font-semibold text-white">
                    4. Container & Host Tasks (e.g. npm run dev / build)
                  </h2>
                  {selectedProject.packageJsonLocations.length > 0 && (
                    <span className="text-xs text-[#3fb950]">
                      Detected package.json in:{" "}
                      {selectedProject.packageJsonLocations
                        .map((l) => (l.relDir === "." ? ". (root)" : l.relDir))
                        .join(", ")}
                    </span>
                  )}
                </div>

                {/* Existing Commands List */}
                <div className="space-y-2.5">
                  {(selectedProject.config.commands || []).length === 0 && (
                    <div className="text-xs text-[#8b949e]">
                      No commands configured yet. Add one below.
                    </div>
                  )}
                  {(selectedProject.config.commands || []).map((cmd, idx) => {
                    const dirDisplay =
                      !cmd.workingDir || cmd.workingDir === "."
                        ? ". (Project Root)"
                        : cmd.workingDir;
                    return (
                      <div
                        key={cmd.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-md bg-[#090d11] border border-[#30363d]"
                      >
                        <div className="min-w-0 space-y-1 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-[#e6edf3]">
                              {cmd.label}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
                              {cmd.target === "container"
                                ? `Container: ${cmd.service}`
                                : "Host"}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636] font-mono flex items-center gap-1">
                              <FolderOpen className="w-3 h-3" />
                              {dirDisplay}
                            </span>
                          </div>

                          {/* Editable Working Dir & Command inline */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-[#8b949e] shrink-0">
                                Folder:
                              </span>
                              <input
                                type="text"
                                value={cmd.workingDir || "."}
                                onChange={(e) => {
                                  const next = [
                                    ...(selectedProject.config.commands || []),
                                  ];
                                  next[idx] = {
                                    ...cmd,
                                    workingDir: e.target.value,
                                  };
                                  updateProjectConfig(selectedProject.name, {
                                    commands: next,
                                  });
                                }}
                                placeholder=". or wp-content/themes/my-theme"
                                className={`w-full font-mono ${INPUT_BASE}`}
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-[#8b949e] shrink-0">
                                Cmd:
                              </span>
                              <input
                                type="text"
                                value={cmd.command}
                                onChange={(e) => {
                                  const next = [
                                    ...(selectedProject.config.commands || []),
                                  ];
                                  next[idx] = {
                                    ...cmd,
                                    command: e.target.value,
                                  };
                                  updateProjectConfig(selectedProject.name, {
                                    commands: next,
                                  });
                                }}
                                className={`w-full font-mono ${INPUT_BASE}`}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          <label className="flex items-center gap-1.5 text-xs text-[#8b949e] cursor-pointer whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={Boolean(cmd.autoRunOnSwitch)}
                              onChange={(e) => {
                                const next = [
                                  ...(selectedProject.config.commands || []),
                                ];
                                next[idx] = {
                                  ...cmd,
                                  autoRunOnSwitch: e.target.checked,
                                };
                                updateProjectConfig(selectedProject.name, {
                                  commands: next,
                                });
                              }}
                              className="accent-[#238636]"
                            />
                            <span>Run on Activate</span>
                          </label>

                          <button
                            onClick={() =>
                              handleRunCommand(selectedProject.name, cmd)
                            }
                            disabled={isAnyBusy}
                            className={`h-8 px-3 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer ${BTN_GREEN}`}
                          >
                            <Play className="w-3 h-3" />
                            <span>Run Now</span>
                          </button>

                          <button
                            onClick={() => {
                              const next = (
                                selectedProject.config.commands || []
                              ).filter((_, i) => i !== idx);
                              updateProjectConfig(selectedProject.name, {
                                commands: next,
                              });
                            }}
                            disabled={isAnyBusy}
                            className="p-1.5 text-[#8b949e] hover:text-[#da3633] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add New Task Form with Working Directory Picker & Uniform Height CustomSelect */}
                <div className="pt-3 border-t border-[#30363d] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#e6edf3]">
                      Add New Task
                    </span>

                    {selectedProject.packageJsonLocations.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-[#8b949e]">Quick select folder:</span>
                        {selectedProject.packageJsonLocations.map((loc) => (
                          <button
                            key={loc.relDir}
                            type="button"
                            onClick={() => setNewCmdWorkingDir(loc.relDir)}
                            disabled={isAnyBusy}
                            className={`px-2 py-0.5 rounded font-mono transition cursor-pointer ${
                              newCmdWorkingDir === loc.relDir
                                ? BTN_GREEN
                                : "bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]"
                            }`}
                          >
                            {loc.relDir === "." ? ". (root)" : loc.relDir}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
                    <div className="lg:col-span-3">
                      <label className="block text-[11px] text-[#8b949e] mb-1">
                        Task Label
                      </label>
                      <input
                        type="text"
                        value={newCmdLabel}
                        onChange={(e) => setNewCmdLabel(e.target.value)}
                        placeholder="e.g. Theme Vite Dev"
                        className={`w-full ${INPUT_BASE}`}
                      />
                    </div>

                    <div className="lg:col-span-3">
                      <label className="block text-[11px] text-[#8b949e] mb-1">
                        Environment
                      </label>
                      <div className="flex gap-1.5">
                        <CustomSelect
                          className="flex-1 min-w-0"
                          value={newCmdTarget}
                          onChange={(val) =>
                            setNewCmdTarget(val as "container" | "host")
                          }
                          options={[
                            { value: "host", label: "Host Machine" },
                            ...(selectedProject.hasDockerCompose
                              ? [{ value: "container", label: "Docker Container" }]
                              : []),
                          ]}
                        />

                        {newCmdTarget === "container" && (
                          <CustomSelect
                            className="flex-1 min-w-0"
                            value={newCmdService}
                            onChange={(val) => setNewCmdService(val)}
                            options={selectedProject.composeServices.map((s) => ({
                              value: s,
                              label: s,
                            }))}
                          />
                        )}
                      </div>
                    </div>

                    <div className="lg:col-span-3">
                      <label className="block text-[11px] text-[#8b949e] mb-1">
                        Working Directory (relative to project)
                      </label>
                      <input
                        type="text"
                        value={newCmdWorkingDir}
                        onChange={(e) => setNewCmdWorkingDir(e.target.value)}
                        placeholder=". or wp-content/themes/my-theme"
                        className={`w-full font-mono !text-[#3fb950] ${INPUT_BASE}`}
                      />
                    </div>

                    <div className="lg:col-span-3">
                      <label className="block text-[11px] text-[#8b949e] mb-1">
                        Command
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newCmdCommand}
                          onChange={(e) => setNewCmdCommand(e.target.value)}
                          placeholder="npm run dev"
                          className={`flex-1 min-w-0 font-mono ${INPUT_BASE}`}
                        />
                        <button
                          onClick={() => {
                            if (!newCmdCommand.trim()) return;
                            const cleanDir = newCmdWorkingDir.trim() || ".";
                            const dirTag = cleanDir === "." ? "root" : cleanDir;
                            const cmd: CustomCommand = {
                              id: `cmd-${Date.now()}`,
                              label:
                                newCmdLabel.trim() ||
                                `${newCmdCommand.trim()} (${dirTag})`,
                              target: newCmdTarget,
                              service:
                                newCmdTarget === "container"
                                  ? newCmdService
                                  : undefined,
                              workingDir: cleanDir,
                              command: newCmdCommand.trim(),
                              autoRunOnSwitch: false,
                            };
                            updateProjectConfig(selectedProject.name, {
                              commands: [
                                ...(selectedProject.config.commands || []),
                                cmd,
                              ],
                            });
                            setNewCmdLabel("");
                          }}
                          disabled={isAnyBusy}
                          className={`h-8 px-3 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${BTN_GREEN}`}
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 5: SSH Sessions (Command & Optional Password) */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#3fb950]" />
                    <h2 className="text-sm font-semibold text-white">
                      5. SSH Sessions
                    </h2>
                  </div>
                  <span className="text-xs text-[#8b949e]">
                    Opens an interactive terminal and auto-fills password if provided
                  </span>
                </div>

                {/* Saved SSH Sessions List */}
                <div className="space-y-2.5">
                  {(selectedProject.config.sshSessions || []).length === 0 && (
                    <div className="text-xs text-[#8b949e]">
                      No saved SSH sessions for this project yet. Add one below.
                    </div>
                  )}

                  {(selectedProject.config.sshSessions || []).map((ssh, idx) => {
                    const isPassVisible = Boolean(visibleSshPasswords[ssh.id]);
                    const testState = sshTestStatus[ssh.id];
                    return (
                      <div
                        key={ssh.id}
                        className="p-3 rounded-md bg-[#090d11] border border-[#30363d] space-y-2"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 flex-1 min-w-0">
                            <div className="sm:col-span-3">
                              <label className="block text-[10px] text-[#8b949e] mb-0.5">
                                Label (Optional)
                              </label>
                              <input
                                type="text"
                                value={ssh.label || ""}
                                onChange={(e) => {
                                  const next = [
                                    ...(selectedProject.config.sshSessions || []),
                                  ];
                                  next[idx] = { ...ssh, label: e.target.value };
                                  updateProjectConfig(selectedProject.name, {
                                    sshSessions: next,
                                  });
                                }}
                                placeholder="e.g. Production / Staging"
                                className={`w-full ${INPUT_BASE}`}
                              />
                            </div>

                            <div className="sm:col-span-5">
                              <label className="block text-[10px] text-[#8b949e] mb-0.5">
                                SSH Command
                              </label>
                              <input
                                type="text"
                                value={ssh.command}
                                onChange={(e) => {
                                  const next = [
                                    ...(selectedProject.config.sshSessions || []),
                                  ];
                                  next[idx] = { ...ssh, command: e.target.value };
                                  updateProjectConfig(selectedProject.name, {
                                    sshSessions: next,
                                  });
                                }}
                                placeholder="ssh user@server.com -p 22"
                                className={`w-full font-mono !text-[#3fb950] ${INPUT_BASE}`}
                              />
                            </div>

                            <div className="sm:col-span-4">
                              <label className="block text-[10px] text-[#8b949e] mb-0.5">
                                Password (Optional — can be empty)
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  type={isPassVisible ? "text" : "password"}
                                  value={ssh.password || ""}
                                  onChange={(e) => {
                                    const next = [
                                      ...(selectedProject.config.sshSessions || []),
                                    ];
                                    next[idx] = { ...ssh, password: e.target.value };
                                    updateProjectConfig(selectedProject.name, {
                                      sshSessions: next,
                                    });
                                  }}
                                  placeholder="Leave empty for SSH key / prompt"
                                  className={`w-full pr-8 font-mono ${INPUT_BASE}`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setVisibleSshPasswords((prev) => ({
                                      ...prev,
                                      [ssh.id]: !prev[ssh.id],
                                    }))
                                  }
                                  title={isPassVisible ? "Hide password" : "Show password"}
                                  className="absolute right-2 text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
                                >
                                  {isPassVisible ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 lg:pt-4">
                            <button
                              type="button"
                              disabled={testState?.testing || isAnyBusy}
                              onClick={() =>
                                handleTestSsh(ssh.id, selectedProject.name, ssh)
                              }
                              className="h-8 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 text-[#3fb950] ${
                                  testState?.testing ? "animate-spin" : ""
                                }`}
                              />
                              <span>
                                {testState?.testing ? "Testing..." : "Test"}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={isAnyBusy}
                              onClick={() => handleOpenSsh(selectedProject.name, ssh)}
                              className={`h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${BTN_GREEN}`}
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>SSH Access</span>
                            </button>

                            <button
                              type="button"
                              disabled={isAnyBusy}
                              onClick={() => {
                                const next = (
                                  selectedProject.config.sshSessions || []
                                ).filter((_, i) => i !== idx);
                                updateProjectConfig(selectedProject.name, {
                                  sshSessions: next,
                                });
                              }}
                              title="Delete SSH session"
                              className="p-1.5 text-[#8b949e] hover:text-[#da3633] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {testState?.message && (
                          <div
                            className={`text-xs font-mono px-2.5 py-1.5 rounded border ${
                              testState.ok
                                ? "bg-[#238636]/15 border-[#238636] text-[#3fb950]"
                                : "bg-[#da3633]/15 border-[#da3633] text-[#f85149]"
                            }`}
                          >
                            {testState.ok ? "✓ " : "✗ "}
                            {testState.message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Add / Test New SSH Session */}
                <div className="pt-3 border-t border-[#30363d] space-y-2.5">
                  <span className="block text-xs font-semibold text-[#e6edf3]">
                    Add SSH Session
                  </span>

                  <div className="flex flex-col lg:flex-row lg:items-end gap-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 flex-1 min-w-0">
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-[#8b949e] mb-1">
                          Label (Optional)
                        </label>
                        <input
                          type="text"
                          value={newSshLabel}
                          onChange={(e) => setNewSshLabel(e.target.value)}
                          placeholder="e.g. Production"
                          className={`w-full ${INPUT_BASE}`}
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="block text-[11px] text-[#8b949e] mb-1">
                          SSH Command
                        </label>
                        <input
                          type="text"
                          value={newSshCommand}
                          onChange={(e) => {
                            setNewSshCommand(e.target.value);
                            if (sshTestStatus["new"]) {
                              setSshTestStatus((prev) => {
                                const copy = { ...prev };
                                delete copy["new"];
                                return copy;
                              });
                            }
                          }}
                          placeholder="ssh user@example.com -p 22"
                          className={`w-full font-mono !text-[#3fb950] ${INPUT_BASE}`}
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className="block text-[11px] text-[#8b949e] mb-1">
                          Password (Optional — can be empty)
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type={showNewSshPass ? "text" : "password"}
                            value={newSshPassword}
                            onChange={(e) => {
                              setNewSshPassword(e.target.value);
                              if (sshTestStatus["new"]) {
                                setSshTestStatus((prev) => {
                                  const copy = { ...prev };
                                  delete copy["new"];
                                  return copy;
                                });
                              }
                            }}
                            placeholder="Optional password"
                            className={`w-full pr-8 font-mono ${INPUT_BASE}`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewSshPass(!showNewSshPass)}
                            title={showNewSshPass ? "Hide password" : "Show password"}
                            className="absolute right-2 text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
                          >
                            {showNewSshPass ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={sshTestStatus["new"]?.testing || isAnyBusy}
                        onClick={() =>
                          handleTestSsh("new", selectedProject.name, {
                            label: newSshLabel.trim() || undefined,
                            command: newSshCommand.trim(),
                            password: newSshPassword,
                          })
                        }
                        title="Test if this SSH command and password can connect"
                        className="h-8 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#e6edf3] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 text-[#3fb950] ${
                            sshTestStatus["new"]?.testing ? "animate-spin" : ""
                          }`}
                        />
                        <span>
                          {sshTestStatus["new"]?.testing
                            ? "Testing..."
                            : "Test"}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isAnyBusy}
                        onClick={() => {
                          if (!newSshCommand.trim()) return;
                          const item: SshSessionConfig = {
                            id: `ssh-${Date.now()}`,
                            label: newSshLabel.trim() || undefined,
                            command: newSshCommand.trim(),
                            password: newSshPassword,
                          };
                          updateProjectConfig(selectedProject.name, {
                            sshSessions: [
                              ...(selectedProject.config.sshSessions || []),
                              item,
                            ],
                          });
                          setNewSshLabel("");
                          setNewSshCommand("");
                          setNewSshPassword("");
                          setSshTestStatus((prev) => {
                            const copy = { ...prev };
                            delete copy["new"];
                            return copy;
                          });
                        }}
                        className={`h-8 px-3.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${BTN_GREEN}`}
                      >
                        + Add SSH
                      </button>
                    </div>
                  </div>

                  {sshTestStatus["new"]?.message && (
                    <div
                      className={`text-xs font-mono px-2.5 py-1.5 rounded border ${
                        sshTestStatus["new"].ok
                          ? "bg-[#238636]/15 border-[#238636] text-[#3fb950]"
                          : "bg-[#da3633]/15 border-[#da3633] text-[#f85149]"
                      }`}
                    >
                      {sshTestStatus["new"].ok ? "✓ " : "✗ "}
                      {sshTestStatus["new"].message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* COLLAPSIBLE BOTTOM TASK OUTPUT DRAWER */}
        {showLogsDrawer && (
          <div className="h-56 bg-[#090d11] border-t border-[#30363d] flex flex-col shrink-0">
            <div className="px-4 py-1.5 bg-[#161b22] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[#e6edf3]">
                  Task & Docker Output Log
                </span>
                {processes.map((proc) => (
                  <span
                    key={proc.id}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#21262d] border border-[#30363d] text-[11px]"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        proc.running ? "bg-[#3fb950]" : "bg-[#484f58]"
                      }`}
                    />
                    <span>
                      {proc.project}
                      {proc.workingDir && proc.workingDir !== "."
                        ? ` (${proc.workingDir})`
                        : ""}
                      : {proc.command}
                    </span>
                    {proc.running && (
                      <button
                        onClick={() => handleKillProcess(proc.id)}
                        className="text-[#f85149] hover:underline ml-1 cursor-pointer"
                      >
                        Stop
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    await fetch(`${API_BASE}/api/logs/clear`, { method: "POST" });
                    setLogs([]);
                  }}
                  className="text-[#8b949e] hover:text-white cursor-pointer"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowLogsDrawer(false)}
                  className="text-[#8b949e] hover:text-white cursor-pointer"
                >
                  Hide
                </button>
              </div>
            </div>
            <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1">
              {logs.length === 0 ? (
                <div className="text-[#484f58]">
                  No output yet. When you run WP-CLI, npm run dev/build, or start/stop Docker, live output appears here.
                </div>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2">
                    <span className="text-[#484f58] shrink-0">{entry.timestamp}</span>
                    <span className="text-[#3fb950] shrink-0">[{entry.project}]</span>
                    <span
                      className={
                        entry.stream === "stderr"
                          ? "text-[#f85149] break-all"
                          : entry.stream === "system"
                          ? "text-[#3fb950] break-all"
                          : "text-[#e6edf3] break-all"
                      }
                    >
                      {entry.line}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
