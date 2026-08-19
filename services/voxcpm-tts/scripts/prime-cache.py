#!/usr/bin/env python3
"""Pre-compute TTS cache from drill registry phrases."""

import json
import sys
from pathlib import Path

import httpx

TTS_URL = "http://127.0.0.1:8020/v1/cache/prime"

DRILL_REGISTRY_PATHS = [
    Path(__file__).resolve().parent.parent.parent / "backend" / "data" / "drills.json",
    Path(__file__).resolve().parent.parent.parent
    / "backend"
    / "registry"
    / "drills.json",
    Path(__file__).resolve().parent.parent.parent
    / "backend"
    / "app"
    / "data"
    / "drills.json",
]


def load_drill_phrases() -> list[str]:
    for p in DRILL_REGISTRY_PATHS:
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            phrases: list[str] = []
            if isinstance(data, list):
                for entry in data:
                    if isinstance(entry, dict):
                        for key in (
                            "text",
                            "prompt",
                            "phrase",
                            "content",
                            "instruction",
                        ):
                            val = entry.get(key)
                            if isinstance(val, str) and val.strip():
                                phrases.append(val.strip())
                    elif isinstance(entry, str):
                        phrases.append(entry.strip())
            elif isinstance(data, dict):
                for entry in data.values():
                    if isinstance(entry, list):
                        for item in entry:
                            if isinstance(item, dict):
                                for key in (
                                    "text",
                                    "prompt",
                                    "phrase",
                                    "content",
                                    "instruction",
                                ):
                                    val = item.get(key)
                                    if isinstance(val, str) and val.strip():
                                        phrases.append(val.strip())
                            elif isinstance(item, str):
                                phrases.append(item.strip())
            unique: list[str] = []
            seen: set[str] = set()
            for p in phrases:
                if p not in seen:
                    seen.add(p)
                    unique.append(p)
            return unique
    return []


def main() -> None:
    phrases = load_drill_phrases()
    if not phrases:
        print("no drill phrases found, exiting")
        sys.exit(0)

    print(f"found {len(phrases)} unique phrases to prime")

    batch_size = 20
    total_primed = 0
    for i in range(0, len(phrases), batch_size):
        batch = phrases[i : i + batch_size]
        try:
            resp = httpx.post(
                TTS_URL,
                json={"phrases": batch, "voice_profile_id": "coach_v1"},
                timeout=300.0,
            )
            resp.raise_for_status()
            result = resp.json()
            total_primed += result.get("primed", 0)
            print(
                f"  batch {i // batch_size + 1}: primed {result.get('primed', 0)}/{len(batch)}"
            )
        except httpx.HTTPStatusError as e:
            print(
                f"  batch {i // batch_size + 1}: HTTP {e.response.status_code} — {e.response.text}"
            )
        except httpx.ConnectError:
            print(f"cannot connect to TTS service at {TTS_URL} — is it running?")
            sys.exit(1)

    print(f"done — primed {total_primed} new segments")


if __name__ == "__main__":
    main()
