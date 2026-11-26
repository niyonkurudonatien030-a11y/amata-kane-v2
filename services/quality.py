"""Quality gate: compares a lactometer reading with the range the two parties wrote into their deal.

IMPORTANT: this is NOT a food-safety decision. AmataShield never decides what is "safe" milk.
It only compares a human-entered number with numbers the parties themselves agreed on.
"""


def evaluate(reading_sg, temperature_c, photo_legible, tx):
    """Return (result, detail) for a quality check against a transaction row."""
    if not photo_legible:
        return "REDO_REQUIRED", "The photo is not clear enough. Retake it so the whole scale is visible."
    if reading_sg is None:
        return "REDO_REQUIRED", "Enter the reading you see on the lactometer scale."
    return _compare(reading_sg, temperature_c, tx["min_lactometer"], tx["max_lactometer"], tx["max_temperature_c"])


def _compare(reading, temp, lo, hi, tmax):
    if lo is None and hi is None and tmax is None:
        return "NO_AGREED_RANGE", ("No quality range was agreed in this deal. The record is saved; "
                                   "the buyer decides on delivery.")
    problems = []
    if lo is not None and reading < lo:
        problems.append(f"reading {reading:.3f} is below the agreed minimum {lo:.3f}")
    if hi is not None and reading > hi:
        problems.append(f"reading {reading:.3f} is above the agreed maximum {hi:.3f}")
    if tmax is not None and temp is not None and temp > tmax:
        problems.append(f"temperature {temp:g}\u00b0C is above the agreed maximum {tmax:g}\u00b0C")
    if problems:
        return "OUTSIDE_AGREED_RANGE", "; ".join(problems).capitalize() + ". The buyer must decide before delivery."
    return "WITHIN_AGREED_RANGE", "The entered reading is inside the range agreed in this deal (not a safety certificate)."
