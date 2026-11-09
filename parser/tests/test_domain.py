"""Властивості домену, які golden-корпус не покриває."""

from datetime import date

from hypothesis import given
from hypothesis import strategies as st

from lightua_parser.domain.intervals import merge_intervals
from lightua_parser.domain.message import ParsedMessage, parse_message

TODAY = date(2026, 8, 1)

period = st.builds(
    lambda start_h, start_m, end_h, end_m: f"{start_h:02d}:{start_m:02d}-{end_h:02d}:{end_m:02d}",
    st.integers(0, 23),
    st.integers(0, 59),
    st.integers(0, 23),
    st.integers(0, 59),
)


def test_merge_joins_touching_and_overlapping() -> None:
    assert merge_intervals(["10:00-12:00", "08:00-10:00", "11:00-13:00"]) == ["08:00-13:00"]


def test_merge_keeps_interval_over_midnight() -> None:
    assert merge_intervals(["22:00-02:00"]) == ["22:00-02:00"]


def test_merge_skips_malformed_periods() -> None:
    assert merge_intervals(["не час", "08:00", "08:00-10:00"]) == ["08:00-10:00"]


@given(st.lists(period))
def test_merge_is_idempotent(periods: list[str]) -> None:
    merged = merge_intervals(periods)
    assert merge_intervals(merged) == merged


@given(st.lists(period))
def test_merge_ignores_input_order(periods: list[str]) -> None:
    assert merge_intervals(list(reversed(periods))) == merge_intervals(periods)


def test_parse_message_returns_complete_result() -> None:
    assert parse_message("ГПВ на 19 серпня\n1.1: 08:00-10:00", TODAY) == ParsedMessage(
        date(2026, 8, 19), {"1.1": ["08:00-10:00"]}, False
    )


def test_parse_message_rejects_incomplete_posts() -> None:
    assert parse_message("Вітаємо зі святом!", TODAY) is None
    assert parse_message("ГПВ без дати\n1.1: 08:00-10:00", TODAY) is None
    assert parse_message("ГПВ на 19 серпня, деталі згодом", TODAY) is None
