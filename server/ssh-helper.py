#!/usr/bin/env python3
"""
PTY wrapper for SSH commands inside Orchestrator.
Modes:
  1. Interactive mode (default): runs inside gnome-terminal, auto-fills password
     if ORCHESTRATOR_SSH_PASS is non-empty, and hands full interactive control to the user.
  2. Test mode (--test): tests the SSH connection non-interactively with a 10s
     timeout and exits 0 on success or non-zero with error message on failure.
"""
import os
import pty
import select
import sys
import termios
import tty
import fcntl
import struct
import signal
import time

def set_winsize(fd, rows, cols):
    s = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)

def get_winsize(fd):
    try:
        s = fcntl.ioctl(fd, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
        rows, cols, _, _ = struct.unpack("HHHH", s)
        return rows, cols
    except Exception:
        return 24, 80

def run_test_mode(cmd: str, password: str) -> int:
    marker = "__ORCHESTRATOR_SSH_OK__"
    test_cmd = f'{cmd} "echo {marker}"'

    pid, master_fd = pty.fork()
    if pid == 0:
        os.execvp("bash", ["bash", "-c", test_cmd])
        sys.exit(1)

    password_sent = False
    hostkey_sent = False
    buffer = b""
    all_output = b""
    start_time = time.time()
    timeout_sec = 10.0
    auth_error = None

    try:
        while True:
            elapsed = time.time() - start_time
            if elapsed >= timeout_sec:
                auth_error = "Connection timed out after 10 seconds."
                try:
                    os.kill(pid, signal.SIGTERM)
                except Exception:
                    pass
                break

            rlist, _, _ = select.select([master_fd], [], [], 0.25)
            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break

                all_output += data
                buffer = (buffer + data)[-1024:]
                lower_buf = buffer.lower()

                if marker.encode("utf-8") in all_output:
                    print("SSH connection verified successfully.")
                    return 0

                if not hostkey_sent and b"continue connecting (yes/no" in lower_buf:
                    os.write(master_fd, b"yes\n")
                    hostkey_sent = True
                    buffer = b""
                    continue

                if b"password:" in lower_buf or b"passphrase" in lower_buf:
                    if password and not password_sent:
                        os.write(master_fd, (password + "\n").encode("utf-8"))
                        password_sent = True
                        buffer = b""
                    else:
                        if not password:
                            auth_error = "Password or passphrase required, but password field is empty."
                        else:
                            auth_error = "Authentication failed: password rejected by remote server."
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except Exception:
                            pass
                        break
    finally:
        try:
            os.close(master_fd)
        except Exception:
            pass

    exit_code = 1
    try:
        _, status = os.waitpid(pid, 0)
        if os.WIFEXITED(status):
            exit_code = os.WEXITSTATUS(status)
    except Exception:
        pass

    if marker.encode("utf-8") in all_output or (exit_code == 0 and not auth_error):
        print("SSH connection verified successfully.")
        return 0

    if auth_error:
        print(auth_error)
        return 1

    text = all_output.decode("utf-8", errors="replace").strip()
    lines = [
        ln.strip()
        for ln in text.splitlines()
        if ln.strip() and not ln.strip().lower().endswith("password:")
    ]
    summary = lines[-1] if lines else f"SSH exited with code {exit_code}"
    print(summary)
    return 1

def run_interactive_mode(cmd: str, password: str):
    print(f"\033[1;32m$ {cmd}\033[0m")

    pid, master_fd = pty.fork()
    if pid == 0:
        os.execvp("bash", ["bash", "-c", cmd])
        sys.exit(1)

    rows, cols = get_winsize(sys.stdin.fileno())
    set_winsize(master_fd, rows, cols)

    def handle_sigwinch(signum, frame):
        r, c = get_winsize(sys.stdin.fileno())
        set_winsize(master_fd, r, c)

    signal.signal(signal.SIGWINCH, handle_sigwinch)

    old_tty = None
    try:
        old_tty = termios.tcgetattr(sys.stdin.fileno())
        tty.setraw(sys.stdin.fileno())
    except Exception:
        pass

    password_sent = False
    buffer = b""

    try:
        while True:
            rlist, _, _ = select.select([master_fd, sys.stdin.fileno()], [], [])
            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)

                if password and not password_sent:
                    buffer = (buffer + data)[-512:]
                    lower_buf = buffer.lower()
                    if b"password:" in lower_buf or b"passphrase" in lower_buf:
                        os.write(master_fd, (password + "\n").encode("utf-8"))
                        password_sent = True
                        buffer = b""

            if sys.stdin.fileno() in rlist:
                try:
                    user_input = os.read(sys.stdin.fileno(), 1024)
                except OSError:
                    break
                if not user_input:
                    break
                os.write(master_fd, user_input)
    finally:
        if old_tty is not None:
            try:
                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old_tty)
            except Exception:
                pass
        try:
            os.close(master_fd)
        except Exception:
            pass
        try:
            os.waitpid(pid, 0)
        except Exception:
            pass

def main():
    cmd = os.environ.get("ORCHESTRATOR_SSH_CMD", "").strip()
    password = os.environ.get("ORCHESTRATOR_SSH_PASS", "")

    if not cmd:
        print("No SSH command specified.")
        sys.exit(1)

    if "--test" in sys.argv:
        code = run_test_mode(cmd, password)
        sys.exit(code)
    else:
        run_interactive_mode(cmd, password)

if __name__ == "__main__":
    main()
