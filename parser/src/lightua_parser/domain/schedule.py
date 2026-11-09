"""Розбір черг і часових інтервалів із тексту поста."""

import re

from lightua_parser.domain.text import normalize_dashes

Schedule = dict[str, list[str]]

_TIME_SEPARATOR = re.compile(r"([0-9]{1,2})\s*[.:]\s*([0-9]{2})")
_EMOJI = re.compile("[\U0001f000-\U0001ffff\u2300-\u27bf\u2b00-\u2bff]")
_LEADING_BULLETS = re.compile(r"^[\s\-*•●○■▪∙⁃‣▫·□➖]+")
_QUEUE_HEADER = re.compile(r"(?:черга|група)\s*\[?\s*([0-6](?:\.[12])?)\s*\]?", re.IGNORECASE)
_LABEL_SEPARATOR = re.compile(r"^[\s:]+")
_GRAPH_LINE = re.compile(r"графік\s*:?\s*(.*)$", re.IGNORECASE)
_QUEUE_LINE = re.compile(r"^([0-6](?:\.[12])?)\s*[:–\-]?\s*([0-9]{1,2}(?::[0-9]{2})?.*)$")
_FULL_PERIOD = re.compile(r"([0-9]{1,2})\s*:\s*([0-9]{2})\s*-\s*([0-9]{1,2})\s*:\s*([0-9]{2})")
_HOUR_PERIOD = re.compile(r"([0-9]{1,2})\s*-\s*([0-9]{1,2})")
_FULL_PERIOD_TEXT = re.compile(r"[0-9]{1,2}\s*:\s*[0-9]{2}\s*-\s*[0-9]{1,2}\s*:\s*[0-9]{2}")
_INLINE_QUEUE = re.compile(
    r"([0-6](?:\.[12])?)\s*[:\-]?\s*"
    r"((?:[0-9]{1,2}[.:][0-9]{2}\s*-\s*[0-9]{1,2}[.:][0-9]{2})"
    r"(?:\s*[,;]\s*[0-9]{1,2}[.:][0-9]{2}\s*-\s*[0-9]{1,2}[.:][0-9]{2})*)"
)


def _parse_period(period: str) -> str | None:
    full = _FULL_PERIOD.search(period)
    if full:
        start_h, start_m, end_h, end_m = map(int, full.groups())
        return f"{start_h:02d}:{start_m:02d}-{end_h:02d}:{end_m:02d}"
    hours = _HOUR_PERIOD.search(period)
    if hours:
        start_h, end_h = map(int, hours.groups())
        return f"{start_h:02d}:00-{end_h:02d}:00"
    return None


def _valid_periods(parts: list[str]) -> list[str]:
    return [parsed for parsed in map(_parse_period, parts) if parsed is not None]


def _split_parts(times: str) -> list[str]:
    return [part.strip() for part in re.split(r"[;,]", times) if part.strip()]


def _parse_periods(times: str) -> list[str]:
    full_periods = _FULL_PERIOD_TEXT.findall(times)
    return _valid_periods(full_periods or _split_parts(times))


def _clean_line(raw_line: str) -> str:
    line = _EMOJI.sub("", raw_line.strip()).strip()
    return _LEADING_BULLETS.sub("", line).strip()


def _parse_lines(lines: list[str]) -> Schedule:
    schedule: Schedule = {}
    current_queue: str | None = None

    for raw_line in lines:
        line = _clean_line(raw_line)
        if not line:
            continue

        header = _QUEUE_HEADER.search(line)
        if header:
            current_queue = header[1]
            after_label = _LABEL_SEPARATOR.sub("", line[header.end() :]).strip()
            if after_label:
                periods = _parse_periods(after_label)
                if periods:
                    schedule[current_queue] = periods
                    current_queue = None
            continue

        graph = _GRAPH_LINE.search(line)
        if graph and current_queue:
            periods = _parse_periods(graph[1])
            if periods:
                schedule[current_queue] = periods
            continue

        if current_queue:
            periods = _parse_periods(line)
            if periods:
                schedule[current_queue] = periods
                current_queue = None
                continue

        queue_line = _QUEUE_LINE.match(line)
        if queue_line:
            periods = _valid_periods(_split_parts(queue_line[2].strip()))
            if periods:
                schedule[queue_line[1]] = periods

    return schedule


def parse_schedule(text: str) -> Schedule:
    """Повертає {черга: [«HH:MM-HH:MM», ...]}; порожній словник, якщо черг нема."""
    content = _TIME_SEPARATOR.sub(r"\1:\2", normalize_dashes(text))
    schedule = _parse_lines(content.split("\n"))
    if schedule:
        return schedule

    # Запасний варіант: кілька черг в одному рядку.
    for match in _INLINE_QUEUE.finditer(content):
        periods = _parse_periods(match[2].strip())
        if periods:
            schedule[match[1]] = periods
    return schedule
