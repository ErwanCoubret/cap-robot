"""Text helpers shared by the speech services."""

from __future__ import annotations

import re

#: Split after sentence punctuation followed by whitespace.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?…:])\s+")

#: Longer than this and synthesis takes long enough that the robot feels stuck
#: before the first word comes out.
DEFAULT_MAX_CHARS = 160


def split_for_speech(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> list[str]:
    """Split ``text`` into chunks that can be synthesised one after another.

    Speaking is chunked so playback can start while the rest is still being
    rendered — on the Pi, synthesising a long paragraph in one go leaves a long
    silence the user reads as a failure. Sentences are kept intact when they
    fit; an over-long sentence is broken on word boundaries as a last resort.
    """
    normalised = " ".join(text.split())
    if not normalised:
        return []

    chunks: list[str] = []
    buffer = ""

    for sentence in _SENTENCE_BOUNDARY.split(normalised):
        if not sentence:
            continue
        if len(sentence) > max_chars:
            if buffer:
                chunks.append(buffer)
                buffer = ""
            chunks.extend(_split_words(sentence, max_chars))
            continue

        candidate = f"{buffer} {sentence}".strip()
        if len(candidate) <= max_chars:
            buffer = candidate
        else:
            if buffer:
                chunks.append(buffer)
            buffer = sentence

    if buffer:
        chunks.append(buffer)
    return chunks


def _split_words(sentence: str, max_chars: int) -> list[str]:
    chunks: list[str] = []
    buffer = ""
    for word in sentence.split(" "):
        candidate = f"{buffer} {word}".strip()
        if len(candidate) <= max_chars:
            buffer = candidate
            continue
        if buffer:
            chunks.append(buffer)
        # A single word longer than the limit is rare; keep it whole rather
        # than slicing it into unpronounceable fragments.
        buffer = word
    if buffer:
        chunks.append(buffer)
    return chunks
