"""
TerraAI Auth & Entitlements — Supabase JWT verification + paywall.
==================================================================
Verifies the Bearer token from the frontend against the Supabase JWT
secret and looks up `is_paid` per `property_id` in the
`paid_properties` table (Supabase REST → service-role).

ZERO HALLUCINATION POLICY:
  - If JWT cannot be verified → 401 (no silent downgrade).
  - If Supabase env missing → server returns "anonymous" identity so the
    public Base Valuation flow still works without leaking premium data.
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx
import jwt
from fastapi import Header, HTTPException, status

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Identity:
    """Authenticated caller identity (anonymous if user_id is None)."""
    user_id: Optional[str]
    email: Optional[str]


def _supabase_url() -> Optional[str]:
    return os.environ.get("SUPABASE_URL")


def _supabase_service_key() -> Optional[str]:
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def _supabase_jwt_secret() -> Optional[str]:
    return os.environ.get("SUPABASE_JWT_SECRET")


def hash_property_id(*, address: str, city: str) -> str:
    """
    Deterministic property_id derived from address + city.
    Used as the entitlement key in `paid_properties`.
    """
    norm = f"{address.strip().lower()}|{city.strip().lower()}"
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:32]


async def get_identity(
    authorization: Optional[str] = Header(default=None),
) -> Identity:
    """
    FastAPI dependency. Returns Identity(None, None) when no token is
    supplied (anonymous, base-valuation only). Raises 401 if a token is
    supplied but invalid.
    """
    if not authorization:
        return Identity(user_id=None, email=None)

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return Identity(user_id=None, email=None)

    secret = _supabase_jwt_secret()
    if not secret:
        # Auth not configured server-side — refuse rather than silently trust.
        logger.warning("SUPABASE_JWT_SECRET missing — rejecting bearer token.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth not configured",
        )

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        ) from exc

    return Identity(
        user_id=str(payload.get("sub")) if payload.get("sub") else None,
        email=payload.get("email"),
    )


async def is_property_paid(*, user_id: str, property_id: str) -> bool:
    """
    Query the Supabase `paid_properties` table via REST for an active
    `is_paid` row matching (user_id, property_id).

    Schema expected (idempotent SQL, see README):
        create table public.paid_properties (
          user_id     uuid     not null,
          property_id text     not null,
          is_paid     boolean  not null default false,
          stripe_session_id text,
          created_at  timestamptz not null default now(),
          primary key (user_id, property_id)
        );
    """
    url  = _supabase_url()
    key  = _supabase_service_key()
    if not url or not key:
        logger.warning("Supabase entitlements disabled — env not configured.")
        return False

    endpoint = f"{url.rstrip('/')}/rest/v1/paid_properties"
    headers  = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Accept":        "application/json",
    }
    params = {
        "user_id":     f"eq.{user_id}",
        "property_id": f"eq.{property_id}",
        "is_paid":     "eq.true",
        "select":      "is_paid",
        "limit":       "1",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(endpoint, headers=headers, params=params)
        if res.status_code != 200:
            logger.warning("Supabase entitlement lookup %s: %s",
                           res.status_code, res.text)
            return False
        rows = res.json()
        return bool(rows) and bool(rows[0].get("is_paid"))
    except httpx.HTTPError as exc:
        logger.warning("Supabase entitlement HTTP error: %s", exc)
        return False


async def mark_property_paid(
    *,
    user_id:           str,
    property_id:       str,
    stripe_session_id: str,
) -> bool:
    """
    Upsert `is_paid: true` for (user_id, property_id) in Supabase via REST.
    Called from the Stripe webhook after `checkout.session.completed`.
    """
    url = _supabase_url()
    key = _supabase_service_key()
    if not url or not key:
        logger.error("Cannot mark paid — Supabase env not configured.")
        return False

    endpoint = f"{url.rstrip('/')}/rest/v1/paid_properties"
    headers  = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates,return=minimal",
    }
    body = [{
        "user_id":           user_id,
        "property_id":       property_id,
        "is_paid":           True,
        "stripe_session_id": stripe_session_id,
    }]

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(endpoint, headers=headers, json=body)
        if res.status_code not in (200, 201, 204):
            logger.error("Supabase upsert failed %s: %s",
                         res.status_code, res.text)
            return False
        return True
    except httpx.HTTPError as exc:
        logger.error("Supabase upsert HTTP error: %s", exc)
        return False
