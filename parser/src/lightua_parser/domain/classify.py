"""Чи стосується повідомлення графіків і чи діють аварійні відключення."""

import re

from lightua_parser.domain.text import normalize_dashes

_SCHEDULE_KEYWORDS = (
    "графік відключення світла",
    "графіки відключення світла",
    "графіки відключень світла",
    "графік погодинних вимкнень",
    "графіки погодинних вимкнень",
    "графіки погодинних відключень",
    "графік погодинних відключень",
    "погодинних відключень",
    "оновлений графік",
    "оновлені графіки",
    "гоп",
    "гпв",
    "відсутності електропостачання",
    "години відсутності електропостачання",
)

_EMERGENCY_POSITIVE = (
    "аварійних відключень",
    "аварійні відключення",
    "га в",
    "гaв",  # з латинською "a": так трапляється в реальних постах
    "гав",
    "гав)",
    "сгав",
    "сга",
    "застосовані графіки аварійних відключень",
    "застосовані графіки аварійних",
)

_NEGATIONS = ("скасован", "не застосов", "не буд", "не застосовані", "скасовано", "не діють")

# Межа за ASCII-словом: перед числом черги може стояти кирилична літера.
_SAME_LINE_QUEUE = re.compile(r"(?<![A-Za-z0-9_])[1-6]\.[12]\s*:\s*[0-9]{1,2}[.:][0-9]{2}")
_QUEUE_HEADER = re.compile(r"(?:черга|група)\s+[1-6]\.[12]\s*:", re.IGNORECASE)
_SENTENCE_END = re.compile(r"[\n.!?]+")


def is_power_outage_schedule(text: str) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in _SCHEDULE_KEYWORDS)


def has_queue_schedule(text: str) -> bool:
    """Формат черг без ключових слів: «5.1: 06:00-08:00» або заголовок «Черга 5.1:»."""
    normalized = normalize_dashes(text)
    return bool(_SAME_LINE_QUEUE.search(normalized) or _QUEUE_HEADER.search(normalized))


def is_emergency_outage_active(text: str) -> bool:
    """Вирішує перше речення, що згадує аварійні відключення: із запереченням — ні."""
    for sentence in _SENTENCE_END.split(text.lower()):
        if any(phrase in sentence for phrase in _EMERGENCY_POSITIVE):
            return not any(negation in sentence for negation in _NEGATIONS)
    return False
