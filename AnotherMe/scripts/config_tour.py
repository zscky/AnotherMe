#!/usr/bin/env python
"""AnotherMe configuration tour.

This script keeps runtime configuration in the intended places:

- .env.local: Next.js app settings and user fallback provider values.
- anotherme2_engine/api_gateway/.env: Python gateway/worker settings.
- server-providers.yml: server-owned provider credentials, preferred at runtime.

It intentionally writes provider credentials to server-providers.yml first so
browser/user-supplied provider settings remain fallback-only.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse


APP_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = APP_ROOT.parent
APP_ENV = APP_ROOT / ".env.local"
APP_ENV_EXAMPLE = APP_ROOT / ".env.example"
GATEWAY_ENV = APP_ROOT / "anotherme2_engine" / "api_gateway" / ".env"
GATEWAY_ENV_EXAMPLE = APP_ROOT / "anotherme2_engine" / "api_gateway" / ".env.example"
SERVER_PROVIDERS = APP_ROOT / "server-providers.yml"


LLM_ENV_MAP = {
    "OPENAI": "openai",
    "ANTHROPIC": "anthropic",
    "GOOGLE": "google",
    "DEEPSEEK": "deepseek",
    "QWEN": "qwen",
    "KIMI": "kimi",
    "MINIMAX": "minimax",
    "GLM": "glm",
    "SILICONFLOW": "siliconflow",
    "DOUBAO": "doubao",
    "GROK": "grok",
}

PROVIDER_ENV_MAPS = {
    "providers": LLM_ENV_MAP,
    "tts": {
        "TTS_OPENAI": "openai-tts",
        "TTS_AZURE": "azure-tts",
        "TTS_GLM": "glm-tts",
        "TTS_QWEN": "qwen-tts",
        "TTS_ELEVENLABS": "elevenlabs-tts",
        "TTS_MINIMAX": "minimax-tts",
    },
    "asr": {
        "ASR_OPENAI": "openai-whisper",
        "ASR_QWEN": "qwen-asr",
    },
    "pdf": {
        "PDF_UNPDF": "unpdf",
        "PDF_MINERU": "mineru",
    },
    "image": {
        "IMAGE_SEEDREAM": "seedream",
        "IMAGE_QWEN_IMAGE": "qwen-image",
        "IMAGE_NANO_BANANA": "nano-banana",
        "IMAGE_MINIMAX": "minimax-image",
        "IMAGE_GROK": "grok-image",
        "IMAGE_LIBLIB": "liblib-image",
    },
    "video": {
        "VIDEO_SEEDANCE": "seedance",
        "VIDEO_KLING": "kling",
        "VIDEO_VEO": "veo",
        "VIDEO_SORA": "sora",
        "VIDEO_MINIMAX": "minimax-video",
        "VIDEO_GROK": "grok-video",
    },
    "web-search": {
        "TAVILY": "tavily",
    },
}

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-sonnet-latest",
    "google": "gemini-2.5-flash",
    "deepseek": "deepseek-chat",
    "qwen": "qwen-max",
    "kimi": "moonshot-v1-8k",
    "minimax": "MiniMax-M2.7",
    "glm": "glm-4.5",
    "siliconflow": "Qwen/Qwen2.5-72B-Instruct",
    "doubao": "doubao-1-5-pro-32k-250115",
    "grok": "grok-4",
}


def color(text: str, code: str) -> str:
    if os.environ.get("NO_COLOR"):
        return text
    return f"\033[{code}m{text}\033[0m"


def ok(message: str) -> None:
    print(color(f"[OK] {message}", "32"))


def warn(message: str) -> None:
    print(color(f"[WARN] {message}", "33"))


def fail(message: str) -> None:
    print(color(f"[FAIL] {message}", "31"))


def info(message: str) -> None:
    print(color(f"[INFO] {message}", "36"))


def mask(value: str | None) -> str:
    if not value:
        return "-"
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}...{value[-4:]}"


def quote_yaml(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def run_version(cmd: list[str]) -> str | None:
    executable = shutil.which(cmd[0])
    if executable:
        cmd = [executable, *cmd[1:]]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=8, shell=False)
    except Exception:
        return None
    if result.returncode != 0:
        return None
    return (result.stdout or result.stderr).strip().splitlines()[0]


def read_env(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            result[key] = value
    return result


def write_env_updates(path: Path, updates: dict[str, str]) -> None:
    existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    seen: set[str] = set()
    output: list[str] = []
    for line in existing_lines:
        match = re.match(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$", line)
        if match and match.group(2) in updates:
            key = match.group(2)
            output.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            output.append(line)
    missing = [key for key in updates if key not in seen]
    if missing and output and output[-1].strip():
        output.append("")
    for key in missing:
        output.append(f"{key}={updates[key]}")
    path.write_text("\n".join(output) + "\n", encoding="utf-8")


def ensure_file(path: Path, template: Path, dry_run: bool = False) -> bool:
    if path.exists():
        return False
    if dry_run:
        return True
    if template.exists():
        path.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
    else:
        path.write_text("", encoding="utf-8")
    return True


def valid_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    return parsed.scheme in {"http", "https", "ws", "wss", "redis", "postgresql+psycopg", "sqlite"} and bool(
        parsed.netloc or parsed.scheme == "sqlite"
    )


def prompt(label: str, default: str = "", secret: bool = False) -> str:
    suffix = f" [{mask(default) if secret else default}]" if default else ""
    value = input(f"{label}{suffix}: ").strip()
    return value or default


def confirm(label: str, default: bool = True) -> bool:
    suffix = "Y/n" if default else "y/N"
    value = input(f"{label} [{suffix}]: ").strip().lower()
    if not value:
        return default
    return value in {"y", "yes", "1", "true", "是", "好"}


def choose_provider(default: str = "openai") -> str:
    providers = list(LLM_ENV_MAP.values())
    print("可选 LLM provider:")
    for index, provider in enumerate(providers, start=1):
        marker = " *" if provider == default else ""
        print(f"  {index}. {provider}{marker}")
    raw = input(f"选择 provider [默认 {default}]: ").strip()
    if not raw:
        return default
    if raw.isdigit() and 1 <= int(raw) <= len(providers):
        return providers[int(raw) - 1]
    if raw in providers:
        return raw
    warn(f"未知 provider: {raw}，使用 {default}")
    return default


def provider_prefix(provider_id: str) -> str | None:
    for prefix, mapped in LLM_ENV_MAP.items():
        if mapped == provider_id:
            return prefix
    return None


def parse_default_model(value: str) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    separator = ":" if ":" in value else "/"
    if separator not in value:
        return None, value
    provider, model = value.split(separator, 1)
    return provider.strip() or None, model.strip() or None


def collect_provider_config(env: dict[str, str]) -> dict[str, dict[str, dict[str, object]]]:
    config: dict[str, dict[str, dict[str, object]]] = {}
    for section, mapping in PROVIDER_ENV_MAPS.items():
        section_entries: dict[str, dict[str, object]] = {}
        for prefix, provider_id in mapping.items():
            api_key = env.get(f"{prefix}_API_KEY", "").strip()
            base_url = env.get(f"{prefix}_BASE_URL", "").strip()
            models = [
                item.strip()
                for item in env.get(f"{prefix}_MODELS", "").split(",")
                if item.strip()
            ]
            is_base_url_only = section == "pdf" and provider_id == "mineru"
            if not api_key and not (is_base_url_only and base_url):
                continue
            entry: dict[str, object] = {"apiKey": api_key}
            if base_url:
                entry["baseUrl"] = base_url
            if models:
                entry["models"] = models
            section_entries[provider_id] = entry
        if section_entries:
            config[section] = section_entries
    return config


def write_server_providers(config: dict[str, dict[str, dict[str, object]]]) -> None:
    lines = [
        "# Server-owned provider credentials.",
        "# Runtime priority: server-providers.yml > .env.local > user request values.",
        "# This file is ignored by git because it may contain API keys.",
        "",
    ]
    for section, entries in config.items():
        lines.append(f"{section}:")
        for provider_id, entry in entries.items():
            lines.append(f"  {provider_id}:")
            api_key = str(entry.get("apiKey", ""))
            lines.append(f"    apiKey: {quote_yaml(api_key)}")
            if entry.get("baseUrl"):
                lines.append(f"    baseUrl: {quote_yaml(str(entry['baseUrl']))}")
            models = entry.get("models")
            if isinstance(models, list) and models:
                lines.append("    models:")
                for model in models:
                    lines.append(f"      - {quote_yaml(str(model))}")
        lines.append("")
    SERVER_PROVIDERS.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def parse_server_provider_summary() -> dict[str, set[str]]:
    summary: dict[str, set[str]] = {}
    if not SERVER_PROVIDERS.exists():
        return summary
    current_section: str | None = None
    for raw in SERVER_PROVIDERS.read_text(encoding="utf-8-sig").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        section = re.match(r"^([A-Za-z_-][A-Za-z0-9_-]*):\s*$", raw)
        if section:
            current_section = section.group(1)
            summary.setdefault(current_section, set())
            continue
        provider = re.match(r"^\s{2}([A-Za-z0-9_.-]+):\s*$", raw)
        if provider and current_section:
            summary.setdefault(current_section, set()).add(provider.group(1))
    return summary


def detect_default_provider(app_env: dict[str, str]) -> str:
    provider, _ = parse_default_model(app_env.get("DEFAULT_MODEL", ""))
    if provider:
        return provider
    for prefix, provider_id in LLM_ENV_MAP.items():
        if app_env.get(f"{prefix}_API_KEY"):
            return provider_id
    return "openai"


def configure_interactive() -> None:
    print(color("\nAnotherMe 配置向导", "1;36"))
    print("目标优先级: server-providers.yml > .env.local > 用户请求中的配置\n")

    created_app = ensure_file(APP_ENV, APP_ENV_EXAMPLE)
    created_gateway = ensure_file(GATEWAY_ENV, GATEWAY_ENV_EXAMPLE)
    if created_app:
        ok(f"已创建 {APP_ENV.relative_to(APP_ROOT)}")
    if created_gateway:
        ok(f"已创建 {GATEWAY_ENV.relative_to(APP_ROOT)}")

    app_env = read_env(APP_ENV)
    gateway_env = read_env(GATEWAY_ENV)

    gateway_url = prompt(
        "AnotherMe2 gateway URL",
        app_env.get("ANOTHERME2_GATEWAY_BASE_URL") or "http://127.0.0.1:8080",
    )
    if not valid_url(gateway_url):
        fail("Gateway URL 格式无效，请使用 http://127.0.0.1:8080 这类地址。")
        raise SystemExit(1)

    gateway_token = gateway_env.get("GATEWAY_API_TOKEN", "")
    app_token = app_env.get("ANOTHERME2_GATEWAY_TOKEN", "")
    token = prompt("Gateway token，可留空", gateway_token or app_token, secret=True)

    app_updates = {"ANOTHERME2_GATEWAY_BASE_URL": gateway_url, "ANOTHERME2_GATEWAY_TOKEN": token}
    gateway_updates = {
        "GATEWAY_API_TOKEN": token,
        "ANOTHERME_BASE_URL": gateway_env.get("ANOTHERME_BASE_URL") or "http://localhost:3000",
    }

    server_summary = parse_server_provider_summary()
    if SERVER_PROVIDERS.exists():
        ok(f"检测到服务器配置 {SERVER_PROVIDERS.name}: {server_summary}")
    else:
        env_config = collect_provider_config(app_env)
        if env_config and confirm("检测到 .env.local 中已有 provider key，是否提升为 server-providers.yml？", True):
            write_server_providers(env_config)
            ok("已根据 .env.local 生成 server-providers.yml")
        else:
            default_provider = detect_default_provider(app_env)
            provider = choose_provider(default_provider)
            prefix = provider_prefix(provider)
            model = prompt("默认模型", DEFAULT_MODELS.get(provider, "gpt-4o-mini"))
            api_key_default = app_env.get(f"{prefix}_API_KEY", "") if prefix else ""
            api_key = prompt("服务器 API key", api_key_default, secret=True)
            if not api_key:
                fail("至少需要一个服务器侧 LLM API key。")
                raise SystemExit(1)
            base_url = prompt("Base URL，可留空", app_env.get(f"{prefix}_BASE_URL", "") if prefix else "")
            config = {"providers": {provider: {"apiKey": api_key, "models": [model]}}}
            if base_url:
                config["providers"][provider]["baseUrl"] = base_url
            tavily = prompt("Tavily API key，可留空", app_env.get("TAVILY_API_KEY", ""), secret=True)
            if tavily:
                config["web-search"] = {"tavily": {"apiKey": tavily}}
            write_server_providers(config)
            app_updates["DEFAULT_MODEL"] = f"{provider}:{model}"
            ok("已写入 server-providers.yml")

    write_env_updates(APP_ENV, app_updates)
    write_env_updates(GATEWAY_ENV, gateway_updates)
    ok("已同步 Web 与 gateway 环境变量")

    errors = validate_all()
    if errors:
        fail("配置仍有问题：")
        for error in errors:
            print(f"  - {error}")
        raise SystemExit(1)

    ok("配置校验通过")
    print("\n下一步：")
    print("  cd AnotherMe")
    print("  pnpm install")
    print("  pnpm dev:all")


def validate_all() -> list[str]:
    errors: list[str] = []
    app_env = read_env(APP_ENV)
    gateway_env = read_env(GATEWAY_ENV)
    server_summary = parse_server_provider_summary()

    if not APP_ENV.exists():
        errors.append("缺少 AnotherMe/.env.local")
    if not GATEWAY_ENV.exists():
        errors.append("缺少 anotherme2_engine/api_gateway/.env")

    gateway_url = app_env.get("ANOTHERME2_GATEWAY_BASE_URL", "")
    if not gateway_url or not valid_url(gateway_url):
        errors.append("ANOTHERME2_GATEWAY_BASE_URL 缺失或格式无效")

    gateway_token = gateway_env.get("GATEWAY_API_TOKEN", "")
    app_token = app_env.get("ANOTHERME2_GATEWAY_TOKEN", "")
    if gateway_token and gateway_token != app_token:
        errors.append("GATEWAY_API_TOKEN 与 ANOTHERME2_GATEWAY_TOKEN 不一致")

    if not gateway_env.get("ANOTHERME_BASE_URL"):
        errors.append("gateway .env 缺少 ANOTHERME_BASE_URL")
    if not gateway_env.get("GATEWAY_DATABASE_URL"):
        errors.append("gateway .env 缺少 GATEWAY_DATABASE_URL")
    if not gateway_env.get("GATEWAY_REDIS_URL"):
        errors.append("gateway .env 缺少 GATEWAY_REDIS_URL")

    server_llm = server_summary.get("providers", set())
    env_llm = {
        provider_id
        for prefix, provider_id in LLM_ENV_MAP.items()
        if app_env.get(f"{prefix}_API_KEY")
    }
    if not server_llm and not env_llm:
        errors.append("没有可用的 LLM provider；优先配置 server-providers.yml")

    default_provider, _ = parse_default_model(app_env.get("DEFAULT_MODEL", ""))
    if default_provider and default_provider not in server_llm and default_provider not in env_llm:
        errors.append(f"DEFAULT_MODEL 指向 {default_provider}，但该 provider 没有服务器或 env key")

    return errors


def print_status() -> None:
    print(color("\nAnotherMe 配置状态", "1;36"))
    print(f"App env:      {APP_ENV} {'yes' if APP_ENV.exists() else 'missing'}")
    print(f"Gateway env:  {GATEWAY_ENV} {'yes' if GATEWAY_ENV.exists() else 'missing'}")
    print(f"Server YAML:  {SERVER_PROVIDERS} {'yes' if SERVER_PROVIDERS.exists() else 'missing'}")

    app_env = read_env(APP_ENV)
    gateway_env = read_env(GATEWAY_ENV)
    summary = parse_server_provider_summary()
    print(f"Gateway URL:  {app_env.get('ANOTHERME2_GATEWAY_BASE_URL') or '-'}")
    print(f"Gateway token match: {'yes' if app_env.get('ANOTHERME2_GATEWAY_TOKEN', '') == gateway_env.get('GATEWAY_API_TOKEN', '') else 'no'}")
    print(f"Server providers: {', '.join(sorted(summary.get('providers', []))) or '-'}")
    print(f"Server web search: {', '.join(sorted(summary.get('web-search', []))) or '-'}")

    versions = {
        "node": run_version(["node", "--version"]),
        "pnpm": run_version(["pnpm", "--version"]),
        "python": run_version([sys.executable, "--version"]),
        "uv": run_version(["uv", "--version"]) if shutil.which("uv") else None,
    }
    print("Tools:")
    for name, value in versions.items():
        print(f"  {name}: {value or 'missing'}")
    if sys.version_info < (3, 10):
        warn("Python 3.10+ is recommended for deployment; Python 3.11 matches the Docker runtime.")

    errors = validate_all()
    if errors:
        print()
        for error in errors:
            fail(error)
        raise SystemExit(1)
    print()
    ok("配置校验通过")


def main() -> None:
    parser = argparse.ArgumentParser(description="AnotherMe configuration tour")
    parser.add_argument("--check", action="store_true", help="validate current configuration without writing files")
    parser.add_argument("--init-only", action="store_true", help="only create missing env files from examples")
    args = parser.parse_args()

    os.chdir(APP_ROOT)

    if args.init_only:
        created = [
            ensure_file(APP_ENV, APP_ENV_EXAMPLE),
            ensure_file(GATEWAY_ENV, GATEWAY_ENV_EXAMPLE),
        ]
        ok("env 文件已准备好" if any(created) else "env 文件已存在")
        return

    if args.check:
        print_status()
        return

    try:
        configure_interactive()
    except KeyboardInterrupt:
        print()
        warn("配置已中断")
        raise SystemExit(130)


if __name__ == "__main__":
    main()
