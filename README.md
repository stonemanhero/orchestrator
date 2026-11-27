# Orchestrator

A native Linux desktop application that discovers and manages all local development projects in a configurable root directory (default `~/Projects`). Orchestrator lets you switch between projects with one click — controlling Docker Compose stacks, PhpStorm windows, Google Chrome profiles & URLs, container/host NPM & WP-CLI tasks, and interactive SSH sessions.

---

## Features

- **One-Click Project Activation (`Activate` / `Launch IDE & Browser`)**
  - Optionally stops other running Docker Compose stacks before starting the target project.
  - Starts the project's Docker Compose containers (`docker compose up -d`).
  - Launches PhpStorm for the project directory (with live window state detection so open projects show `IDE Open`).
  - Opens Google Chrome with a project-specific Chrome Profile and all configured local/dev URLs.
  - Auto-runs any configured container or host startup tasks (e.g., `npm run watch`, `npm run dev`).
- **Docker Compose & Container Management**
  - Auto-detects `docker-compose.yml` / `compose.yml` services and running container statuses/ports.
  - Start, Stop, Restart per project or `Stop All` running projects with confirmation modals.
  - Open interactive `gnome-terminal` shells directly inside running containers or on the host.
  - Run one-off container commands and **WP-CLI** commands (`docker compose run --rm wpcli wp ...`) without needing persistent CLI containers.
- **Container & Host Task Runner**
  - Auto-discovers `package.json` scripts across the project root and nested theme/plugin directories.
  - Save custom host or container commands with custom working directories and stream live `stdout`/`stderr` output in the slide-up **Activity Log** drawer.
- **Interactive SSH Sessions & Connection Tester**
  - Save multiple SSH commands per project with optional auto-login password fill via PTY helper (`server/ssh-helper.py`).
  - Test SSH connectivity & authentication non-interactively (`Test` button) or launch an interactive terminal session with one click.

---

## Tech Stack & Architecture

- **Desktop Shell**: Tauri v2 (`src-tauri/`, native binary `src-tauri/target/release/orchestrator`, with automatic fallback to Chrome `--app` mode if Rust/Tauri is not compiled)
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 (`src/App.tsx`, `src/index.css`)
- **Backend Daemon**: Node.js v22+ (`--experimental-strip-types`) serving the REST API and static frontend on `http://127.0.0.1:1420` (`server/prod-server.ts`, `server/orchestrator.ts`)
- **SSH PTY Helper**: Python 3 PTY wrapper (`server/ssh-helper.py`)
- **CLI & Lifecycle Executable**: `./orchestrator`

---

## Prerequisites

- **Linux** (Ubuntu / Debian / desktop environment with `gnome-terminal` and `google-chrome`)
- **Node.js v22+** (required for native TypeScript execution via `--experimental-strip-types`)
- **Python 3** (for SSH PTY automation and connection testing)
- **Docker & Docker Compose** (`docker compose`)
- *(Optional)* **Rust & Cargo** + Tauri v2 system dependencies to compile the native Tauri window binary:
  ```bash
  sudo apt update
  sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
  *(If Rust/Cargo is not installed, `orchestrator` will automatically fall back to launching a standalone Chrome app window.)*

---

## Installation

Clone the repository and run the built-in installer:

```bash
git clone <YOUR_GIT_REPO_URL> ~/Projects/orchestrator
cd ~/Projects/orchestrator
./orchestrator install
```

What `./orchestrator install` does:
1. Detects Node.js v22+ (from `PATH` or `~/.nvm`).
2. Runs `npm install` and builds the production frontend (`npm run build` -> `dist/`).
3. Compiles the native Tauri binary (`src-tauri/target/release/orchestrator`) if `cargo` is available.
4. Creates the global CLI symlink at `~/.local/bin/orchestrator`.
5. Registers the desktop entry at `~/.local/share/applications/orchestrator.desktop`.
6. Starts the background daemon on `http://127.0.0.1:1420`.

*(To force a rebuild of the native Tauri Rust binary during install, run `./orchestrator install --tauri`.)*

---

## Usage & CLI Commands

Once installed, launch Orchestrator from your OS **Applications Menu** (press `Super` and search **Orchestrator**) or use the `orchestrator` CLI from any terminal:

| Command | Description |
| --- | --- |
| `orchestrator` | Starts the background daemon (if not running) and opens the Orchestrator desktop window |
| `orchestrator install` | Installs dependencies, builds frontend (+ Tauri binary if needed), and creates CLI symlink & desktop icon |
| `orchestrator install --tauri` | Runs install and forces a fresh `cargo build --release` of the native Tauri binary |
| `orchestrator update` | Runs `git pull`, `npm install`, `npm run build`, and restarts the background daemon |
| `orchestrator update --tauri` | Updates via Git, rebuilds both frontend and Tauri binary, and restarts the daemon |
| `orchestrator restart` | Restarts the background daemon on `http://127.0.0.1:1420` |
| `orchestrator stop` | Stops the running Orchestrator window and background daemon |
| `orchestrator status` | Displays daemon status, config directory, symlink, and desktop entry paths |
| `orchestrator uninstall` | Stops Orchestrator and removes the CLI symlink & desktop shortcut (keeps `~/.config/orchestrator`) |
| `orchestrator uninstall --purge` | Uninstalls Orchestrator and also deletes `~/.config/orchestrator` |
| `orchestrator help` | Shows CLI usage instructions |

---

## Configuration & Data Storage

All user settings are stored locally per machine in `~/.config/orchestrator/`:

- **`~/.config/orchestrator/settings.json`** — Stores global settings such as `projectsRoot` (changeable directly from the header UI).
- **`~/.config/orchestrator/projects.json`** — Stores per-project preferences:
  - `favorite`, `stopOthersOnSwitch`, `startDockerOnSwitch`, `openPhpStormOnSwitch`, `openChromeOnSwitch`
  - `chromeProfile` & `urls`
  - `commands` (custom container/host tasks & working directories)
  - `sshSessions` (saved SSH sessions & passwords)

Because configuration lives in `~/.config/orchestrator/`, you can safely `git push` and `orchestrator update` across multiple machines (e.g., desktop and laptop) without overwriting machine-specific project settings.

---

## Development Workflow

- **Backend changes (`server/orchestrator.ts`, `server/prod-server.ts`, `server/ssh-helper.py`)**:
  Node v22 executes `.ts` files directly. Restart the daemon to apply changes immediately:
  ```bash
  orchestrator restart
  ```
- **Frontend changes (`src/App.tsx`, `src/index.css`)**:
  Rebuild `dist/` so the daemon serves the updated bundle:
  ```bash
  npm run build
  ```
- **Native Tauri shell changes (`src-tauri/`)**:
  Recompile the Rust release binary:
  ```bash
  orchestrator update --tauri
  ```
