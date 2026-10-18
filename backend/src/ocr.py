import json
import numpy as np
from paddleocr import PaddleOCR


def normalize_result(result):
    data = getattr(result, "json", result)

    if callable(data):
        data = data()

    if isinstance(data, str):
        data = json.loads(data)

    if not isinstance(data, dict):
        return {}

    if isinstance(data.get("res"), dict):
        data = data["res"]

    return data


class MenuOCR:
    def __init__(self):
        self.engine = PaddleOCR(
            lang="en",
            use_textline_orientation=True,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            enable_mkldnn=False,
        )

    def extract(self, image):
        image_array = np.asarray(image.convert("RGB"))
        predictions = self.engine.predict(image_array)

        records = []

        for prediction in predictions or []:
            data = normalize_result(prediction)

            texts = data.get("rec_texts", [])
            scores = data.get("rec_scores", [])
            polygons = data.get("rec_polys", [])
            boxes = data.get("rec_boxes", [])

            coordinates = (polygons if len(polygons) == len(texts) else boxes)

            for i, text in enumerate(texts):
                text = str(text).strip()

                if not text or i >= len(coordinates):
                    continue

                points = np.asarray(coordinates[i]).tolist()

                # Convert [x1, y1, x2, y2] to four corners.
                if (len(points) == 4 and all(isinstance(v, (int, float)) for v in points)):
                    x1, y1, x2, y2 = points
                    points = [
                        [x1, y1],
                        [x2, y1],
                        [x2, y2],
                        [x1, y2],
                    ]

                if len(points) < 4:
                    continue

                records.append({
                    "text": text,
                    "confidence": (
                        float(scores[i]) if i < len(scores) else 0.0
                    ),
                    "polygon": [
                        [int(p[0]), int(p[1])]
                        for p in points[:4]
                    ],
                })

        return records