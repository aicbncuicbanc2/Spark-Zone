"""Shared pytest configuration.

pydantic-settings reads .env into the Settings object, but not into os.environ.
The integration tests need one value that deliberately lives outside the app
config — the dev-account password — so load .env into the process environment
here. This repository is public; that password must never be committed.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
