"""HTTP routes exposed by the hardware daemon.

The daemon binds to localhost only: the Next.js server is its single client and
proxies whatever the browser needs. Missing hardware is never an error — a
command that cannot run reports ``degraded`` and the interface keeps working.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..runtime import Runtime
from ..services.recorder import RecorderError
from ..services.sounds import available_sounds

logger = logging.getLogger(__name__)

router = APIRouter()


def get_runtime(request: Request) -> Runtime:
    """Return the runtime wired at application startup."""
    return request.app.state.runtime


class StartRecordingRequest(BaseModel):
    """Body of ``POST /record/start``."""

    max_seconds: int | None = Field(default=None, ge=1, le=600)


class SpeakRequest(BaseModel):
    """Body of ``POST /speak``."""

    text: str = Field(min_length=1, max_length=4000)
    interrupt: bool = False


class SoundRequest(BaseModel):
    """Body of ``POST /sound``."""

    name: str
    interrupt: bool = False


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness probe used by the installer and by systemd ordering."""
    return {"status": "ok"}


@router.get("/status")
def status(request: Request) -> dict[str, Any]:
    """Return capabilities and the live state of every hardware service."""
    return get_runtime(request).status()


@router.post("/record/start")
def start_recording(request: Request, body: StartRecordingRequest) -> dict[str, Any]:
    """Begin capturing from the microphone."""
    runtime = get_runtime(request)
    try:
        recording_id = runtime.recorder.start(body.max_seconds)
    except RecorderError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except OSError as error:
        # The microphone vanished between the boot probe and this call.
        logger.warning("could not start capture", exc_info=True)
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"recording_id": recording_id}


@router.post("/record/stop")
def stop_recording(request: Request) -> dict[str, Any]:
    """Finish the capture and return the resulting file."""
    runtime = get_runtime(request)
    try:
        return runtime.recorder.stop().to_dict()
    except RecorderError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/record/cancel")
def cancel_recording(request: Request) -> dict[str, bool]:
    """Abort the capture and discard the partial file."""
    get_runtime(request).recorder.cancel()
    return {"cancelled": True}


@router.get("/record/{recording_id}/file")
def recording_file(request: Request, recording_id: str) -> FileResponse:
    """Serve a finished capture so the transcription step can read it."""
    path = get_runtime(request).recorder.path_for(recording_id)
    if path is None:
        raise HTTPException(status_code=404, detail="unknown recording")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@router.post("/speak")
def speak(request: Request, body: SpeakRequest) -> dict[str, Any]:
    """Queue something for Cap to say."""
    runtime = get_runtime(request)
    utterance_id = runtime.speech.speak(body.text, interrupt=body.interrupt)
    response: dict[str, Any] = {"utterance_id": utterance_id}
    if not runtime.capabilities.speaker:
        response["degraded"] = runtime.capabilities.reasons.get(
            "speaker", "no speaker available"
        )
    return response


@router.post("/speak/stop")
def stop_speaking(request: Request) -> dict[str, bool]:
    """Interrupt the current utterance and drop whatever is queued."""
    get_runtime(request).speech.stop()
    return {"stopped": True}


@router.post("/sound")
def sound(request: Request, body: SoundRequest) -> dict[str, Any]:
    """Play a short notification sound."""
    runtime = get_runtime(request)
    try:
        utterance_id = runtime.speech.play_sound(body.name, interrupt=body.interrupt)
    except KeyError as error:
        raise HTTPException(
            status_code=400,
            detail=f"unknown sound, expected one of {', '.join(available_sounds())}",
        ) from error
    return {"utterance_id": utterance_id}
