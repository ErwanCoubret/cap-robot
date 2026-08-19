"""Hardware adapters.

Each device is described by a small abstract base class with a real
implementation and a mock one. Selecting between them is the composition
root's job, never the caller's.
"""
