"""The OCR engine contract.

PaddleOCR and Google Vision both implement this, and neither knows the other
exists. `pipeline.py` runs the primary, checks confidence, and escalates to the
secondary — which is what makes the fallback a clean swap rather than a tangle
of conditionals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol


class OcrEngine(str, Enum):
    PADDLEOCR = "paddleocr"
    GOOGLE_VISION = "google_vision"


@dataclass(frozen=True)
class TextBlock:
    """One detected run of text, with where it sits on the image.

    Position matters more than it looks. OCR returns blocks in detection order,
    not reading order — on a real fixture PaddleOCR returned
    ['LOT.5F0301', '2028.06.02', 'EXP'], with the EXP label *after* the date it
    labels. Sorting by position before joining is what makes the text readable.
    """

    text: str
    confidence: float
    #: Bounding box as (x_min, y_min, x_max, y_max) in pixels.
    box: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)

    @property
    def top(self) -> float:
        return self.box[1]

    @property
    def left(self) -> float:
        return self.box[0]

    @property
    def height(self) -> float:
        return max(self.box[3] - self.box[1], 1.0)


@dataclass
class OcrResult:
    engine: OcrEngine
    blocks: list[TextBlock] = field(default_factory=list)
    duration_ms: int = 0
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.error is None and bool(self.blocks)

    @property
    def confidence(self) -> float:
        """Mean block confidence — how sure the engine is it read *something*.

        Separate from the parser's confidence in the date it extracted.
        """
        if not self.blocks:
            return 0.0
        return sum(b.confidence for b in self.blocks) / len(self.blocks)

    @property
    def text(self) -> str:
        """Blocks joined in reading order: top to bottom, then left to right.

        Blocks whose vertical centres are within half a line height are treated
        as the same line, so a date and its label stay together even when the
        engine reports them separately.
        """
        if not self.blocks:
            return ""

        ordered = sorted(self.blocks, key=lambda b: (b.top, b.left))
        lines: list[list[TextBlock]] = []
        for block in ordered:
            if lines and abs(block.top - lines[-1][0].top) < lines[-1][0].height * 0.6:
                lines[-1].append(block)
            else:
                lines.append([block])

        return "\n".join(
            " ".join(b.text for b in sorted(line, key=lambda b: b.left)) for line in lines
        )


class OcrBackend(Protocol):
    """What every engine must provide."""

    name: OcrEngine

    def is_available(self) -> bool:
        """False when the engine's dependencies or credentials are missing."""
        ...

    def read(self, image: bytes) -> OcrResult:
        """Extract text. Must not raise; failures come back as OcrResult.error."""
        ...
