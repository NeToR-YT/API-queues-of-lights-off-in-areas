"""Об'єднання інтервалів відключень, зокрема через північ."""

_MINUTES_IN_DAY = 24 * 60


def _to_minutes(value: str) -> int | None:
    hours, separator, minutes = value.partition(":")
    if not separator or not hours.strip().isdigit() or not minutes.strip().isdigit():
        return None
    return int(hours) * 60 + int(minutes)


def _to_span(period: str) -> tuple[int, int] | None:
    parts = period.split("-")
    if len(parts) != 2:
        return None
    start = _to_minutes(parts[0])
    end = _to_minutes(parts[1])
    if start is None or end is None:
        return None
    return start, end + _MINUTES_IN_DAY if end <= start else end


def _to_period(start: int, end: int) -> str:
    end %= _MINUTES_IN_DAY
    return f"{start // 60:02d}:{start % 60:02d}-{end // 60:02d}:{end % 60:02d}"


def merge_intervals(periods: list[str]) -> list[str]:
    """Сортує інтервали «HH:MM-HH:MM» і зливає ті, що перетинаються або стикуються."""
    spans = sorted(span for span in map(_to_span, periods) if span is not None)
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return [_to_period(start, end) for start, end in merged]
