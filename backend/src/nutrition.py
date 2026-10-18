from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx


SPOONACULAR_URL = "https://api.spoonacular.com/recipes/guessNutrition"
DEFAULT_TIMEOUT_SECONDS = 6.0
DEFAULT_CACHE_SECONDS = 15 * 60
NEGATIVE_CACHE_SECONDS = 2 * 60


@dataclass(frozen=True)
class NutritionResult:
    status: str
    message: str
    data: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": self.status,
            "message": self.message,
        }
        if self.data is not None:
            result["data"] = self.data
        return result


class NutritionClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        client: httpx.Client | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        cache_seconds: int = DEFAULT_CACHE_SECONDS,
    ):
        self.api_key = api_key if api_key is not None else os.getenv(
            "SPOONACULAR_API_KEY"
        )
        self.client = client or httpx.Client()
        self.timeout = timeout
        self.cache_seconds = cache_seconds
        self._cache: dict[str, tuple[float, NutritionResult]] = {}
        self._cache_lock = threading.Lock()

    def estimate_many(self, dish_names: list[str]) -> dict[str, NutritionResult]:
        results: dict[str, NutritionResult] = {}
        for dish_name in dict.fromkeys(dish_names):
            results[dish_name] = self.estimate(dish_name)
        return results

    def estimate(self, dish_name: str) -> NutritionResult:
        normalized_name = " ".join(dish_name.split())
        if not normalized_name:
            return NutritionResult(
                status="unavailable",
                message="No dish name was available for a nutrition estimate.",
            )

        cached = self._get_cached(normalized_name)
        if cached is not None:
            return cached

        if not self.api_key:
            result = NutritionResult(
                status="unavailable",
                message=(
                    "Nutrition estimates are unavailable because "
                    "SPOONACULAR_API_KEY is not configured."
                ),
            )
            self._cache_result(normalized_name, result, NEGATIVE_CACHE_SECONDS)
            return result

        try:
            response = self.client.get(
                SPOONACULAR_URL,
                params={"apiKey": self.api_key, "title": normalized_name},
                timeout=self.timeout,
            )
        except httpx.TimeoutException:
            result = NutritionResult(
                status="unavailable",
                message="Spoonacular did not respond in time.",
            )
            self._cache_result(normalized_name, result, NEGATIVE_CACHE_SECONDS)
            return result
        except httpx.HTTPError:
            result = NutritionResult(
                status="unavailable",
                message="Spoonacular could not be reached.",
            )
            self._cache_result(normalized_name, result, NEGATIVE_CACHE_SECONDS)
            return result

        if response.status_code in (402, 429):
            result = NutritionResult(
                status="rate_limited",
                message=(
                    "Nutrition estimates are temporarily unavailable because "
                    "the Spoonacular rate limit or daily quota was reached."
                ),
            )
            self._cache_result(normalized_name, result, NEGATIVE_CACHE_SECONDS)
            return result

        if response.status_code >= 400:
            result = NutritionResult(
                status="unavailable",
                message="Spoonacular could not provide a nutrition estimate.",
            )
            self._cache_result(normalized_name, result, NEGATIVE_CACHE_SECONDS)
            return result

        try:
            payload = response.json()
        except ValueError:
            payload = None

        data = self._parse_payload(payload)
        if data is None:
            result = NutritionResult(
                status="unavailable",
                message="No complete nutrition estimate was found for this dish.",
            )
            self._cache_result(normalized_name, result, NEGATIVE_CACHE_SECONDS)
            return result

        result = NutritionResult(
            status="estimated",
            message="Approximate dish-name estimate from Spoonacular.",
            data=data,
        )
        self._cache_result(normalized_name, result, self.cache_seconds)
        return result

    def _parse_payload(self, payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None

        values = {
            "calories": self._nutrient_value(payload.get("calories"), "kcal"),
            "protein": self._nutrient_value(payload.get("protein"), "g"),
            "carbohydrates": self._nutrient_value(
                payload.get("carbs", payload.get("carbohydrates")),
                "g",
            ),
            "fat": self._nutrient_value(
                payload.get("fat", payload.get("totalFat")),
                "g",
            ),
        }
        if any(value is None for value in values.values()):
            return None

        return {
            "calories": values["calories"],
            "protein": values["protein"],
            "carbohydrates": values["carbohydrates"],
            "fat": values["fat"],
            "serving": (
                "Estimated per serving; restaurant portions and recipes vary."
            ),
            "source": "Spoonacular guessNutrition",
            "estimate_type": "dish_name_estimate",
        }

    @staticmethod
    def _nutrient_value(value: Any, default_unit: str) -> dict[str, Any] | None:
        if not isinstance(value, dict) or "value" not in value:
            return None
        try:
            numeric_value = float(value["value"])
        except (TypeError, ValueError):
            return None
        if numeric_value < 0:
            return None

        return {
            "value": round(numeric_value, 1),
            "unit": str(value.get("unit") or default_unit),
        }

    def _get_cached(self, key: str) -> NutritionResult | None:
        with self._cache_lock:
            cached = self._cache.get(key)
            if cached is None:
                return None
            expires_at, result = cached
            if expires_at <= time.monotonic():
                del self._cache[key]
                return None
            return result

    def _cache_result(
        self,
        key: str,
        result: NutritionResult,
        ttl_seconds: int,
    ) -> None:
        with self._cache_lock:
            self._cache[key] = (time.monotonic() + ttl_seconds, result)
