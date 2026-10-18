import httpx

from backend.src.nutrition import NutritionClient


def make_client(handler):
    return NutritionClient(
        api_key="test-key",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def successful_payload():
    return {
        "calories": {"value": 450.25, "unit": "kcal"},
        "protein": {"value": 18, "unit": "g"},
        "carbs": {"value": 52, "unit": "g"},
        "fat": {"value": 16, "unit": "g"},
    }


def test_successful_estimate_and_cache():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        assert request.url.params["title"] == "Paneer tikka"
        return httpx.Response(200, json=successful_payload())

    client = make_client(handler)
    first = client.estimate("Paneer tikka")
    second = client.estimate("  Paneer   tikka ")

    assert first.status == "estimated"
    assert first.data["calories"]["value"] == 450.2
    assert second == first
    assert calls == 1


def test_missing_result_is_unavailable():
    client = make_client(lambda request: httpx.Response(200, json={}))

    result = client.estimate("Unknown dish")

    assert result.status == "unavailable"
    assert result.data is None


def test_malformed_response_is_unavailable():
    client = make_client(lambda request: httpx.Response(200, json={"calories": "450"}))

    result = client.estimate("Malformed dish")

    assert result.status == "unavailable"


def test_timeout_is_unavailable():
    def handler(request):
        raise httpx.ReadTimeout("timed out")

    result = make_client(handler).estimate("Slow dish")

    assert result.status == "unavailable"
    assert "time" in result.message


def test_api_error_is_unavailable():
    client = make_client(lambda request: httpx.Response(500))

    result = client.estimate("Broken dish")

    assert result.status == "unavailable"


def test_rate_limit_and_quota_are_reported():
    for status_code in (402, 429):
        client = make_client(lambda request, code=status_code: httpx.Response(code))

        result = client.estimate("Limited dish")

        assert result.status == "rate_limited"
