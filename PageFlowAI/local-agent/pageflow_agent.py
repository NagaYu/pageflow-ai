#!/usr/bin/env python3
"""PageFlow AI - ローカルクリーンアップエージェント

Chrome 拡張 PageFlow AI の「🛠 開発」タブから叩かれる小さな HTTP サーバー。
127.0.0.1:8765 にのみバインドし、許可リスト化された定型コマンドだけを実行する
（任意コマンドの実行は一切できない設計）。

起動:
    python3 pageflow_agent.py

エンドポイント:
    GET /health             ... 死活確認
    GET /clean/ports?port=N ... ポート N を掴んでいるプロセスを kill
    GET /clean/docker       ... 停止済みコンテナ/dangling イメージ/ビルドキャッシュを削除
    GET /clean/cache        ... npm / pip / yarn のキャッシュを整理
    GET /clean/all?port=N   ... 上記すべてを順に実行
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
TIMEOUT = 60  # 各コマンドのタイムアウト(秒)


def run(name, cmd):
    """許可リスト内の固定コマンドを実行して結果 dict を返す。"""
    if shutil.which(cmd[0]) is None:
        return {"name": name, "ok": False, "output": f"{cmd[0]} が見つかりません（未インストール？）"}
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True, timeout=TIMEOUT, check=False
        )
        out = (p.stdout or "") + (p.stderr or "")
        return {"name": name, "ok": p.returncode == 0, "output": out.strip()[:2000]}
    except subprocess.TimeoutExpired:
        return {"name": name, "ok": False, "output": f"{TIMEOUT}秒でタイムアウトしました"}
    except Exception as e:  # noqa: BLE001
        return {"name": name, "ok": False, "output": str(e)}


def clean_ports(port):
    """指定ポートを掴んでいるプロセスを特定して終了させる。"""
    steps = []
    found = run(f"ポート {port} の使用プロセスを検索", ["lsof", "-ti", f"tcp:{port}"])
    steps.append(found)
    pids = [p for p in found["output"].split() if p.isdigit()]
    if not pids:
        steps.append({"name": f"ポート {port}", "ok": True, "output": "使用中のプロセスはありません（既にクリーン）"})
        return steps
    for pid in pids[:20]:
        steps.append(run(f"PID {pid} を終了", ["kill", "-9", pid]))
    return steps


def clean_docker():
    """ゾンビコンテナ・宙ぶらりんイメージ・ビルドキャッシュを掃除する。"""
    return [
        run("停止済みコンテナの削除", ["docker", "container", "prune", "-f"]),
        run("dangling イメージの削除", ["docker", "image", "prune", "-f"]),
        run("未使用ネットワークの削除", ["docker", "network", "prune", "-f"]),
        run("ビルドキャッシュの削除", ["docker", "builder", "prune", "-f"]),
    ]


def clean_cache():
    """各種パッケージマネージャのキャッシュを整理する。"""
    steps = []
    steps.append(run("npm キャッシュ検証", ["npm", "cache", "verify"]))
    steps.append(run("yarn キャッシュ削除", ["yarn", "cache", "clean"]))
    steps.append(run("pip キャッシュ削除", ["pip3", "cache", "purge"]))
    return steps


class Handler(BaseHTTPRequestHandler):
    server_version = "PageFlowAgent/" + VERSION

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 拡張機能ページからの fetch を許可（バインドは 127.0.0.1 のみ）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        qs = parse_qs(url.query)

        # 拡張機能以外の Web ページからの呼び出しを拒否（CSRF 対策）
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

    def log_message(self, fmt, *args):  # 標準ログを簡潔に
        sys.stderr.write("[agent] %s\n" % (fmt % args))


def main():
    server = HTTPServer((HOST, PORT), Handler)
    print(f"PageFlow AI ローカルエージェント v{VERSION}")
    print(f"待ち受け: http://{HOST}:{PORT}  (Ctrl+C で終了)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します。")


if __name__ == "__main__":
    main()
