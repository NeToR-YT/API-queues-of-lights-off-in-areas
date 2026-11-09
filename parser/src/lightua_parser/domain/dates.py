"""Дата графіка з тексту поста."""

import re
from datetime import date

_MONTHS = {
    "січня": 1,
    "лютого": 2,
    "березня": 3,
    "квітня": 4,
    "травня": 5,
    "червня": 6,
    "липня": 7,
    "серпня": 8,
    "вересня": 9,
    "жовтня": 10,
    "листопада": 11,
    "грудня": 12,
}

_WORD_DATE = re.compile(r"([0-9]{1,2})\s+([^\W\d_]+)")
_NUMERIC_DATE = re.compile(
    r"(?<![0-9])([0-9]{1,2})[./]([0-9]{1,2})(?:[./]([0-9]{2,4}))?\s*(?!\s*:)"
)


def _valid_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date(text: str, today: date) -> date | None:
    """Шукає «19 серпня» або «19.08[.2026]»; рік без явного значення береться з today.

    Перевіряється лише перший збіг кожного формату: поведінка навмисно збігається
    зі старим парсером, еталон — golden-корпус.
    """
    word_match = _WORD_DATE.search(text)
    if word_match:
        month = _MONTHS.get(word_match[2].lower())
        if month:
            parsed = _valid_date(today.year, month, int(word_match[1]))
            if parsed:
                return parsed

    numeric_match = _NUMERIC_DATE.search(text)
    if numeric_match:
        year = int(numeric_match[3]) if numeric_match[3] else today.year
        if year < 100:
            year += 2000
        return _valid_date(year, int(numeric_match[2]), int(numeric_match[1]))

    return None
