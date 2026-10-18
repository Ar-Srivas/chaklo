import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from IndicTransToolkit.processor import IndicProcessor

from .config import MODEL_NAME, SOURCE_LANGUAGE, BATCH_SIZE


class IndicTranslator:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        self.tokenizer = AutoTokenizer.from_pretrained(
            MODEL_NAME,
            trust_remote_code=True,
        )

        self.model = AutoModelForSeq2SeqLM.from_pretrained(
            MODEL_NAME,
            trust_remote_code=True,
            low_cpu_mem_usage=True,
        )

        self.model = self.model.to(self.device)
        if self.device == "cuda":
            self.model.half()

        self.model.eval()
        self.processor = IndicProcessor(inference=True)

    def translate(self, texts, target_language):
        if not texts:
            return []

        translations = []

        for start in range(0, len(texts), BATCH_SIZE):
            batch = texts[start:start + BATCH_SIZE]

            prepared = self.processor.preprocess_batch(
                batch,
                src_lang=SOURCE_LANGUAGE,
                tgt_lang=target_language,
            )

            inputs = self.tokenizer(
                prepared,
                truncation=True,
                padding="longest",
                return_tensors="pt",
                return_attention_mask=True,
            ).to(self.device)

            with torch.no_grad():
                generated = self.model.generate(
                    **inputs,
                    use_cache=False,
                    max_length=256,
                    num_beams=5,
                    num_return_sequences=1,
                )

            decoded = self.tokenizer.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=True,)

            translations.extend(
                self.processor.postprocess_batch(
                    decoded,
                    lang=target_language,
                )
            )

            del inputs

            if self.device == "cuda":
                torch.cuda.empty_cache()

        return translations