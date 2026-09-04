"""Structured JSON logging.

Cloud Logging parses stdout JSON and promotes `severity` and `message`, so
filtering by level in the GCP console works without extra configuration.
"""

import json
import logging
import sys
from datetime import datetime, timezone

from app.config import get_settings

_LEVEL_TO_SEVERITY = {
    "DEBUG": "DEBUG",
    "INFO": "INFO",
    "WARNING": "WARNING",
    "ERROR": "ERROR",
    "CRITICAL": "CRITICAL",
}

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "asctime",
    "message",
    "taskName",
}


class CloudJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "severity": _LEVEL_TO_SEVERITY.get(record.levelname, "DEFAULT"),
            "message": record.getMessage(),
            "logger": record.name,
            "time": datetime.now(timezone.utc).isoformat(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # Anything passed via logger.info("x", extra={...}) rides along.
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)

    if settings.environment == "local":
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-8s %(name)s | %(message)s")
        )
    else:
        handler.setFormatter(CloudJsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())

    # uvicorn duplicates records onto its own handlers; let ours own the output.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True
