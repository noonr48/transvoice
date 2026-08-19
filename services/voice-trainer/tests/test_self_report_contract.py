from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.services.contracts import VoiceSelfReport, VoiceTakeOneShotRequest


def test_explicit_pain_and_discomfort_round_trip_in_self_report() -> None:
    report = VoiceSelfReport(
        perceivedDifficulty=3,
        effort=4,
        confidence=2,
        strain=3,
        fatigue=2,
        pain=True,
        throatPain=False,
        discomfort=4,
    )
    payload = report.model_dump(exclude_none=True)
    assert payload["pain"] is True
    assert payload["throatPain"] is False
    assert payload["discomfort"] == 4


def test_take_request_can_carry_the_same_safety_report() -> None:
    request = VoiceTakeOneShotRequest(
        sloaneSessionId="session-1",
        pcm16Base64="AA==",
        selfReport={
            "effort": 5,
            "strain": 4,
            "pain": True,
            "throatPain": True,
            "discomfort": 5,
        },
    )
    assert request.selfReport is not None
    assert request.selfReport.pain is True
    assert request.selfReport.throatPain is True
    assert request.selfReport.discomfort == 5


def test_discomfort_uses_the_same_bounded_five_point_contract() -> None:
    with pytest.raises(ValidationError):
        VoiceSelfReport(discomfort=0)
    with pytest.raises(ValidationError):
        VoiceSelfReport(discomfort=6)


def test_pain_fields_are_strict_booleans_not_coercible_payloads() -> None:
    for value in ("definitely", "true", "false", 1, 0):
        with pytest.raises(ValidationError):
            VoiceSelfReport(pain=value)
        with pytest.raises(ValidationError):
            VoiceSelfReport(throatPain=value)
