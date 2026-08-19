"""HTTP routes exposed by the hardware daemon.

The daemon binds to localhost only: the Next.js server is its single client and
proxies whatever the browser needs. Missing hardware is never an error — a
command that cannot run reports ``degraded`` and the interface keeps working.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..runtime import Runtime
from ..services.expressions import available_expressions, steps_for
from ..services.recorder import RecorderError
from ..services.sounds import available_sounds
from ..vision.preview import PREVIEW_FPS

logger = logging.getLogger(__name__)

router = APIRouter()

#: Boundary of the multipart stream carrying the preview frames.
MJPEG_BOUNDARY = "capframe"


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


class CameraSettingsRequest(BaseModel):
    """Body of ``POST /camera/settings``."""

    vflip: bool | None = None
    tracking: bool | None = None


class ExpressionRequest(BaseModel):
    """Body of ``POST /eyes/expression``."""

    name: str
    duration_ms: int | None = Field(default=None, ge=100, le=30000)


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


@router.post("/tracking/start")
def start_tracking(request: Request) -> dict[str, Any]:
    """Follow faces with the eyes."""
    runtime = get_runtime(request)
    runtime.camera.set_tracking(True)
    return _tracking_response(runtime)


@router.post("/tracking/stop")
def stop_tracking(request: Request) -> dict[str, Any]:
    """Stop following faces."""
    runtime = get_runtime(request)
    runtime.camera.set_tracking(False)
    return _tracking_response(runtime)


def _tracking_response(runtime: Runtime) -> dict[str, Any]:
    """Describe tracking state, naming what is missing rather than failing."""
    response: dict[str, Any] = runtime.camera.status()["tracking"]
    missing = [
        part
        for part, present in (("camera", runtime.camera.available), ("eyes", runtime.eyes is not None))
        if not present
    ]
    if missing:
        response["degraded"] = f"no {' and no '.join(missing)}"
    return response


@router.post("/camera/settings")
def camera_settings(request: Request, body: CameraSettingsRequest) -> dict[str, Any]:
    """Flip the camera image and/or toggle face tracking."""
    runtime = get_runtime(request)
    if body.vflip is not None:
        runtime.camera.set_vflip(body.vflip)
    if body.tracking is not None:
        runtime.camera.set_tracking(body.tracking)
    return runtime.camera.status()


@router.get("/camera/snapshot")
async def camera_snapshot(request: Request) -> Response:
    """Return a single preview frame.

    A cheap alternative to the stream, and the fallback if a long-lived
    multipart response misbehaves in the kiosk browser.
    """
    runtime = get_runtime(request)
    if not runtime.camera.available:
        raise HTTPException(status_code=503, detail="no camera on this machine")

    runtime.camera.add_viewer()
    try:
        deadline = asyncio.get_running_loop().time() + 3.0
        while asyncio.get_running_loop().time() < deadline:
            _, jpeg = runtime.preview.latest()
            if jpeg is not None:
                return Response(content=jpeg, media_type="image/jpeg")
            await asyncio.sleep(0.05)
    finally:
        runtime.camera.remove_viewer()

    raise HTTPException(status_code=503, detail="no frame available")


@router.get("/camera/preview")
async def camera_preview(request: Request) -> StreamingResponse:
    """Stream the camera as MJPEG for as long as the client stays connected."""
    runtime = get_runtime(request)
    if not runtime.camera.available:
        raise HTTPException(status_code=503, detail="no camera on this machine")

    async def frames() -> AsyncIterator[bytes]:
        # Subscribing starts the sensor; the finally block below is what
        # releases it when the settings screen is closed.
        runtime.camera.add_viewer()
        last_revision = -1
        try:
            while True:
                if await request.is_disconnected():
                    return
                revision, jpeg = runtime.preview.latest()
                if jpeg is not None and revision != last_revision:
                    last_revision = revision
                    yield (
                        f"--{MJPEG_BOUNDARY}\r\n"
                        f"Content-Type: image/jpeg\r\n"
                        f"Content-Length: {len(jpeg)}\r\n\r\n"
                    ).encode() + jpeg + b"\r\n"
                await asyncio.sleep(1.0 / (PREVIEW_FPS * 2))
        finally:
            runtime.camera.remove_viewer()

    return StreamingResponse(
        frames(),
        media_type=f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}",
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


@router.post("/eyes/expression")
def eyes_expression(request: Request, body: ExpressionRequest) -> dict[str, Any]:
    """Play a named eye animation, briefly overriding face tracking."""
    runtime = get_runtime(request)
    try:
        steps = steps_for(body.name, body.duration_ms)
    except KeyError as error:
        raise HTTPException(
            status_code=400,
            detail=f"unknown expression, expected one of {', '.join(available_expressions())}",
        ) from error

    if runtime.eyes is None:
        return {"played": False, "degraded": "no eyes connected"}

    runtime.eyes.play(steps)
    return {"played": True, "name": body.name}
