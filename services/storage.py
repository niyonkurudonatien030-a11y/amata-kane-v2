"""Evidence file storage. Original bytes are written once and never modified."""
import hashlib
import uuid
from pathlib import Path

from ..common import ApiError

# Real file type is decided from the first bytes ("magic numbers"), not from the filename the user sent.
SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"%PDF-", "application/pdf", ".pdf"),
]


def detect_type(data: bytes):
    for sig, mime, ext in SIGNATURES:
        if data.startswith(sig):
            return mime, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    raise ApiError("Unsupported file. Upload a JPEG, PNG, WEBP image or a PDF.", 415)


def save_evidence_file(evidence_dir, tx_public_id, data: bytes, max_bytes):
    if not data:
        raise ApiError("The uploaded file is empty", 422)
    if len(data) > max_bytes:
        raise ApiError(f"File is too large (max {max_bytes // (1024 * 1024)} MB)", 413)
    mime, ext = detect_type(data)
    folder = Path(evidence_dir) / tx_public_id
    folder.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    path = folder / stored
    with open(path, "xb") as fh:  # "x" = fail if the file already exists, so nothing is overwritten
        fh.write(data)
    return {"stored_filename": f"{tx_public_id}/{stored}", "mime_type": mime,
            "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def resolve_path(evidence_dir, stored_filename):
    base = Path(evidence_dir).resolve()
    p = (base / stored_filename).resolve()
    if base not in p.parents:  # protects against path tricks like ../../
        raise ApiError("Invalid file path", 400)
    return p
