"""Розбір одного повідомлення від тексту до готового графіка."""

from dataclasses import dataclass
from datetime import date

from lightua_parser.domain.classify import (
    has_queue_schedule,
    is_emergency_outage_active,
    is_power_outage_schedule,
)
from lightua_parser.domain.dates import parse_date
from lightua_parser.domain.schedule import Schedule, parse_schedule


@dataclass(frozen=True, slots=True)
class ParsedMessage:
    schedule_date: date
    schedule: Schedule
    emergency_outages: bool


def parse_message(text: str, today: date) -> ParsedMessage | None:
    """None, якщо це не графік або в ньому нема дати чи жодної черги."""
    if not is_power_outage_schedule(text) and not has_queue_schedule(text):
        return None
    schedule_date = parse_date(text, today)
    if schedule_date is None:
        return None
    schedule = parse_schedule(text)
    if not schedule:
        return None
    return ParsedMessage(schedule_date, schedule, is_emergency_outage_active(text))
