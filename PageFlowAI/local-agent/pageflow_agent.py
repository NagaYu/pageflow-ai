#!/usr/bin/env python3
"""PageFlow AI - local cleanup agent

A small HTTP server hit by the PageFlow AI Chrome extension's "🛠 Dev" tab.
Binds only to 127.0.0.1 and executes only a fixed allowlist of commands
(arbitrary command execution is not possible by design).

Start:
    python3 pageflow_agent.py

Endpoints:
    GET /health             ... health check
    GET /clean/ports?port=N ... kill whatever process is holding port N
    GET /clean/docker       ... remove stopped containers / dangling images / build cache
    GET /clean/cache        ... clean up npm / pip / yarn caches
    GET /clean/all?port=N   ... run all of the above in sequence
"""

import json
import platform
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 8765
VERSION = "1.0.0"
TIMEOUT = 60  # timeout per command, in seconds


def run(name, cmd):
    """Run one fixed, allowlisted command and return a result dict."""
    if shutil.which(cmd[0]) is None:
        return {"name": name, "ok": False, "output": f"{cmd[0]} not found (not installed?)"}
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True, timeout=TIMEOUT, check=False
        )
        out = (p.stdout or "") + (p.stderr or "")
        return {"name": name, "ok": p.returncode == 0, "output": out.strip()[:2000]}
    except subprocess.TimeoutExpired:
        return {"name": name, "ok": False, "output": f"Timed out after {TIMEOUT}s"}
    except Exception as e:  # noqa: BLE001
        return {"name": name, "ok": False, "output": str(e)}


def clean_ports(port):
    """Find whatever process is holding the given port and terminate it."""
    steps = []
    found = run(f"Find process using port {port}", ["lsof", "-ti", f"tcp:{port}"])
    steps.append(found)
    pids = [p for p in found["output"].split() if p.isdigit()]
    if not pids:
        steps.append({"name": f"Port {port}", "ok": True, "output": "No process is using it (already clean)"})
        return steps
    for pid in pids[:20]:
        steps.append(run(f"Terminate PID {pid}", ["kill", "-9", pid]))
    return steps


def clean_docker():
    """Clean up zombie containers, dangling images, and build cache."""
    return [
        run("Remove stopped containers", ["docker", "container", "prune", "-f"]),
        run("Remove dangling images", ["docker", "image", "prune", "-f"]),
        run("Remove unused networks", ["docker", "network", "prune", "-f"]),
        run("Remove build cache", ["docker", "builder", "prune", "-f"]),
    ]


def clean_cache():
    """Tidy up various package-manager caches."""
    steps = []
    steps.append(run("Verify npm cache", ["npm", "cache", "verify"]))
    steps.append(run("Clean yarn cache", ["yarn", "cache", "clean"]))
    steps.append(run("Purge pip cache", ["pip3", "cache", "purge"]))
    return steps


class Handler(BaseHTTPRequestHandler):
    server_version = "PageFlowAgent/" + VERSION

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Allow fetch() from the extension page (binding is 127.0.0.1 only)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        qs = parse_qs(url.query)

        # Reject calls from anything other than the extension (CSRF protection)
        origin = self.headers.get("Origin", "")
        if origin and not origin.startswith("chrome-extension://"):
            self._send(403, {"ok": False, "error": "forbidden origin"})
            return

        if url.path == "/health":
            self._send(200, {"ok": True, "version": VERSION, "platform": platform.system()})
            return

        try:
            port = int(qs.get("port", ["3000"])[0])
            if not (1 <= port <= 65535):
                raise ValueError
        except ValueError:
            self._send(400, {"ok": False, "error": "invalid port"})
            return

        if url.path == "/clean/ports":
            steps = clean_ports(port)
        elif url.path == "/clean/docker":
            steps = clean_docker()
        elif url.path == "/clean/cache":
            steps = clean_cache()
        elif url.path == "/clean/all":
            steps = clean_ports(port) + clean_docker() + clean_cache()
        else:
            self._send(404, {"ok": False, "error": "not found"})
            return

        self._send(200, {"ok": all(s["ok"] for s in steps), "steps": steps})

    def log_message(self, fmt, *args):  # keep the default log terse
        sys.stderr.write("[agent] %s\n" % (fmt % args))


def main():
    server = HTTPServer((HOST, PORT), Handler)
    print(f"PageFlow AI local agent v{VERSION}")
    print(f"Listening on http://{HOST}:{PORT}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")


if __name__ == "__main__":
    main()
