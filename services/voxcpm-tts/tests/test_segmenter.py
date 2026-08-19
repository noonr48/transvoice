from app.segmenter import segment_text


def test_empty_text():
    assert segment_text("") == []
    assert segment_text("   ") == []


def test_short_text_single_segment():
    result = segment_text("Hello world.")
    assert result == ["Hello world."]


def test_two_complete_coach_sentences_stream_as_separate_segments():
    text = (
        "I couldn't get a clear read from that take. "
        "Try speaking a little louder and closer to your microphone."
    )

    assert segment_text(text, max_chars=220, min_chars=40) == [
        "I couldn't get a clear read from that take.",
        "Try speaking a little louder and closer to your microphone.",
    ]


def test_short_complete_first_coach_sentence_streams_before_the_second():
    text = (
        "Let the opening stay gentle and clear. "
        "Keep the final words comfortably forward."
    )

    assert segment_text(text, max_chars=220, min_chars=40) == [
        "Let the opening stay gentle and clear.",
        "Keep the final words comfortably forward.",
    ]


def test_tiny_first_fragment_still_merges_for_stable_synthesis():
    text = "Okay. Keep the final words comfortably forward."

    assert segment_text(text, max_chars=220, min_chars=40) == [text]


def test_decimal_is_never_split_or_rewritten():
    text = "Keep the pitch near 2.5 semitones. Let the ending settle."

    assert segment_text(text, max_chars=220, min_chars=24) == [
        "Keep the pitch near 2.5 semitones.",
        "Let the ending settle.",
    ]


def test_abbreviation_is_not_treated_as_a_sentence_boundary():
    text = "Use an image, e.g. a gentle wave, for this phrase. Then release it."

    assert segment_text(text, max_chars=220, min_chars=24) == [
        "Use an image, e.g. a gentle wave, for this phrase.",
        "Then release it.",
    ]


def test_closing_quote_stays_with_its_complete_sentence():
    text = "Say “please keep this sound gentle.” Then let the next phrase settle."

    assert segment_text(text, max_chars=220, min_chars=24) == [
        "Say “please keep this sound gentle.”",
        "Then let the next phrase settle.",
    ]


def test_first_complete_sentence_floor_is_exactly_24_characters():
    below_floor = "A" * 22 + "."
    at_floor = "B" * 23 + "."
    continuation = "This continuation is comfortably long enough."

    assert len(below_floor) == 23
    assert len(at_floor) == 24
    assert segment_text(f"{below_floor} {continuation}", min_chars=40) == [
        f"{below_floor} {continuation}",
    ]
    assert segment_text(f"{at_floor} {continuation}", min_chars=40) == [
        at_floor,
        continuation,
    ]


def test_respects_max_chars():
    text = "First sentence. Second sentence that is a bit longer."
    result = segment_text(text, max_chars=30, min_chars=10)
    for seg in result:
        assert len(seg) <= 30


def test_merges_tiny_segments():
    text = "A. B. A longer sentence that stands on its own here."
    result = segment_text(text, max_chars=60, min_chars=15)
    assert len(result) <= 3
    for seg in result:
        assert len(seg) <= 60


def test_single_word():
    result = segment_text("supercalifragilisticexpialidocious")
    assert len(result) >= 1


def test_very_long_sentence_without_boundaries():
    words = ["word"] * 100
    text = " ".join(words)
    result = segment_text(text, max_chars=200, min_chars=40)
    for seg in result:
        assert len(seg) <= 200
    all_words = []
    for seg in result:
        all_words.extend(seg.split())
    assert all_words == words


def test_newline_splitting():
    text = "This is the first line of text that is fairly long.\nThis is the second line of text that is also fairly long.\nThis is the third line."
    result = segment_text(text, max_chars=40, min_chars=5)
    assert len(result) >= 2


def test_preserves_content():
    text = "First sentence. Second sentence. Third sentence."
    result = segment_text(text, max_chars=60, min_chars=10)
    reconstructed = " ".join(result)
    for word in ["First", "Second", "Third"]:
        assert word in reconstructed
