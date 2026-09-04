"""Application settings, loaded from environment / .env.

Deliberately does NOT hard-fail at import time on missing credentials: we want the
container to boot and serve /health on Cloud Run even before every secret is wired
up. Readiness (/health/ready) is what reports missing configuration.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Runtime -----------------------------------------------------------
    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"
    port: int = 8080
    api_v1_prefix: str = "/v1"
    # Comma-separated. Expo dev clients hit this from arbitrary LAN origins.
    cors_origins: str = "*"

    # --- Supabase ----------------------------------------------------------
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    # Only needed for legacy HS256 projects. New projects use asymmetric JWKS.
    supabase_jwt_secret: str = ""
    supabase_jwt_aud: str = "authenticated"

    # --- Cloudinary --------------------------------------------------------
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_upload_folder: str = "expiry-guardian"

    # --- Google Vision (fallback OCR) --------------------------------------
    google_application_credentials: str = ""
    vision_enabled: bool = True

    # --- OCR pipeline ------------------------------------------------------
    ocr_primary_engine: Literal["paddleocr", "google_vision"] = "paddleocr"
    # Below this, pipeline.py escalates to the secondary engine.
    ocr_confidence_threshold: float = 0.65
    ocr_max_image_bytes: int = 8 * 1024 * 1024

    # --- Firebase Cloud Messaging ------------------------------------------
    fcm_service_account_json: str = ""
    fcm_enabled: bool = True

    # --- Internal / scheduler ----------------------------------------------
    internal_sweep_secret: str = ""
    default_timezone: str = "Asia/Kuala_Lumpur"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    def missing_required(self) -> list[str]:
        """Env vars without which the API cannot serve real traffic."""
        required = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_ANON_KEY": self.supabase_anon_key,
            "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
        }
        return sorted(k for k, v in required.items() if not v)


@lru_cache
def get_settings() -> Settings:
    return Settings()
