#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Skill 工坊 · MCP 通用桥接器（Skill Forge MCP Bridge）

把 ~/.skill-forge/skills/ 下已安装的所有 Skill 自动暴露为 MCP 工具，
让任何支持 MCP 的 AI 客户端（WorkBuddy / Claude Desktop / …）直接调用：
AI 读取 SKILL.md 指令 → 真实运行 scripts/ 里的脚本 → 基于输出回答。

与网页版扩展共用同一技能目录：网页上传的 Skill 立即可用，
这里 install_skill 安装的包，网页工作台也能看到。转换零成本：
新增/更新 Skill 不需要重新生成或注册任何东西。

注册方式（MCP 客户端配置，stdio 传输）：
    {
      "mcpServers": {
        "skill-forge": {
          "command": "python3",
          "args": ["/path/to/skill-forge-mcp.py"]
        }
      }
    }

协议：MCP stdio（换行分隔 JSON-RPC 2.0），纯 Python 标准库，无第三方依赖。
日志只写 stderr，stdout 专用于协议消息。

工具一览：
    list_skills()                        已安装技能列表（名称/描述/文件）
    use_skill(name)                      读取 SKILL.md 完整指令
    read_skill_file(name, path)          读取技能内参考文件
    run_skill(name, command, timeout?)   在技能目录下同步执行一条命令
    start_job(name, command, timeout?)   后台启动长任务，返回 job_id
    job_status(job_id)                   查询后台任务状态与输出
    install_skill(path)                  从本机 zip / 目录安装技能包
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile

VERSION = "1.0.0"
BASE_DIR = os.path.expanduser("~/.skill-forge")
SKILLS_DIR = os.path.join(BASE_DIR, "skills")
DEFAULT_TIMEOUT = 300
MAX_TIMEOUT = 1800
MAX_OUTPUT = 200000          # 工具回传的输出上限（字符）


def log(*args):
    sys.stderr.write("[skill-forge-mcp] " + " ".join(str(a) for a in args) + "\n")
    sys.stderr.flush()


def safe_name(name):
    name = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", str(name or "skill")).strip("._")
    return name[:60] or "skill"


def safe_join(base, rel):
    """技能内相对路径安全拼接，拒绝越界"""
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    parts = [seg for seg in rel.split("/") if seg not in ("", ".", "..")]
    if not parts:
        raise ValueError("bad path")
    p = os.path.join(base, *parts)
    if not os.path.abspath(p).startswith(os.path.abspath(base)):
        raise ValueError("path escapes skill dir")
    return p


def parse_front_matter(text):
    name, desc = "", ""
    m = re.match(r"^---\s*\n([\s\S]*?)\n---", text or "")
    if m:
        for line in m.group(1).splitlines():
            km = re.match(r"^(name|description)\s*:\s*(.*)$", line.strip())
            if km:
                if km.group(1) == "name":
                    name = km.group(2).strip().strip('"').strip("'")
                else:
                    desc = km.group(2).strip().strip('"').strip("'")
    return name, desc


def skill_dir(name):
    d = os.path.join(SKILLS_DIR, safe_name(name))
    if not os.path.isdir(d):
        raise ValueError("技能不存在: " + str(name) + "（可先 list_skills 查看，或 install_skill 安装）")
    return d


# ---------------- 工具实现 ----------------

def tool_list_skills(args):
    out = []
    if os.path.isdir(SKILLS_DIR):
        for n in sorted(os.listdir(SKILLS_DIR)):
            d = os.path.join(SKILLS_DIR, n)
            md = os.path.join(d, "SKILL.md")
            if not os.path.isdir(d) or not os.path.isfile(md):
                continue
            try:
                raw = io.open(md, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            name, desc = parse_front_matter(raw)
            files = []
            for root, _dirs, fs in os.walk(d):
                for f in fs:
                    rel = os.path.relpath(os.path.join(root, f), d)
                    files.append(rel)
            files.sort()
            out.append({
                "name": n,
                "title": name or n,
                "description": desc,
                "files": files[:80],
                "dir": d,
            })
    return {"skills": out, "count": len(out), "skillsDir": SKILLS_DIR,
            "hint": "先用 use_skill 读取技能指令，再通过 run_skill 执行其中的脚本处理目标文件。"}


def tool_use_skill(args):
    d = skill_dir(args.get("name"))
    md = os.path.join(d, "SKILL.md")
    if not os.path.isfile(md):
        raise ValueError("该技能缺少 SKILL.md")
    text = io.open(md, encoding="utf-8", errors="replace").read()
    files = []
    for root, _dirs, fs in os.walk(d):
        for f in fs:
            rel = os.path.relpath(os.path.join(root, f), d)
            if rel != "SKILL.md":
                files.append(rel)
    files.sort()
    return {"skill": args.get("name"), "dir": d, "SKILL.md": text,
            "otherFiles": files[:80],
            "hint": "运行脚本示例（在技能目录内执行）：run_skill command='python3 scripts/xxx.py --dir <待检目录>'"}


def tool_read_skill_file(args):
    d = skill_dir(args.get("name"))
    p = safe_join(d, args.get("path"))
    if not os.path.isfile(p):
        raise ValueError("文件不存在: " + str(args.get("path")))
    size = os.path.getsize(p)
    if size > 2 * 1024 * 1024:
        raise ValueError("文件过大（>2MB），请用 run_skill 例如 head/tail 查看")
    text = io.open(p, encoding="utf-8", errors="replace").read()
    return {"path": args.get("path"), "size": size, "content": text[:120000]}


def _run_capture(cwd, command, timeout):
    try:
        p = subprocess.run(command, shell=True, cwd=cwd,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        out = p.stdout.decode("utf-8", errors="replace")
        code = p.returncode
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", errors="replace") + \
              "\n[job] 命令超时（%d 秒），已终止" % timeout
        code = 124
    if len(out) > MAX_OUTPUT:
        out = out[:MAX_OUTPUT // 2] + "\n…[输出过长，已截断]…\n" + out[-MAX_OUTPUT // 2:]
    return code, out


def tool_run_skill(args):
    d = skill_dir(args.get("name"))
    command = str(args.get("command") or "").strip()
    if not command:
        raise ValueError("command 不能为空")
    timeout = min(int(args.get("timeout") or DEFAULT_TIMEOUT), MAX_TIMEOUT)
    code, out = _run_capture(d, command, timeout)
    return {"ok": code == 0, "code": code, "output": out, "cwd": d,
            "hint": "code=0 表示成功；失败时可读 output 排查（缺依赖先 pip3 install …）后重试"}


_JOBS = {}
_JOBS_LOCK = threading.Lock()
_JOB_SEQ = {"n": 0}


def tool_start_job(args):
    d = skill_dir(args.get("name"))
    command = str(args.get("command") or "").strip()
    if not command:
        raise ValueError("command 不能为空")
    timeout = min(int(args.get("timeout") or MAX_TIMEOUT), MAX_TIMEOUT)
    with _JOBS_LOCK:
        _JOB_SEQ["n"] += 1
        jid = "job-%d" % _JOB_SEQ["n"]
        _JOBS[jid] = {"state": "running", "output": "", "code": None,
                      "command": command, "cwd": d, "deadline": time.time() + timeout}
    def worker(jid=jid, d=d, command=command, timeout=timeout):
        code, out = _run_capture(d, command, timeout)
        with _JOBS_LOCK:
            j = _JOBS.get(jid)
            if j is not None:
                j["state"] = "done"
                j["code"] = code
                j["output"] = out
    threading.Thread(target=worker, daemon=True).start()
    return {"jobId": jid, "state": "running", "cwd": d,
            "hint": "用 job_status(jobId) 轮询；长任务建议间隔 10~30 秒查询一次"}


def tool_job_status(args):
    jid = str(args.get("jobId") or "")
    with _JOBS_LOCK:
        j = _JOBS.get(jid)
        if j is None:
            raise ValueError("未知任务: " + jid)
        return {"jobId": jid, "state": j["state"], "code": j["code"],
                "command": j["command"], "cwd": j["cwd"],
                "output": j["output"][-MAX_OUTPUT // 2:] if j["state"] == "done" else j["output"][-20000:]}


def tool_install_skill(args):
    src = os.path.expanduser(str(args.get("path") or "").strip())
    if not src or not os.path.exists(src):
        raise ValueError("路径不存在: " + str(args.get("path")))
    os.makedirs(SKILLS_DIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="sfmcp-")
    try:
        if os.path.isfile(src) and src.lower().endswith(".zip"):
            with zipfile.ZipFile(src) as zf:
                zf.extractall(tmp)
        elif os.path.isdir(src):
            shutil.copytree(src, os.path.join(tmp, "pkg"))
        else:
            raise ValueError("仅支持 .zip 文件或目录")
        # 定位含 SKILL.md 的目录（兼容“压缩包里套一层目录”的结构）
        pkg = None
        for root, _dirs, fs in os.walk(tmp):
            if "SKILL.md" in fs:
                pkg = root
                break
        if not pkg:
            raise ValueError("包内未找到 SKILL.md，不是有效的 Skill 包")
        default = ""
        try:
            default, _desc = parse_front_matter(io.open(os.path.join(pkg, "SKILL.md"), encoding="utf-8", errors="replace").read())
        except OSError:
            pass
        name = safe_name(args.get("name") or default or os.path.basename(pkg) or os.path.basename(src))
        dest = os.path.join(SKILLS_DIR, name)
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(pkg, dest)
        count = sum(len(fs) for _r, _d, fs in os.walk(dest))
        return {"ok": True, "name": name, "dir": dest, "files": count,
                "hint": "已可用 list_skills 查看，use_skill + run_skill 执行"}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


TOOLS = [
    {
        "name": "list_skills",
        "description": "列出本机已安装的所有 Skill 工坊技能（扫描 ~/.skill-forge/skills/）。调用任何技能前先执行本工具查看可用技能。",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "use_skill",
        "description": "读取某个技能的 SKILL.md 完整指令与文件清单。执行技能前必须先阅读其指令，再决定用什么命令、什么参数执行。",
        "inputSchema": {"type": "object",
                        "properties": {"name": {"type": "string", "description": "技能名（list_skills 返回的 name）"}},
                        "required": ["name"]},
    },
    {
        "name": "read_skill_file",
        "description": "读取技能包内的参考文件（references/、示例等），便于理解技能用法。",
        "inputSchema": {"type": "object",
                        "properties": {"name": {"type": "string"},
                                       "path": {"type": "string", "description": "技能内相对路径，如 references/guide.md"}},
                        "required": ["name", "path"]},
    },
    {
        "name": "run_skill",
        "description": "在技能目录下同步执行一条 shell 命令并返回完整输出（code=0 成功）。用于运行技能自带脚本处理目标文件，例如：python3 scripts/selfcheck.py --dir /path/to/target。同步等待，最长 timeout 秒；长任务改用 start_job。",
        "inputSchema": {"type": "object",
                        "properties": {"name": {"type": "string"},
                                       "command": {"type": "string"},
                                       "timeout": {"type": "number", "description": "秒，默认 300，最大 1800"}},
                        "required": ["name", "command"]},
    },
    {
        "name": "start_job",
        "description": "在技能目录下后台启动一条长命令，立即返回 jobId。适合超过 5 分钟的任务。用 job_status 轮询结果。",
        "inputSchema": {"type": "object",
                        "properties": {"name": {"type": "string"},
                                       "command": {"type": "string"},
                                       "timeout": {"type": "number", "description": "秒，默认/最大 1800"}},
                        "required": ["name", "command"]},
    },
    {
        "name": "job_status",
        "description": "查询 start_job 启动的后台任务状态：running / done，完成后返回退出码与完整输出。",
        "inputSchema": {"type": "object",
                        "properties": {"jobId": {"type": "string"}},
                        "required": ["jobId"]},
    },
    {
        "name": "install_skill",
        "description": "从本机路径安装 Skill 包（.zip 或目录，须含 SKILL.md）到技能目录，安装后立即可用。",
        "inputSchema": {"type": "object",
                        "properties": {"path": {"type": "string", "description": "本机绝对路径"},
                                       "name": {"type": "string", "description": "可选，安装名，默认取包目录名"}},
                        "required": ["path"]},
    },
]

HANDLERS = {
    "list_skills": tool_list_skills,
    "use_skill": tool_use_skill,
    "read_skill_file": tool_read_skill_file,
    "run_skill": tool_run_skill,
    "start_job": tool_start_job,
    "job_status": tool_job_status,
    "install_skill": tool_install_skill,
}


# ---------------- MCP 协议层（stdio, 换行分隔 JSON-RPC 2.0） ----------------

def reply(msg_id, result):
    write_msg({"jsonrpc": "2.0", "id": msg_id, "result": result})


def reply_err(msg_id, code, message):
    write_msg({"jsonrpc": "2.0", "id": msg_id,
               "error": {"code": code, "message": message}})


def write_msg(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(req):
    method = req.get("method", "")
    msg_id = req.get("id")
    params = req.get("params") or {}

    if method == "initialize":
        reply(msg_id, {
            "protocolVersion": params.get("protocolVersion") or "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "skill-forge", "version": VERSION},
        })
    elif method == "ping":
        reply(msg_id, {})
    elif method == "tools/list":
        reply(msg_id, {"tools": TOOLS})
    elif method == "tools/call":
        name = params.get("name", "")
        handler = HANDLERS.get(name)
        if not handler:
            reply_err(msg_id, -32602, "unknown tool: " + name)
            return
        try:
            result = handler(params.get("arguments") or {})
            reply(msg_id, {"content": [{"type": "text",
                                        "text": json.dumps(result, ensure_ascii=False)}],
                           "isError": False})
        except Exception as e:
            log("tool %s error: %s" % (name, e))
            reply(msg_id, {"content": [{"type": "text", "text": "错误: " + str(e)}],
                           "isError": True})
    elif method.startswith("notifications/"):
        pass                     # 通知无需回复
    else:
        if msg_id is not None:
            reply_err(msg_id, -32601, "method not found: " + method)


def main():
    os.makedirs(SKILLS_DIR, exist_ok=True)
    log("v%s 启动，技能目录: %s" % (VERSION, SKILLS_DIR))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError as e:
            log("忽略无法解析的消息: %s" % e)
            continue
        try:
            handle(req)
        except Exception as e:
            log("处理消息异常: %s" % e)
            if req.get("id") is not None:
                reply_err(req["id"], -32603, "internal error: " + str(e))
    log("stdin 关闭，退出")


if __name__ == "__main__":
    main()
