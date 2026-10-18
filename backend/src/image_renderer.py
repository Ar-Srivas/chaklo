import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def load_font(size):
    candidates = [
        r"C:\Windows\Fonts\Nirmala.ttf",
        r"C:\Windows\Fonts\NirmalaB.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]

    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass

    return ImageFont.load_default()


def render_translated_image(image, items):
    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]

    mask = np.zeros((height, width), dtype=np.uint8)

    for item in items:
        points = np.asarray(item.polygon, dtype=np.int32)
        cv2.fillPoly(mask, [points], 255)

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    cleaned = cv2.inpaint(
        bgr,
        mask,
        max(3, int(min(width, height) * 0.004)),
        cv2.INPAINT_TELEA,
    )

    canvas = Image.fromarray(
        cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB)
    )

    draw = ImageDraw.Draw(canvas)

    for item in items:
        points = item.polygon

        x1 = max(0, min(p[0] for p in points))
        x2 = min(width - 1, max(p[0] for p in points))
        y1 = max(0, min(p[1] for p in points))
        y2 = min(height - 1, max(p[1] for p in points))

        box_width = max(1, x2 - x1)
        box_height = max(1, y2 - y1)

        text = item.translated_text
        font_size = max(10, min(36, int(box_height * 0.8)))
        font = load_font(font_size)

        while font_size > 9:
            bbox = draw.textbbox((0, 0), text, font=font)

            if bbox[2] - bbox[0] <= box_width:
                break

            font_size -= 1
            font = load_font(font_size)

        draw.rectangle(
            (x1, y1, x2, y2),
            fill=(255, 255, 255),
        )

        draw.text(
            (x1 + 1, y1),
            text,
            font=font,
            fill=(20, 20, 20),
        )

    return canvas