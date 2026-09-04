# =============================================================================
# Expiry Guardian API - Cloud Run image
#
# The ML layer is installed BEFORE the app code so that editing a route does not
# rebuild the ~1.5 GB PaddleOCR layer. Keep it that way; it is the difference
# between a 20-second rebuild and a 10-minute one on demo day.
# =============================================================================

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # PaddleOCR downloads its models at first use; bake them into a writable path.
    HOME=/app

WORKDIR /app

# System libraries:
#   libgl1, libglib2.0-0 -> OpenCV
#   libgomp1             -> PaddlePaddle OpenMP runtime
#   libzbar0             -> pyzbar barcode decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libzbar0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# --- Dependency layers (cached independently of app code) --------------------
COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir -r requirements-ml.txt

# --- Application code --------------------------------------------------------
COPY app ./app

# Cloud Run injects PORT; default matches local development.
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

# Single worker: Cloud Run scales by adding instances, not processes, and a
# second worker would double the PaddleOCR model memory inside one container.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive 65
