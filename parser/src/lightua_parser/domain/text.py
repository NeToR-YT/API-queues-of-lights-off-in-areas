"""Нормалізація тексту постів."""

_DASH_AND_SPACE_VARIANTS = str.maketrans(
    {
        "\u2013": "-",
        "\u2014": "-",
        "\u2010": "-",
        "\u2212": "-",
        "\u2011": "-",
        "\u00a0": " ",
        "\u202f": " ",
        "\u2009": " ",
    }
)


def normalize_dashes(text: str) -> str:
    return text.translate(_DASH_AND_SPACE_VARIANTS)
