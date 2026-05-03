"""Backward-compatible import shim.

Use api_gateway.anotherme_client instead.
"""

from .anotherme_client import AnotherMeClient, AnotherMeError

__all__ = ["AnotherMeClient", "AnotherMeError"]
