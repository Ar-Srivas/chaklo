import re
from dataclasses import dataclass


PRICE_RE = re.compile(
    r"^\s*(?:(?:₹|Rs\.?|INR|\$|€|£)\s*)?"
    r"\d{1,5}(?:[,.]\d{1,2})?\s*(?:/-)?\s*$",
    re.IGNORECASE,
)


def looks_like_price(text):
    return bool(PRICE_RE.match(text.strip()))


@dataclass
class MenuItem:
    original_text: str
    translated_text: str
    confidence: float
    polygon: list
    is_price: bool = False


def build_menu_items(records, translations):
    items = []
    translation_index = 0

    for record in records:
        original = record["text"]
        is_price = looks_like_price(original)

        if is_price:
            translated = original
        else:
            translated = translations[translation_index]
            translation_index += 1

        items.append(
            MenuItem(
                original_text=original,
                translated_text=translated,
                confidence=record["confidence"],
                polygon=record["polygon"],
                is_price=is_price,
            )
        )

    return items