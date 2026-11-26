"""In-app notifications. SMS/WhatsApp delivery can later be added here (see roadmap)."""
from ..common import iso


def notify(db, user_id, message, link=None):
    if user_id:
        db.execute("INSERT INTO notifications (user_id, message, link, created_at) VALUES (?,?,?,?)",
                   (user_id, message, link, iso()))
