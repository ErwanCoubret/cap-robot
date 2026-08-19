"""Cap robot hardware daemon.

Owns every physical device on the robot (camera, eyes serial link, microphone,
speaker) and exposes them over a small local HTTP + WebSocket API. Nothing else
in the system is allowed to touch the hardware directly, because the IMX500
sensor and the ESP32 serial port each accept exactly one owner.
"""

__version__ = "0.1.0"
