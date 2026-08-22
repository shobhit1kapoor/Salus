"""Fail-closed Protegrity boundary for Salus.

Payloads are never logged. The explicit test mode exists only for automated tests
and synthetic local fixtures; production and Docker defaults always use Protegrity.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from functools import lru_cache
from threading import Lock
from typing import Any, Literal

import requests
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


MODE = os.getenv("SALUS_PRIVACY_MODE", "protegrity").strip().lower()
DISCOVERY_URL = os.getenv(
    "PROTEGRITY_DISCOVERY_URL",
    "http://classification-service:8050/pty/data-discovery/v2/classify/text",
)
GUARDRAIL_URL = os.getenv(
    "PROTEGRITY_GUARDRAIL_URL",
    "http://semantic-guardrail-service:8001/pty/semantic-guardrail/v1.1",
).rstrip("/")
SCORE_THRESHOLD = float(os.getenv("PROTEGRITY_CLASSIFICATION_THRESHOLD", "0.60"))
REQUEST_TIMEOUT = float(os.getenv("PROTEGRITY_REQUEST_TIMEOUT_SECONDS", "30"))
TEST_SECRET = os.getenv("SALUS_PRIVACY_TEST_SECRET", "synthetic-test-data-only")
CANONICAL_AAD = b"salus-canonical-v1"
TRACE_KEY_TTL_SECONDS = 10 * 60
_trace_keys: dict[str, tuple[bytes, str, float]] = {}
_trace_key_lock = Lock()

if MODE not in {"protegrity", "test"}:
    raise RuntimeError("SALUS_PRIVACY_MODE must be 'protegrity' or explicit 'test'")


class DiscoveryResult(BaseModel):
    entity_counts: dict[str, int] = Field(default_factory=dict, alias="entityCounts")
    total: int = 0

    model_config = {"populate_by_name": True}


class ProtectRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2_000_000)
    trace_id: str = Field(alias="traceId", min_length=8, max_length=100)
    purpose: str = Field(min_length=2, max_length=80)

    model_config = {"populate_by_name": True}


class ProtectResponse(BaseModel):
    canonical_protected: str = Field(alias="canonicalProtected")
    ai_safe_text: str = Field(alias="aiSafeText")
    fingerprint: str
    discovery: DiscoveryResult
    provider: Literal["protegrity", "test"]
    duration_ms: int = Field(alias="durationMs")

    model_config = {"populate_by_name": True}


class UnprotectRequest(BaseModel):
    canonical_protected: str = Field(alias="canonicalProtected", min_length=1, max_length=3_000_000)
    trace_id: str = Field(alias="traceId", min_length=8, max_length=100)
    purpose: str = Field(min_length=2, max_length=80)

    model_config = {"populate_by_name": True}


class GuardrailRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_024)
    trace_id: str = Field(alias="traceId", min_length=8, max_length=100)
    direction: Literal["input", "output"]

    model_config = {"populate_by_name": True}


class GuardrailResponse(BaseModel):
    outcome: Literal["approved", "rejected"]
    score: float
    processor: str
    explanation: str | None = None
    provider: Literal["protegrity", "test"]
    duration_ms: int = Field(alias="durationMs")

    model_config = {"populate_by_name": True}


class KeyRequest(BaseModel):
    value: str = Field(min_length=20, max_length=1000)
    trace_id: str = Field(alias="traceId", min_length=8, max_length=100)

    model_config = {"populate_by_name": True}


class EgressRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2_000_000)
    trace_id: str = Field(alias="traceId", min_length=8, max_length=100)
    prohibited_values: list[str] = Field(default_factory=list, alias="prohibitedValues", max_length=50)

    model_config = {"populate_by_name": True}


class EgressResponse(BaseModel):
    safe: bool
    discovery: DiscoveryResult
    canary_matches: int = Field(alias="canaryMatches")

    model_config = {"populate_by_name": True}


ENTITY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("SOCIAL_SECURITY_ID", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("EMAIL_ADDRESS", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
    ("PHONE_NUMBER", re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)")),
    ("DOB", re.compile(r"\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b")),
    ("HEALTH_CARE_ID", re.compile(r"\b(?:MRN|medical record)[:#\s-]*[A-Z0-9-]{5,}\b", re.I)),
]


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _alpha_pseudonym(value: str) -> str:
    hexadecimal = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    letters = hexadecimal.translate(str.maketrans("0123456789abcdef", "ABCDEFGHIJKLMNOP"))
    return "-".join(letters)


def _test_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(TEST_SECRET.encode("utf-8")).digest())
    return Fernet(key)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _test_discover(text: str) -> dict[str, list[dict[str, Any]]]:
    found: dict[str, list[dict[str, Any]]] = {}
    for entity, pattern in ENTITY_PATTERNS:
        matches = [
            {"score": 1.0, "location": {"start_index": match.start(), "end_index": match.end()}}
            for match in pattern.finditer(text)
        ]
        if matches:
            found[entity] = matches
    return found


def _discovery_summary(classifications: dict[str, list[dict[str, Any]]]) -> DiscoveryResult:
    counts = {entity: len(items) for entity, items in classifications.items() if items}
    return DiscoveryResult(entityCounts=counts, total=sum(counts.values()))


def _merge_deterministic_healthcare_patterns(
    classifications: dict[str, list[dict[str, Any]]], text: str
) -> dict[str, list[dict[str, Any]]]:
    """Close documented classifier gaps without replacing Protegrity discovery.

    Protegrity remains the primary classifier. Exact high-risk healthcare patterns
    are added only when their span was not already identified, and the resulting
    spans are protected by the same Protegrity-wrapped trace boundary.
    """
    merged = {entity: list(items) for entity, items in classifications.items()}
    occupied: list[tuple[int, int]] = []
    for items in merged.values():
        for item in items:
            location = item.get("location", {})
            try:
                occupied.append((int(location["start_index"]), int(location["end_index"])))
            except (KeyError, TypeError, ValueError):
                continue
    for entity, items in _test_discover(text).items():
        for item in items:
            location = item["location"]
            start, end = int(location["start_index"]), int(location["end_index"])
            if any(start < existing_end and end > existing_start for existing_start, existing_end in occupied):
                continue
            merged.setdefault(entity, []).append(item)
            occupied.append((start, end))
    return merged


def _protegrity_module():
    try:
        import protegrity_developer_python as protegrity
    except Exception as exc:  # pragma: no cover - environment-specific
        raise HTTPException(status_code=503, detail="Protegrity SDK is unavailable") from exc
    protegrity.configure(
        endpoint_url=DISCOVERY_URL,
        named_entity_map={
            "PERSON": "name",
            "NAME": "name",
            "SOCIAL_SECURITY_ID": "ssn",
            "US_SSN": "ssn",
            "EMAIL": "email",
            "EMAIL_ADDRESS": "email",
            "PHONE": "phone",
            "PHONE_NUMBER": "phone",
            "DOB": "datetime",
            "DATE": "datetime",
            "ADDRESS": "address",
            "LOCATION": "address",
            "HEALTH_CARE_ID": "number",
        },
        classification_score_threshold=SCORE_THRESHOLD,
        enable_logging=False,
        log_level="critical",
    )
    return protegrity


@lru_cache(maxsize=1)
def _protegrity_session():
    try:
        from appython import Protector

        return Protector().create_session(os.getenv("PROTEGRITY_POLICY_USER", "superuser"))
    except Exception as exc:  # pragma: no cover - credentials/service-specific
        raise HTTPException(status_code=503, detail="Protegrity protection service is unavailable") from exc


def _session_action(action: Literal["protect", "unprotect"], value: str, data_element: str) -> Any:
    try:
        from appython.utils.exceptions import InvalidSessionError, ProtectError, UnprotectError
    except Exception as exc:  # pragma: no cover - installation-specific
        raise HTTPException(status_code=503, detail="Protegrity SDK is unavailable") from exc
    retryable = (InvalidSessionError, ProtectError, UnprotectError)
    for attempt in range(2):
        try:
            session = _protegrity_session()
            return getattr(session, action)(value, data_element)
        except retryable:
            _protegrity_session.cache_clear()
            if attempt:
                raise
    raise RuntimeError("Unreachable Protegrity session state")


def _discover(text: str) -> dict[str, list[dict[str, Any]]]:
    if MODE == "test":
        return _test_discover(text)
    try:
        module = _protegrity_module()
        chunk_size = 8_000
        overlap = 256
        if len(text) <= chunk_size:
            discovered = module.discover(text)
        else:
            discovered: dict[str, list[dict[str, Any]]] = {}
            seen: set[tuple[str, int, int]] = set()
            start = 0
            while start < len(text):
                end = min(len(text), start + chunk_size)
                chunk = text[start:end]
                for entity, items in module.discover(chunk).items():
                    for item in items:
                        adjusted = dict(item)
                        location = dict(item["location"])
                        absolute_start = start + int(location["start_index"])
                        absolute_end = start + int(location["end_index"])
                        identity = (entity, absolute_start, absolute_end)
                        if identity in seen:
                            continue
                        seen.add(identity)
                        location["start_index"] = absolute_start
                        location["end_index"] = absolute_end
                        adjusted["location"] = location
                        discovered.setdefault(entity, []).append(adjusted)
                if end == len(text):
                    break
                start = end - overlap
        return _merge_deterministic_healthcare_patterns(discovered, text)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Protegrity discovery failed closed") from exc


def _test_protect_entities(text: str, classifications: dict[str, list[dict[str, Any]]]) -> str:
    spans: list[tuple[int, int, str]] = []
    for entity, items in classifications.items():
        for item in items:
            location = item["location"]
            spans.append((int(location["start_index"]), int(location["end_index"]), entity))
    for start, end, entity in sorted(spans, reverse=True):
        raw = text[start:end]
        protected_value = hmac.new(TEST_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        token = _alpha_pseudonym(protected_value)
        text = f"{text[:start]}[PROTECTED {token}]{text[end:]}"
    return text


def _protegrity_pseudonymize_entities(
    text: str, classifications: dict[str, list[dict[str, Any]]], trace_key: bytes
) -> str:
    """Create an AI-safe view without retaining identifier-shaped token formats.

    Protegrity Data Discovery locates each sensitive span. Salus derives a one-way
    pseudonym with the per-trace data key whose persisted form is wrapped by
    Protegrity. Overlapping classifier results are collapsed so a source span is
    transformed exactly once.
    """
    candidates: list[tuple[int, int, float, str]] = []
    for entity, items in classifications.items():
        for item in items:
            location = item["location"]
            start, end = int(location["start_index"]), int(location["end_index"])
            if 0 <= start < end <= len(text):
                candidates.append((start, end, float(item.get("score", 0.0)), entity))

    selected: list[tuple[int, int, str]] = []
    for start, end, _score, entity in sorted(
        candidates, key=lambda value: (value[0], -(value[1] - value[0]), -value[2])
    ):
        if any(start < chosen_end and end > chosen_start for chosen_start, chosen_end, _ in selected):
            continue
        selected.append((start, end, entity))

    for start, end, _entity in sorted(selected, reverse=True):
        protected_value = hmac.new(trace_key, text[start:end].encode("utf-8"), hashlib.sha256).hexdigest()
        pseudonym = _alpha_pseudonym(protected_value)
        text = f"{text[:start]}[PROTECTED {pseudonym}]{text[end:]}"
    return text


def _trace_key(trace_id: str) -> tuple[bytes, str]:
    now = time.monotonic()
    with _trace_key_lock:
        expired = [key for key, (_, _, expires_at) in _trace_keys.items() if expires_at <= now]
        for key in expired:
            del _trace_keys[key]
        cached = _trace_keys.get(trace_id)
        if cached:
            return cached[0], cached[1]
        trace_key = os.urandom(32)
        wrapped = str(_session_action("protect", _b64url_encode(trace_key), "string"))
        _trace_keys[trace_id] = (trace_key, wrapped, now + TRACE_KEY_TTL_SECONDS)
        return trace_key, wrapped


def _protect_full_text(text: str, trace_id: str) -> tuple[str, bytes]:
    if MODE == "test":
        return "TEST1:" + _test_fernet().encrypt(text.encode("utf-8")).decode("ascii"), hashlib.sha256(TEST_SECRET.encode("utf-8")).digest()
    try:
        trace_key, wrapped = _trace_key(trace_id)
        nonce = os.urandom(12)
        ciphertext = AESGCM(trace_key).encrypt(nonce, text.encode("utf-8"), CANONICAL_AAD)
        wrapped_encoded = _b64url_encode(wrapped.encode("utf-8"))
        return f"SALUS1:{wrapped_encoded}:{_b64url_encode(nonce)}:{_b64url_encode(ciphertext)}", trace_key
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Protegrity protection failed closed") from exc


def _unprotect_full_text(value: str) -> str:
    if MODE == "test":
        if not value.startswith("TEST1:"):
            raise HTTPException(status_code=422, detail="Invalid protected test envelope")
        try:
            return _test_fernet().decrypt(value[6:].encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise HTTPException(status_code=422, detail="Protected envelope validation failed") from exc
    try:
        if not value.startswith("SALUS1:"):
            return str(_session_action("unprotect", value, "string"))
        version, wrapped_encoded, nonce_encoded, ciphertext_encoded = value.split(":", 3)
        if version != "SALUS1":
            raise ValueError("Unsupported protected envelope")
        wrapped = _b64url_decode(wrapped_encoded).decode("utf-8")
        trace_key_encoded = str(_session_action("unprotect", wrapped, "string"))
        trace_key = _b64url_decode(trace_key_encoded)
        plaintext = AESGCM(trace_key).decrypt(
            _b64url_decode(nonce_encoded), _b64url_decode(ciphertext_encoded), CANONICAL_AAD
        )
        return plaintext.decode("utf-8")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Protegrity unprotect failed closed") from exc


app = FastAPI(
    title="Salus Privacy Gateway",
    description="Internal fail-closed Protegrity boundary. Never expose this service publicly.",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)


@app.get("/health")
def health() -> dict[str, Any]:
    configured = MODE == "protegrity" and all(
        os.getenv(name)
        for name in ("DEV_EDITION_EMAIL", "DEV_EDITION_PASSWORD", "DEV_EDITION_API_KEY")
    )
    if MODE == "protegrity" and configured:
        try:
            _discover("Salus privacy readiness probe")
            if not _protegrity_session().check_access("string", "protect"):
                raise RuntimeError("Protegrity policy does not allow canonical protection")
            response = requests.post(
                f"{GUARDRAIL_URL}/conversations/messages/scan",
                json={"messages": [{"id": "salus-readiness", "from": "user", "to": "ai", "content": "Protected readiness probe", "processors": ["healthcare"]}]},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
        except Exception as exc:
            raise HTTPException(status_code=503, detail="One or more Protegrity controls are unavailable") from exc
    return {
        "status": "ready",
        "mode": MODE,
        "protegrityConfigured": configured,
    }


@app.post("/v1/discover", response_model=DiscoveryResult, response_model_by_alias=True)
def discover(request: ProtectRequest) -> DiscoveryResult:
    return _discovery_summary(_discover(request.text))


@app.post("/v1/protect", response_model=ProtectResponse, response_model_by_alias=True)
def protect(request: ProtectRequest) -> ProtectResponse:
    started = time.perf_counter()
    classifications = _discover(request.text)
    discovery = _discovery_summary(classifications)
    canonical, trace_key = _protect_full_text(request.text, request.trace_id)
    try:
        ai_safe = (
            _test_protect_entities(request.text, classifications)
            if MODE == "test"
            else _protegrity_pseudonymize_entities(request.text, classifications, trace_key)
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Protegrity entity protection failed closed") from exc
    remaining_classifications = _discover(ai_safe)
    remaining = _discovery_summary(remaining_classifications)
    for _ in range(3):
        if not remaining.total:
            break
        next_ai_safe = (
            _test_protect_entities(ai_safe, remaining_classifications)
            if MODE == "test"
            else _protegrity_pseudonymize_entities(ai_safe, remaining_classifications, trace_key)
        )
        if next_ai_safe == ai_safe:
            break
        ai_safe = next_ai_safe
        remaining_classifications = _discover(ai_safe)
        remaining = _discovery_summary(remaining_classifications)
    if remaining.total:
        entity_types = ", ".join(sorted(remaining.entity_counts))
        raise HTTPException(
            status_code=422,
            detail=f"Protected text failed post-protection discovery ({entity_types})",
        )
    return ProtectResponse(
        canonicalProtected=canonical,
        aiSafeText=ai_safe,
        fingerprint=_fingerprint(request.text),
        discovery=discovery,
        provider=MODE,
        durationMs=round((time.perf_counter() - started) * 1000),
    )


@app.post("/v1/unprotect")
def unprotect(request: UnprotectRequest) -> dict[str, str]:
    return {"text": _unprotect_full_text(request.canonical_protected)}


@app.post("/v1/keys/wrap")
def wrap_key(request: KeyRequest) -> dict[str, str]:
    wrapped, _ = _protect_full_text(request.value, request.trace_id)
    return {"wrappedKey": wrapped}


@app.post("/v1/keys/unwrap")
def unwrap_key(request: KeyRequest) -> dict[str, str]:
    return {"value": _unprotect_full_text(request.value)}


@app.post("/v1/guardrails/scan", response_model=GuardrailResponse, response_model_by_alias=True)
def guardrails(request: GuardrailRequest) -> GuardrailResponse:
    started = time.perf_counter()
    # Protegrity applies the healthcare domain model to user input and the PII
    # processor to model output. Both calls fail closed on unavailable controls.
    processor = "healthcare" if request.direction == "input" else "pii"
    if MODE == "test":
        risky = bool(
            re.search(r"ignore.{0,30}(system|previous|rules)|reveal.{0,30}(secret|all records)", request.text, re.I)
            if request.direction == "input"
            else _discovery_summary(_test_discover(request.text)).total
        )
        return GuardrailResponse(
            outcome="rejected" if risky else "approved",
            score=0.96 if risky else 0.02,
            processor=processor,
            explanation="Synthetic deterministic test decision",
            provider="test",
            durationMs=round((time.perf_counter() - started) * 1000),
        )
    payload = {
        "messages": [
            {
                "id": request.trace_id,
                "from": "user" if request.direction == "input" else "ai",
                "to": "ai" if request.direction == "input" else "user",
                "content": request.text,
                "processors": [processor],
            }
        ]
    }
    try:
        response = requests.post(
            f"{GUARDRAIL_URL}/conversations/messages/scan",
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        body = response.json()
        message = body["messages"][0]
        detail = message.get("processors", [{}])[0]
        return GuardrailResponse(
            outcome="rejected" if body["batch"]["outcome"] == "rejected" else "approved",
            score=float(message.get("score") or body["batch"]["score"]),
            processor=processor,
            explanation=detail.get("explanation"),
            provider="protegrity",
            durationMs=round((time.perf_counter() - started) * 1000),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Protegrity Semantic Guardrails failed closed") from exc


@app.post("/v1/egress/validate", response_model=EgressResponse, response_model_by_alias=True)
def validate_egress(request: EgressRequest) -> EgressResponse:
    discovery = _discovery_summary(_discover(request.text))
    lowered = request.text.casefold()
    canary_matches = sum(
        1 for value in request.prohibited_values if value and value.casefold() in lowered
    )
    return EgressResponse(
        safe=discovery.total == 0 and canary_matches == 0,
        discovery=discovery,
        canaryMatches=canary_matches,
    )
