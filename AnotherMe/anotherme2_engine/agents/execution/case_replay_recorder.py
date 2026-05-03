"""
Persist execution case records for iterative improvement.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict


class CaseReplayRecorder:
    """Store compact case records under debug/case_records."""

    def record(self, *, output_dir: Path, payload: Dict[str, Any]) -> str:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        case_id = f"case_{timestamp}"

        record = dict(payload)
        record.setdefault("case_id", case_id)
        record.setdefault("recorded_at", datetime.now().isoformat(timespec="seconds"))

        case_dir = Path(output_dir) / "debug" / "case_records"
        case_dir.mkdir(parents=True, exist_ok=True)
        path = case_dir / f"{case_id}.json"
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(path)
