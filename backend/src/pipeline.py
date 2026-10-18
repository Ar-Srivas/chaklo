from dataclasses import dataclass
from io import BytesIO

from PIL import Image

from .ocr import MenuOCR
from .translation import IndicTranslator
from .menu_parser import looks_like_price, build_menu_items
from .image_renderer import render_translated_image


@dataclass
class PipelineResult:
    image: Image.Image
    image_bytes: bytes
    items: list


class ChakloPipeline:
    def __init__(self):
        self.ocr = MenuOCR()
        self.translator = IndicTranslator()

    def process(self, image, target_language):
        image = image.convert("RGB")

        records = self.ocr.extract(image)

        if not records:
            raise ValueError(
                "No text detected. Try a sharper, well-lit photo."
            )

        text_to_translate = [
            record["text"]
            for record in records
            if not looks_like_price(record["text"])
        ]

        translations = self.translator.translate(
            text_to_translate,
            target_language,
        )

        if len(translations) != len(text_to_translate):
            raise RuntimeError(
                "The number of translations does not match the OCR text."
            )

        items = build_menu_items(records, translations)

        output_image = render_translated_image(image, items)

        buffer = BytesIO()
        output_image.save(buffer, format="PNG")

        return PipelineResult(
            image=output_image,
            image_bytes=buffer.getvalue(),
            items=items,
        )