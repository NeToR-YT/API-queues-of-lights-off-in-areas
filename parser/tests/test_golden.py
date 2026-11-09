"""Python-домен має відтворювати результат старого парсера на golden-корпусі."""

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from lightua_parser.domain.classify import (
    has_queue_schedule,
    is_emergency_outage_active,
    is_power_outage_schedule,
)
from lightua_parser.domain.dates import parse_date
from lightua_parser.domain.schedule import parse_schedule

GOLDEN = Path(__file__).parent / "golden"


def load_cases() -> list[tuple[str, date, str, dict[str, Any]]]:
    cases = []
    for raw_path in sorted((GOLDEN / "raw").glob("*.jsonl")):
        expected_file = json.loads(
            (GOLDEN / "expected" / f"{raw_path.stem}.json").read_text(encoding="utf-8")
        )
        reference_date = date.fromisoformat(expected_file["reference_date"])
        expected_by_id = {case["message_id"]: case for case in expected_file["cases"]}
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            message = json.loads(line)
            case_id = f"{raw_path.stem}:{message['message_id']}"
            cases.append(
                (case_id, reference_date, message["text"], expected_by_id[message["message_id"]])
            )
    return cases


CASES = load_cases()


@pytest.mark.parametrize(
    ("reference_date", "text", "expected"),
    [case[1:] for case in CASES],
    ids=[case[0] for case in CASES],
)
def test_matches_old_parser(reference_date: date, text: str, expected: dict[str, Any]) -> None:
    is_schedule = is_power_outage_schedule(text)
    has_queues = has_queue_schedule(text)
    parsed_date = parse_date(text, reference_date)

    assert is_schedule == expected["is_power_outage_schedule"]
    assert has_queues == expected["has_queue_schedule"]
    assert is_emergency_outage_active(text) == expected["emergency_outages"]
    assert (parsed_date.isoformat() if parsed_date else None) == expected["schedule_date"]
    assert (parse_schedule(text) if is_schedule or has_queues else {}) == expected["schedule"]
