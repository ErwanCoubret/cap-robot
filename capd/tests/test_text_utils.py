"""Sentence splitting for chunked speech synthesis."""

from __future__ import annotations

from capd.text_utils import split_for_speech


def test_empty_text_produces_no_chunks() -> None:
    assert split_for_speech("   ") == []


def test_short_text_stays_in_one_chunk() -> None:
    assert split_for_speech("C'est noté !") == ["C'est noté !"]


def test_sentences_are_grouped_up_to_the_limit() -> None:
    text = "Bonjour. Il est huit heures. Tu as trois tâches aujourd'hui."

    chunks = split_for_speech(text, max_chars=35)

    assert chunks == [
        "Bonjour. Il est huit heures.",
        "Tu as trois tâches aujourd'hui.",
    ]
    assert all(len(chunk) <= 35 for chunk in chunks)


def test_long_sentence_is_split_on_word_boundaries() -> None:
    chunks = split_for_speech("un deux trois quatre cinq six sept huit", max_chars=15)

    assert chunks == ["un deux trois", "quatre cinq six", "sept huit"]
    # Splitting never invents or drops words.
    assert " ".join(chunks) == "un deux trois quatre cinq six sept huit"


def test_whitespace_is_normalised() -> None:
    assert split_for_speech("Bonjour\n\n  Cap") == ["Bonjour Cap"]


def test_word_longer_than_the_limit_is_kept_whole() -> None:
    chunks = split_for_speech("anticonstitutionnellement oui", max_chars=10)

    assert chunks == ["anticonstitutionnellement", "oui"]
