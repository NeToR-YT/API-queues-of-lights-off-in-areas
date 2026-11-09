"""Домен не має залежати від зовнішнього світу (див. parser/README.md)."""

import ast
from pathlib import Path

import lightua_parser.domain

FORBIDDEN = ("telethon", "pymongo", "lightua_parser.adapters")
DOMAIN_DIR = Path(lightua_parser.domain.__file__).parent


def imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def test_domain_does_not_import_adapters() -> None:
    violations = [
        f"{path.name}: {module}"
        for path in DOMAIN_DIR.glob("*.py")
        for module in imported_modules(path)
        if module.startswith(FORBIDDEN)
    ]
    assert violations == []
