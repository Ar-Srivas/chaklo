import base64
import threading
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from backend.src.config import LANGUAGE_OPTIONS
from backend.src.pipeline import MenulyPipeline


ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}

app = FastAPI(title="Menuly API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_pipeline = None
_pipeline_lock = threading.Lock()


def get_pipeline() -> MenulyPipeline:
    global _pipeline

    if _pipeline is None:
        with _pipeline_lock:
            if _pipeline is None:
                _pipeline = MenulyPipeline()

    return _pipeline


def image_data_url(image_bytes: bytes) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"


@app.get("/", include_in_schema=False)
def serve_index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/api/translate")
async def translate_menu(
    file: UploadFile = File(...),
    language: str = Form(...),
) -> dict:
    if language not in LANGUAGE_OPTIONS.values():
        raise HTTPException(status_code=400, detail="Unsupported target language.")

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400,detail="Upload a JPEG, PNG, or WebP image.",)

    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413,detail="The image must be 15 MB or smaller.",)

    try:
        with Image.open(BytesIO(contents)) as uploaded_image:
            image = uploaded_image.convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=400,detail="The uploaded file is not a valid image.",) from error

    try:
        result = get_pipeline().process(image, language)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return {
        "image": image_data_url(result.image_bytes),
        "items": [
            {
                "original": item.original_text,
                "translated": item.translated_text,
            }
            for item in result.items
        ],
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
