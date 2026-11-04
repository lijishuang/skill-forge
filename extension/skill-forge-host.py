#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Skill 工坊 · 本地执行器（Local Execution Host）

让浏览器里的 Skill 工坊能够「真正执行」上传的 Skill 包（含 scripts/ 里的
python / shell 脚本），而不是只把 SKILL.md 塞给模型口头模拟。

用法：
    python3 skill-forge-host.py            # 默认端口 39217
    python3 skill-forge-host.py --port 9000

仅监听 127.0.0.1，不对外网开放。纯 Python 标准库，无第三方依赖。

接口（均带 CORS 头，供扩展页 / 独立 HTML 页面跨源调用）：
    GET  /ping                  → {ok, version, python}
    POST /upload                → 安装技能包  {name, files:[{path, b64}]}
                                  返回 {ok, dir}（安装根目录，exec 的默认 cwd）
    POST /exec                  → 执行命令    {command, cwd?, timeout?}
                                  返回 {ok, code, output}（stdout+stderr 合并）
    POST /ls                    → 列目录      {path} → {ok, files:[{name,size,dir}]}
    POST /find                  → 递归找文件  {root, ext:'.html', since?, maxDepth?, limit?}
                                  → {ok, files:[{path, rel, size, mtime}]}（自动跳过 input/ 子目录）
    POST /read                  → 读文件      {path} → {ok, b64, size}（≤20MB）
    POST /open                  → 用系统默认程序打开文件/目录 {path}

技能包安装位置：~/.skill-forge/skills/<name>/（每次 upload 先清空再写入）
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.3.0"
BASE_DIR = os.path.expanduser("~/.skill-forge")
SKILLS_DIR = os.path.join(BASE_DIR, "skills")
MAX_BODY = 64 * 1024 * 1024        # 64MB，足够文本型技能包
MAX_READ = 20 * 1024 * 1024        # /read 单文件上限 20MB
DEFAULT_TIMEOUT = 600              # 单条命令默认超时 10 分钟
MAX_TIMEOUT = 1800


def safe_name(name):
    """技能目录名：只保留中英文/数字/_-，防止路径逃逸"""
    name = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", str(name or "skill")).strip("._")
    return name[:60] or "skill"


def safe_relpath(p):
    """相对路径清洗：拒绝绝对路径与 ..，统一 / 分隔"""
    p = str(p or "").replace("\\", "/").lstrip("/")
    parts = [seg for seg in p.split("/") if seg not in ("", ".", "..")]
    if not parts:
        raise ValueError("bad path: " + p)
    return os.path.join(*parts)


class Handler(BaseHTTPRequestHandler):
    server_version = "SkillForgeHost/" + VERSION

    # ---- 基础设施 ----
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _reply(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            raise ValueError("invalid body size: %d" % n)
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def log_message(self, fmt, *args):
        sys.stderr.write("[host] %s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- 路由 ----
    def do_GET(self):
        if self.path.startswith("/ping"):
            self._reply({"ok": True, "version": VERSION,
                         "python": sys.version.split()[0],
                         "skillsDir": SKILLS_DIR})
        else:
            self._reply({"ok": False, "error": "unknown endpoint"}, 404)

    def do_POST(self):
        try:
            if self.path.startswith("/upload"):
                self._upload()
            elif self.path.startswith("/exec"):
                self._exec()
            elif self.path.startswith("/ls"):
                self._ls()
            elif self.path.startswith("/find"):
                self._find()
            elif self.path.startswith("/read"):
                self._read()
            elif self.path.startswith("/open"):
                self._open()
            else:
                self._reply({"ok": False, "error": "unknown endpoint"}, 404)
        except Exception as e:
            self._reply({"ok": False, "error": str(e)}, 400)

    # ---- /upload：安装技能包（merge=true 时追加文件而不清空） ----
    def _upload(self):
        data = self._body()
        name = safe_name(data.get("name"))
        files = data.get("files") or []
        if not files:
            raise ValueError("no files")
        dest = os.path.join(SKILLS_DIR, name)
        if not data.get("merge") and os.path.isdir(dest):
            shutil.rmtree(dest)
        os.makedirs(dest, exist_ok=True)
        count = 0
        for f in files:
            rel = safe_relpath(f.get("path"))
            raw = base64.b64decode(f.get("b64") or "")
            path = os.path.join(dest, rel)
            if not os.path.abspath(path).startswith(os.path.abspath(dest)):
                raise ValueError("path escapes skill dir: " + rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fp:
                fp.write(raw)
            count += 1
        self._reply({"ok": True, "dir": dest, "files": count, "name": name})

    # ---- /exec：执行命令 ----
    def _exec(self):
        data = self._body()
        cmd = str(data.get("command") or "").strip()
        if not cmd:
            raise ValueError("empty command")
        cwd = data.get("cwd") or SKILLS_DIR
        if not os.path.isdir(cwd):
            raise ValueError("cwd not found: " + cwd)
        timeout = min(int(data.get("timeout") or DEFAULT_TIMEOUT), MAX_TIMEOUT)
        try:
            p = subprocess.run(cmd, shell=True, cwd=cwd,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               timeout=timeout)
            out = p.stdout.decode("utf-8", errors="replace")
            code = p.returncode
        except subprocess.TimeoutExpired as e:
            out = (e.stdout or b"").decode("utf-8", errors="replace") + \
                  "\n[host] 命令超时（%d 秒），已终止" % timeout
            code = 124
        # 截断超大输出，防止把浏览器端撑爆
        if len(out) > 400000:
            out = out[:200000] + "\n…[输出过长，已截断]…\n" + out[-200000:]
        self._reply({"ok": True, "code": code, "output": out, "cwd": cwd})

    # ---- /ls：列目录 ----
    def _ls(self):
        data = self._body()
        path = os.path.expanduser(str(data.get("path") or "").strip())
        if not path or not os.path.exists(path):
            raise ValueError("path not found: " + path)
        if os.path.isfile(path):
            self._reply({"ok": True, "isFile": True,
                         "files": [{"name": os.path.basename(path),
                                    "size": os.path.getsize(path), "dir": False}]})
            return
        out = []
        for n in sorted(os.listdir(path))[:500]:
            fp = os.path.join(path, n)
            try:
                out.append({"name": n, "dir": os.path.isdir(fp),
                            "size": os.path.getsize(fp) if os.path.isfile(fp) else 0})
            except OSError:
                pass
        self._reply({"ok": True, "isFile": False, "files": out})

    # ---- /find：递归查找指定扩展名的文件（跳过 input/，供浏览器端发现生成的 HTML 报告） ----
    def _find(self):
        data = self._body()
        root = os.path.expanduser(str(data.get("root") or "").strip())
        ext = str(data.get("ext") or ".html").lower()
        since = float(data.get("since") or 0)
        max_depth = min(int(data.get("maxDepth") or 5), 8)
        limit = min(int(data.get("limit") or 50), 200)
        if not root or not os.path.isdir(root):
            raise ValueError("root not found: " + root)
        out = []

        def walk(d, depth, rel):
            if len(out) >= limit or depth > max_depth:
                return
            try:
                names = sorted(os.listdir(d))
            except OSError:
                return
            for n in names:
                if len(out) >= limit:
                    return
                fp = os.path.join(d, n)
                r = (rel + "/" + n) if rel else n
                if os.path.isdir(fp):
                    if n == "input" or n.startswith("."):
                        continue          # 跳过上传的待检文件与隐藏目录
                    walk(fp, depth + 1, r)
                elif n.lower().endswith(ext):
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    if st.st_mtime < since:
                        continue
                    out.append({"path": fp, "rel": r,
                                "size": st.st_size, "mtime": st.st_mtime})

        walk(root, 0, "")
        out.sort(key=lambda x: -x["mtime"])
        self._reply({"ok": True, "files": out})

    # ---- /read：读取文件内容（base64，供浏览器端加载生成的 HTML） ----
    def _read(self):
        data = self._body()
        path = os.path.expanduser(str(data.get("path") or "").strip())
        if not path or not os.path.isfile(path):
            raise ValueError("file not found: " + path)
        size = os.path.getsize(path)
        if size > MAX_READ:
            raise ValueError("file too large (>20MB): " + path)
        with open(path, "rb") as fp:
            raw = fp.read()
        self._reply({"ok": True, "b64": base64.b64encode(raw).decode("ascii"),
                     "size": size, "path": path})

    # ---- /open：系统默认程序打开 ----
    def _open(self):
        data = self._body()
        path = os.path.expanduser(str(data.get("path") or "").strip())
        if not os.path.exists(path):
            raise ValueError("path not found: " + path)
        if sys.platform == "darwin":
            subprocess.Popen(["open", path])
        elif sys.platform.startswith("win"):
            os.startfile(path)  # noqa
        else:
            subprocess.Popen(["xdg-open", path])
        self._reply({"ok": True})


def main():
    ap = argparse.ArgumentParser(description="Skill 工坊本地执行器")
    ap.add_argument("--port", type=int, default=39217)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    # 已有执行器在线时直接正常退出（launchd 守护重启场景： SuccessfulExit=false 不会再拉起）
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 绕过系统代理访问本机
        with opener.open("http://127.0.0.1:%d/ping" % args.port, timeout=1) as resp:
            info = json.loads(resp.read().decode("utf-8"))
            if info.get("ok"):
                print("[host] 端口 %d 已有执行器在线（v%s），无需重复启动" % (args.port, info.get("version", "?")))
                return
    except Exception:
        pass
    os.makedirs(SKILLS_DIR, exist_ok=True)
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("=" * 56)
    print("  Skill 工坊 · 本地执行器 v%s" % VERSION)
    print("  地址: http://%s:%d  （仅本机可访问）" % (args.host, args.port))
    print("  技能安装目录: %s" % SKILLS_DIR)
    print("  保持本窗口开启即可；关闭窗口 = 停止执行器")
    print("=" * 56)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[host] 已停止")


if __name__ == "__main__":
    main()
