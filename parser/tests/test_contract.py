"""Схеми контракту валідні й розрізняють правильні та зіпсовані документи."""

import copy
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

CONTRACTS = Path(__file__).parents[2] / "docs" / "contracts"

SCHEDULE: dict[str, Any] = {
    "schema_version": 2,
    "channel_id": 1,
    "schedule_date": "2026-08-19",
    "queues": {"1.1": ["22:00-02:00", "08:00-10:00"], "3": ["22:00-24:00"]},
    "emergency_outages": False,
    "source": {"message_id": 123, "published_at": "2026-08-18T19:00:00Z"},
    "parsed_at": "2026-08-18T19:15:00Z",
}


def schema(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(
        (CONTRACTS / f"{name}.v2.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.Draft202012Validator.check_schema(loaded)
    return loaded


def is_valid(name: str, document: dict[str, Any]) -> bool:
    return jsonschema.Draft202012Validator(schema(name)).is_valid(document)


def test_valid_documents_pass() -> None:
    assert is_valid("schedule", SCHEDULE)
    assert is_valid(
        "parse_state",
        {
            "schema_version": 2,
            "channel_id": 1,
            "last_message_id": 0,
            "updated_at": "2026-08-18T19:15:00Z",
        },
    )
    assert is_valid(
        "heartbeat",
        {
            "schema_version": 2,
            "finished_at": "2026-08-18T19:15:00Z",
            "status": "partial",
            "channels_ok": 22,
            "channels_failed": 1,
        },
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", 1),
        ("queues", {}),
        ("queues", {"7.1": ["08:00-10:00"]}),
        ("queues", {"1.1": []}),
        ("queues", {"1.1": ["08:00-99:00"]}),
        ("schedule_date", "19.08.2026"),
        ("parsed_at", "2026-08-18 19:15"),
    ],
)
def test_broken_schedule_is_rejected(field: str, value: object) -> None:
    broken = copy.deepcopy(SCHEDULE)
    broken[field] = value
    assert not is_valid("schedule", broken)
