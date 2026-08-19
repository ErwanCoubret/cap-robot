"""Preview encoding."""

from __future__ import annotations

import numpy

from capd.vision.geometry import frame_box_to_model
from capd.vision.preview import PREVIEW_HEIGHT, PREVIEW_WIDTH, PreviewStream

FRAME_W, FRAME_H = 640, 480


def gradient_frame():
    """A frame whose top half is bright and bottom half dark."""
    image = numpy.zeros((FRAME_H, FRAME_W, 3), dtype=numpy.uint8)
    image[: FRAME_H // 2] = 230
    return image


def decode(jpeg: bytes):
    import io

    from PIL import Image

    return Image.open(io.BytesIO(jpeg))


def test_nothing_is_encoded_before_a_frame_arrives() -> None:
    assert PreviewStream().latest() == (0, None)


def test_publish_produces_a_jpeg_of_the_expected_size() -> None:
    stream = PreviewStream()
    stream.publish(gradient_frame(), FRAME_W, FRAME_H, vflip=False)

    revision, jpeg = stream.latest()

    assert revision == 1
    assert jpeg is not None and jpeg[:2] == b"\xff\xd8"  # JPEG magic
    assert decode(jpeg).size == (PREVIEW_WIDTH, PREVIEW_HEIGHT)


def test_revision_changes_on_every_frame() -> None:
    stream = PreviewStream()
    stream.publish(gradient_frame(), FRAME_W, FRAME_H, vflip=False)
    first, _ = stream.latest()
    stream.publish(gradient_frame(), FRAME_W, FRAME_H, vflip=False)
    second, _ = stream.latest()

    assert second != first


def test_vflip_turns_the_image_upside_down() -> None:
    upright = PreviewStream()
    upright.publish(gradient_frame(), FRAME_W, FRAME_H, vflip=False)
    flipped = PreviewStream()
    flipped.publish(gradient_frame(), FRAME_W, FRAME_H, vflip=True)

    upright_image = decode(upright.latest()[1]).convert("L")
    flipped_image = decode(flipped.latest()[1]).convert("L")

    assert upright_image.getpixel((160, 20)) > upright_image.getpixel((160, 220))
    assert flipped_image.getpixel((160, 20)) < flipped_image.getpixel((160, 220))


def test_detection_box_is_drawn() -> None:
    plain = PreviewStream()
    plain.publish(numpy.zeros((FRAME_H, FRAME_W, 3), dtype=numpy.uint8), FRAME_W, FRAME_H, False)

    annotated = PreviewStream()
    box = frame_box_to_model((200.0, 150.0, 400.0, 330.0), FRAME_W, FRAME_H)
    annotated.publish(
        numpy.zeros((FRAME_H, FRAME_W, 3), dtype=numpy.uint8), FRAME_W, FRAME_H, False, box
    )

    # The overlay is the only difference, so the encoded bytes must differ.
    assert annotated.latest()[1] != plain.latest()[1]


def test_subscribers_are_counted_and_the_frame_is_dropped_when_the_last_leaves() -> None:
    stream = PreviewStream()
    stream.subscribe()
    stream.subscribe()
    stream.publish(gradient_frame(), FRAME_W, FRAME_H, vflip=False)

    assert stream.watching is True
    assert stream.subscribers == 2

    stream.unsubscribe()
    assert stream.latest()[1] is not None

    stream.unsubscribe()
    assert stream.watching is False
    assert stream.latest()[1] is None


def test_unsubscribe_never_goes_negative() -> None:
    stream = PreviewStream()
    stream.unsubscribe()

    assert stream.subscribers == 0


def test_broken_frames_are_swallowed() -> None:
    stream = PreviewStream()
    stream.publish("not an image", FRAME_W, FRAME_H, vflip=False)

    assert stream.latest() == (0, None)
