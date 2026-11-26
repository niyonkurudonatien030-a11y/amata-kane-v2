"""Arrival-time estimates for drivers.

Idea (from the project notes): Google Maps travel times are a trustworthy baseline, but a person's real pace differs
(on foot Maps says 2 h, a jogger needs 1 h 40, most people about 2 h 5). So we:
  1. ask Google for the route time (server side, key never reaches the browser),
  2. multiply by a per-carrier ratio learned from that carrier's own past trips (actual time / predicted time),
  3. store prediction and actual time on every trip, so disputes about delays can be checked against facts.
Without a Google key, a rough rule-of-thumb estimate is used and clearly labelled as such.
"""
import math
from datetime import timedelta
from statistics import median

import requests
from flask import current_app

from ..common import ApiError, iso, now, parse_iso
from .matching import haversine_km

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
MODE_FOR_VEHICLE = {"motorcycle": "TWO_WHEELER", "car": "DRIVE", "truck": "DRIVE", "bicycle": "BICYCLE"}
# ASSUMPTIONS for the fallback only (not measured in Rwanda): replace with pilot data.
FALLBACK_KMH = {"TWO_WHEELER": 30.0, "DRIVE": 30.0, "BICYCLE": 12.0}
DETOUR_FACTOR = 1.35          # roads are longer than the straight line
CACHE_SECONDS = 300           # reuse an estimate for the same place for 5 minutes (saves Google cost)
MIN_TRIPS_FOR_PERSONAL = 3
FACTOR_LIMITS = (0.6, 1.6)    # never trust a personal ratio outside this range


def travel_mode(vehicle_type):
    return MODE_FOR_VEHICLE.get((vehicle_type or "").lower(), "DRIVE")


def google_route(origin, dest, mode):
    """Return (seconds, metres) from the Google Routes API, or None if unavailable/unconfigured."""
    key = current_app.config.get("GOOGLE_MAPS_API_KEY")
    if not key:
        return None
    body = {"origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
            "destination": {"location": {"latLng": {"latitude": dest[0], "longitude": dest[1]}}},
            "travelMode": mode}
    if mode in ("DRIVE", "TWO_WHEELER"):
        body["routingPreference"] = "TRAFFIC_AWARE"   # not allowed for walking/cycling
    try:
        r = requests.post(ROUTES_URL, json=body, timeout=8, headers={
            "Content-Type": "application/json", "X-Goog-Api-Key": key,      # key in a header, never in the URL
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"})
        if r.status_code != 200:
            return None
        route = r.json()["routes"][0]
        return int(float(str(route["duration"]).rstrip("s"))), int(route.get("distanceMeters", 0))
    except (requests.RequestException, KeyError, IndexError, ValueError, TypeError):
        return None


def fallback_route(origin, dest, mode):
    metres = haversine_km(origin[0], origin[1], dest[0], dest[1]) * 1000 * DETOUR_FACTOR
    seconds = metres / 1000 / FALLBACK_KMH.get(mode, 30.0) * 3600
    return max(60, int(round(seconds))), int(round(metres))


def route_time(origin, dest, mode):
    """-> (maps_seconds, distance_m, source, mode_used). Falls back TWO_WHEELER->DRIVE->rough estimate."""
    for m in ([mode, "DRIVE"] if mode == "TWO_WHEELER" else [mode]):
        got = google_route(origin, dest, m)
        if got:
            return got[0], got[1], "google", m
    secs, metres = fallback_route(origin, dest, mode)
    return secs, metres, "estimate", mode


def personal_factor(db, carrier_id):
    """Median of (actual / predicted) over this carrier's last 10 finished trips; needs 3+ trips, else 1.0."""
    if not carrier_id:
        return 1.0, 0
    rows = db.execute("SELECT actual_seconds, maps_seconds FROM trip_estimates WHERE carrier_id=? AND leg='TO_DROPOFF' "
                      "AND actual_seconds IS NOT NULL AND maps_seconds>=120 AND actual_seconds>=60 ORDER BY id DESC LIMIT 10",
                      (carrier_id,)).fetchall()
    if len(rows) < MIN_TRIPS_FOR_PERSONAL:
        return 1.0, len(rows)
    ratio = median(r["actual_seconds"] / r["maps_seconds"] for r in rows)
    return round(min(max(ratio, FACTOR_LIMITS[0]), FACTOR_LIMITS[1]), 2), len(rows)


def _row_json(r, cached=False, trips_used=None):
    exp = parse_iso(r["created_at"]) + timedelta(seconds=r["personal_seconds"])
    return {"leg": r["leg"], "travel_mode": r["travel_mode"], "source": r["source"], "distance_km": round(r["distance_m"] / 1000, 1),
            "maps_minutes": round(r["maps_seconds"] / 60), "personal_minutes": round(r["personal_seconds"] / 60),
            "personal_factor": r["personal_factor"], "trips_used": trips_used, "expected_arrival_at": iso(exp) if r["leg"] == "TO_DROPOFF" else None,
            "actual_minutes": round(r["actual_seconds"] / 60) if r["actual_seconds"] is not None else None,
            "created_at": r["created_at"], "cached": cached,
            "label": ("Google Maps traffic-aware time" if r["source"] == "google" else "Rough estimate (no Google Maps key on the server)")}


def compute(db, tx, user, leg, lat=None, lon=None):
    """Compute (without writing) an arrival estimate. Returns (row_values_dict, cached_row_or_None)."""
    carrier_id = tx["carrier_id"] or (user["id"] if user["role"] == "driver" else None)
    carrier = db.execute("SELECT vehicle_type FROM users WHERE id=?", (carrier_id,)).fetchone() if carrier_id else None
    mode = travel_mode(carrier["vehicle_type"] if carrier else None)
    if leg == "TO_PICKUP":
        if lat is None or lon is None:
            raise ApiError("Share your current location to get the time to the pickup point", 422)
        origin = (lat, lon)
        if tx["pickup_lat"] is None:
            raise ApiError("The pickup point has no GPS position yet. The seller can add it by posting a listing with GPS.", 422)
        dest = (tx["pickup_lat"], tx["pickup_lon"])
    else:
        origin = (lat, lon) if lat is not None and lon is not None else ((tx["pickup_lat"], tx["pickup_lon"]) if tx["pickup_lat"] is not None else None)
        if origin is None:
            raise ApiError("Share your current location to get the trip time", 422)
        if tx["dropoff_lat"] is None:
            raise ApiError("The drop-off place has no GPS position yet. The buyer must set it (use my location).", 422)
        dest = (tx["dropoff_lat"], tx["dropoff_lon"])
    since = iso(now() - timedelta(seconds=CACHE_SECONDS))
    hit = db.execute("SELECT * FROM trip_estimates WHERE transaction_id=? AND leg=? AND carrier_id IS ? AND ROUND(origin_lat,3)=? "
                     "AND ROUND(origin_lon,3)=? AND created_at>=? ORDER BY id DESC LIMIT 1",
                     (tx["id"], leg, carrier_id, round(origin[0], 3), round(origin[1], 3), since)).fetchone()
    factor, n = personal_factor(db, carrier_id)
    if hit:
        return None, _row_json(hit, True, n)
    secs, metres, source, mode_used = route_time(origin, dest, mode)
    vals = {"leg": leg, "carrier_id": carrier_id, "travel_mode": mode_used, "source": source, "origin": origin, "dest": dest,
            "distance_m": metres, "maps_seconds": secs, "personal_factor": factor,
            "personal_seconds": max(60, int(round(secs * factor))), "trips_used": n}
    return vals, None


def store(db, tx_id, user_id, v):
    ts = iso()
    cur = db.execute("INSERT INTO trip_estimates (transaction_id, leg, requested_by, carrier_id, travel_mode, source, origin_lat, origin_lon, "
                     "dest_lat, dest_lon, distance_m, maps_seconds, personal_seconds, personal_factor, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (tx_id, v["leg"], user_id, v["carrier_id"], v["travel_mode"], v["source"], v["origin"][0], v["origin"][1],
                      v["dest"][0], v["dest"][1], v["distance_m"], v["maps_seconds"], v["personal_seconds"], v["personal_factor"], ts))
    return _row_json(db.execute("SELECT * FROM trip_estimates WHERE id=?", (cur.lastrowid,)).fetchone(), False, v["trips_used"])


def ensure_dropoff_estimate(db, tx):
    """At pickup release: make sure a trip estimate exists (rough one if nobody asked Google yet; no network call here)."""
    if tx["pickup_lat"] is None or tx["dropoff_lat"] is None:
        return None
    have = db.execute("SELECT * FROM trip_estimates WHERE transaction_id=? AND leg='TO_DROPOFF' ORDER BY id DESC LIMIT 1", (tx["id"],)).fetchone()
    if have:
        return have
    carrier = db.execute("SELECT vehicle_type FROM users WHERE id=?", (tx["carrier_id"],)).fetchone() if tx["carrier_id"] else None
    mode = travel_mode(carrier["vehicle_type"] if carrier else None)
    o, d = (tx["pickup_lat"], tx["pickup_lon"]), (tx["dropoff_lat"], tx["dropoff_lon"])
    secs, metres = fallback_route(o, d, mode)
    factor, n = personal_factor(db, tx["carrier_id"])
    cur = db.execute("INSERT INTO trip_estimates (transaction_id, leg, requested_by, carrier_id, travel_mode, source, origin_lat, origin_lon, dest_lat, "
                     "dest_lon, distance_m, maps_seconds, personal_seconds, personal_factor, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (tx["id"], "TO_DROPOFF", tx["carrier_id"] or tx["seller_id"], tx["carrier_id"], mode, "estimate", o[0], o[1], d[0], d[1],
                      metres, secs, max(60, int(round(secs * factor))), factor, iso()))
    return db.execute("SELECT * FROM trip_estimates WHERE id=?", (cur.lastrowid,)).fetchone()


def latest(db, tx_id, leg):
    return db.execute("SELECT * FROM trip_estimates WHERE transaction_id=? AND leg=? ORDER BY id DESC LIMIT 1", (tx_id, leg)).fetchone()


def trip_summary(db, tx):
    actual_min = None
    if tx["pickup_at"] and tx["arrived_at"]:
        actual_min = round((parse_iso(tx["arrived_at"]) - parse_iso(tx["pickup_at"])).total_seconds() / 60)
    est = {leg: (_row_json(r) if (r := latest(db, tx["id"], leg)) else None) for leg in ("TO_PICKUP", "TO_DROPOFF")}
    deadline = None
    if tx["pickup_at"] and tx["max_transit_minutes"] and not tx["arrived_at"] and tx["status"] == "IN_TRANSIT":
        deadline = iso(parse_iso(tx["pickup_at"]) + timedelta(minutes=tx["max_transit_minutes"]))
    return {"pickup": {"name": tx["pickup_name"], "latitude": tx["pickup_lat"], "longitude": tx["pickup_lon"]},
            "dropoff": {"name": tx["dropoff_name"], "latitude": tx["dropoff_lat"], "longitude": tx["dropoff_lon"]},
            "max_transit_minutes": tx["max_transit_minutes"], "pickup_at": tx["pickup_at"], "arrived_at": tx["arrived_at"],
            "actual_minutes": actual_min, "deadline_at": deadline, "estimates": est,
            "within_limit": (None if actual_min is None or not tx["max_transit_minutes"] else actual_min <= tx["max_transit_minutes"])}
