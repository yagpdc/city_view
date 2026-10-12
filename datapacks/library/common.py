"""Formato comum dos índices da biblioteca (ver docs/LIBRARY.md) e coleta educada.

Regras de coleta (valem para toda fonte):
- só APIs oficiais e documentadas, e só metadados para o índice;
- consulta o robots.txt do host antes e recusa caminhos proibidos;
- respeita o Crawl-delay pedido; sem pedido, no máximo POLITE_WORKERS consultas
  simultâneas com pausa entre elas;
- bloqueio (403/429/página HTML no lugar de JSON) = parar, não insistir;
- identifica o cliente (User-Agent com o endereço do projeto);
- cache local: atualizar o índice não repete o que já foi buscado.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import threading
import time
import urllib.error
import urllib.request
import urllib.robotparser
from pathlib import Path
from urllib.parse import urlsplit

LIBRARY = Path(__file__).resolve().parent
CACHE = LIBRARY.parent.parent / "data" / "cache" / "library"
SCHEMA = 1
GZIP_MAGIC = bytes([0x1F, 0x8B])
USER_AGENT = "city_view-library/0.1 (+https://github.com/yagpdc/city_view)"
# Teto de consultas simultâneas por fonte quando o host não pede intervalo.
POLITE_WORKERS = 4
# Pausa mínima entre consultas ao mesmo host quando ele não declara Crawl-delay.
DEFAULT_INTERVAL = 0.15

# Bits de capacidade de cada item.
MUNICIPAL = 1
REGIONAL = 2
DOWNLOAD = 4


class Blocked(RuntimeError):
    """A fonte recusou ou sinalizou bloqueio: pare e revise antes de tentar de novo."""


class _Host:
    def __init__(self, base: str) -> None:
        self.robots = urllib.robotparser.RobotFileParser(f"{base}/robots.txt")
        try:
            req = urllib.request.Request(f"{base}/robots.txt", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                self.robots.parse(resp.read().decode("utf-8", "replace").splitlines())
        except Exception:
            self.robots.parse([])  # sem robots.txt (ou inacessível): nada proibido
        delay = self.robots.crawl_delay(USER_AGENT)
        self.interval = float(delay) if delay else DEFAULT_INTERVAL
        self.lock = threading.Lock()
        self.last = 0.0

    def wait_turn(self) -> None:
        with self.lock:
            pause = self.last + self.interval - time.monotonic()
            if pause > 0:
                time.sleep(pause)
            self.last = time.monotonic()


_hosts: dict[str, _Host] = {}
_hosts_lock = threading.Lock()


def _host(url: str) -> _Host:
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    with _hosts_lock:
        if base not in _hosts:
            _hosts[base] = _Host(base)
        return _hosts[base]


def get_json(url: str, retries: int = 3, timeout: int = 90):
    """JSON de uma API pública, respeitando robots.txt, intervalo e sinais de bloqueio."""
    host = _host(url)
    if not host.robots.can_fetch(USER_AGENT, url):
        raise Blocked(f"o robots.txt de {urlsplit(url).netloc} não permite acesso automatizado a {urlsplit(url).path}")
    for attempt in range(retries):
        host.wait_turn()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                kind = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 429):
                raise Blocked(f"{urlsplit(url).netloc} respondeu {e.code}: parando") from e
            if attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        else:
            body = gzip.decompress(data) if data[:2] == GZIP_MAGIC else data
            if "html" in kind.lower() and body.lstrip()[:1] == b"<":
                raise Blocked(f"{urlsplit(url).netloc} devolveu uma página HTML no lugar dos dados (bloqueio?): parando")
            return json.loads(body)
        time.sleep(2 * (attempt + 1))  # falha de rede: espera e tenta de novo, poucas vezes


def year(value) -> int | None:
    """Ano a partir de 2022, '2022-01-01…', 202212 (mês) ou 20231 (trimestre)."""
    if value in (None, ""):
        return None
    if isinstance(value, str):
        digits = value[:4]
        return int(digits) if digits.isdigit() else None
    v = int(value)
    while v > 9999:
        v //= 10
    return v


class Interner:
    def __init__(self) -> None:
        self.values: list = []
        self.index: dict = {}

    def __call__(self, key, value=None) -> int:
        if key in (None, ""):
            return -1
        if key not in self.index:
            self.index[key] = len(self.values)
            self.values.append(value if value is not None else key)
        return self.index[key]


def write_source(source: dict, groups: list[dict], subjects: list[str], items: list[list]) -> Path:
    """Grava <id>.json e atualiza o index.json com o resumo da fonte."""
    source = {**source, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    out = LIBRARY / f"{source['id']}.json"
    out.write_text(
        json.dumps({"schema": SCHEMA, "source": source, "groups": groups, "subjects": subjects, "items": items}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    index_path = LIBRARY / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"schema": SCHEMA, "sources": []}
    summary = {
        **{k: source[k] for k in ("id", "name", "publisher", "country", "description", "homepage", "license", "adapter", "updatedAt")},
        "items": len(items),
        "municipal": sum(1 for it in items if it[6] & MUNICIPAL),
        "bytes": out.stat().st_size,
    }
    index["sources"] = sorted([s for s in index["sources"] if s["id"] != source["id"]] + [summary], key=lambda s: s["name"])
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[library] {source['id']}: {len(items)} itens ({summary['municipal']} por município) -> {out.name} ({summary['bytes'] / 1e3:.0f} KB)")
    return out
