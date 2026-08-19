import re


_FIRST_COMPLETE_SENTENCE_MIN_CHARS = 24
_CLOSING_SENTENCE_MARKS = frozenset('"\'”’)]}')
_COMMON_ABBREVIATIONS = frozenset({
    "e.g.",
    "i.e.",
    "etc.",
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "vs.",
})


def _segment_min_chars(segment_index: int, min_chars: int) -> int:
    # A short complete opening sentence is useful audio on its own and should
    # reach the learner quickly. Keep merging truly tiny openers, which are
    # more likely to produce unstable standalone synthesis.
    if segment_index == 0:
        return min(min_chars, _FIRST_COMPLETE_SENTENCE_MIN_CHARS)
    return min_chars


def _is_abbreviation_period(text: str, period_index: int) -> bool:
    prefix = text[: period_index + 1]
    match = re.search(r"([A-Za-z][A-Za-z.]*)\.$", prefix)
    if not match:
        return False
    token = match.group(0).lower()
    return token in _COMMON_ABBREVIATIONS or bool(
        re.fullmatch(r"(?:[a-z]\.){2,}", token)
    )


def _sentence_split_offsets(text: str) -> list[int]:
    offsets = [0]
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\n":
            end = index + 1
            while end < len(text) and text[end] == "\n":
                end += 1
            if end < len(text):
                offsets.append(end)
            index = end
            continue
        if char not in ".!?":
            index += 1
            continue
        if char == "." and _is_abbreviation_period(text, index):
            index += 1
            continue

        end = index + 1
        while end < len(text) and text[end] in ".!?":
            end += 1
        while end < len(text) and text[end] in _CLOSING_SENTENCE_MARKS:
            end += 1
        if end == len(text) or text[end].isspace():
            if end < len(text):
                offsets.append(end)
            index = end
            continue
        # Decimal points, domains, and other intra-token punctuation are not
        # sentence boundaries and must never be rewritten by re-segmentation.
        index += 1
    offsets.append(len(text))
    return offsets


def segment_text(text: str, max_chars: int = 220, min_chars: int = 40) -> list[str]:
    if not text or not text.strip():
        return []

    text = text.strip()

    splits = _sentence_split_offsets(text)

    raw_segments: list[str] = []
    for i in range(len(splits) - 1):
        seg = text[splits[i] : splits[i + 1]].strip()
        if seg:
            raw_segments.append(seg)

    if not raw_segments:
        return [text]

    merged: list[str] = []
    for seg in raw_segments:
        if merged and len(merged[-1]) < _segment_min_chars(len(merged) - 1, min_chars):
            candidate = merged[-1] + " " + seg
            if len(candidate) <= max_chars:
                merged[-1] = candidate
                continue
        if len(seg) > max_chars:
            words = seg.split()
            current = ""
            for word in words:
                if current and len(current) + 1 + len(word) > max_chars:
                    merged.append(current)
                    current = word
                else:
                    current = (current + " " + word).strip() if current else word
            if current:
                merged.append(current)
        else:
            merged.append(seg)

    result: list[str] = []
    for seg in merged:
        if result and len(result[-1]) < _segment_min_chars(len(result) - 1, min_chars):
            candidate = result[-1] + " " + seg
            if len(candidate) <= max_chars:
                result[-1] = candidate
                continue
        result.append(seg)

    return result if result else [text]
