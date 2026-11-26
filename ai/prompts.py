"""Prompts sent to Gemini. They are written to keep the AI in an assistant role: describe, never certify."""

GUARDRAILS = (
    "You assist with a dairy transaction evidence record in Rwanda. Describe only what is visibly present. "
    "Never guess a value that is not clearly legible; use null instead. "
    "Never state or imply that milk is safe, unsafe, adulterated or high quality. "
    "Never state that a payment happened, that money was received, or that a document or photo is genuine. "
    "A human must verify everything you report."
)

IMAGE_SYSTEM = GUARDRAILS + " Reply with one JSON object only, no markdown."

IMAGE_SCHEMA = """{
  "document_type": "lactometer_photo | payment_receipt | collection_receipt | delivery_photo | other | unreadable",
  "legible": true or false,
  "lactometer": {"reading_sg": number or null, "temperature_c": number or null, "confidence": "low | medium | high"},
  "receipt": {"amount_rwf": number or null, "date": "text as shown or null", "reference": "text as shown or null",
              "sender": "text as shown or null", "recipient": "text as shown or null", "provider": "text as shown or null"},
  "visible_text": "short transcription of the most relevant visible text",
  "uncertainties": ["list anything unclear, blurry, cropped, or glare-affected"],
  "notes": "one or two neutral sentences describing what is visible"
}"""


def image_prompt(category):
    return (f"Evidence category chosen by the uploader: {category}.\n"
            "If the image shows a lactometer, read the scale only if the markings and liquid level are clearly legible. "
            "Express the reading as specific gravity (for example 1.028; a scale value of 28 means 1.028). "
            "If it is a payment receipt or screenshot, transcribe the amount, date, reference and names only where clearly visible.\n"
            f"Return JSON with exactly this shape:\n{IMAGE_SCHEMA}")


SUMMARY_SYSTEM = GUARDRAILS + (
    " You are given structured facts about one deal (no names or phone numbers). Compare the agreed terms with the "
    "evidence and records. Reply with one JSON object only, no markdown.")

SUMMARY_SCHEMA = """{
  "summary": "3-6 plain sentences describing where the deal stands",
  "missing_information": ["items the parties still need to provide"],
  "possible_inconsistencies": ["neutral observations that deserve a human check; do not accuse anyone"],
  "questions_for_parties": ["short questions that could clarify the situation"],
  "dispute_help": "if a dispute exists: plain-language explanation of the disagreement and options the parties could discuss; otherwise null"
}"""


def summary_prompt(facts_json, language):
    lang = {"rw": "Kinyarwanda", "fr": "French", "en": "English"}.get(language, "English")
    return (f"Write all text values in {lang}, in simple words suitable for a farmer.\n"
            f"Facts (JSON):\n{facts_json}\n\nReturn JSON with exactly this shape:\n{SUMMARY_SCHEMA}")
