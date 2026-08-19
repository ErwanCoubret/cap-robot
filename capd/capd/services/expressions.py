"""Named eye animations.

The firmware protocol carries a pupil coordinate and nothing else, so an
"expression" is a short choreography of positions. Richer states (eyelids,
colours) would need a firmware opcode; the bus interface already accepts
whatever shape those steps take.
"""

from __future__ import annotations

from ..hardware.eyes_bus import Step
from ..vision.geometry import CENTER

#: name -> choreography. Coordinates are in the 240x240 eye space, where
#: (120, 120) is dead centre and the firmware clamps to the pupil's reach.
EXPRESSIONS: dict[str, list[Step]] = {
    "center": [Step(CENTER, CENTER, 0.1)],
    # A quick vertical bounce reads as cheerful.
    "happy": [
        Step(CENTER, CENTER - 35, 0.12),
        Step(CENTER, CENTER + 25, 0.12),
        Step(CENTER, CENTER - 18, 0.12),
        Step(CENTER, CENTER, 0.15),
    ],
    # Eyes drifting up and to the side: working on it.
    "thinking": [
        Step(CENTER - 40, CENTER - 30, 0.35),
        Step(CENTER + 35, CENTER - 30, 0.35),
        Step(CENTER - 25, CENTER - 20, 0.35),
        Step(CENTER, CENTER, 0.2),
    ],
    # Attentive: a small settle towards the listener.
    "listening": [
        Step(CENTER, CENTER + 15, 0.2),
        Step(CENTER, CENTER, 0.2),
    ],
    "look_left": [Step(CENTER - 55, CENTER, 0.4), Step(CENTER, CENTER, 0.1)],
    "look_right": [Step(CENTER + 55, CENTER, 0.4), Step(CENTER, CENTER, 0.1)],
    "wiggle": [
        Step(CENTER - 45, CENTER, 0.12),
        Step(CENTER + 45, CENTER, 0.12),
        Step(CENTER - 30, CENTER, 0.12),
        Step(CENTER + 30, CENTER, 0.12),
        Step(CENTER, CENTER, 0.15),
    ],
}


def available_expressions() -> list[str]:
    """Return the expression names the API accepts."""
    return sorted(EXPRESSIONS)


def steps_for(name: str, duration_ms: int | None = None) -> list[Step]:
    """Return the choreography for ``name``.

    ``duration_ms`` stretches or compresses the animation uniformly, which lets
    the agent hold a "thinking" expression for as long as a tool call takes.

    Raises:
        KeyError: if ``name`` is not a known expression.
    """
    steps = EXPRESSIONS[name]
    if duration_ms is None:
        return list(steps)

    natural = sum(step.hold for step in steps)
    if natural <= 0:
        return list(steps)

    scale = max(0.1, (duration_ms / 1000) / natural)
    return [Step(step.x, step.y, step.hold * scale) for step in steps]
