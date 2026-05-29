"""
TerraAI Database Schema — models/database.py
=============================================
PostgreSQL tables via SQLAlchemy 2.x + GeoAlchemy2.

Tables:
    Organization    — corporate developer accounts with API credit ledger
    User            — platform users linked to an Organization (ANALYST / PRINCIPAL)
    Audit           — immutable engine-run records (NBE valuation snapshots)
    SavedProperty   — user bookmarks for ongoing LINZ parcel monitoring
    Properties      — core property records with PostGIS geometry
    Valuations      — per-request valuation snapshots (child of Property)
    ZoningRules     — council zoning polygons (AUP / NSW LEP)
    FloodData       — flood-risk zone polygons
    Waitlist        — early-access registrations

Relationship chain:
    Organization ─< User ─< Audit
                         └─< SavedProperty

DISCLAIMER:
    This schema is NOT a property register or certified data source.
    See LAWYER_SHIELD.md for the full legal framework.

Run migrations with Alembic:
    alembic revision --autogenerate -m "initial schema"
    alembic upgrade head
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


# ─── Declarative Base ─────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ─── Helper ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─── Tables ───────────────────────────────────────────────────────────────────

class Property(Base):
    """
    Core property record created when a user submits an address.

    Geometry columns use WGS-84 / EPSG:4326 throughout.
    Parcel ID and boundaries are populated by the GIS service in Phase 2.
    """

    __tablename__ = "properties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Address ────────────────────────────────────────────────────────────
    address      = Column(String(300), nullable=False)
    suburb       = Column(String(100), nullable=False)
    city         = Column(String(50),  nullable=False, default="Auckland")
    country_code = Column(String(2),   nullable=False, default="NZ")  # ISO 3166-1

    # ── Cadastre (populated by GIS service) ────────────────────────────────
    parcel_id    = Column(String(100), nullable=True, index=True)   # LINZ ID or NSW CADID
    title_ref    = Column(String(100), nullable=True)               # LINZ title / Lot-DP

    # ── Geometry (WGS-84 / EPSG:4326) ──────────────────────────────────────
    location         = Column(Geometry(geometry_type="POINT",   srid=4326), nullable=True)
    parcel_boundary  = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=True)

    # ── Property Details ───────────────────────────────────────────────────
    sqm           = Column(Float,   nullable=True)   # floor area m²
    land_area_sqm = Column(Float,   nullable=True)   # land area m²
    beds          = Column(Integer, nullable=True)
    baths         = Column(Integer, nullable=True)

    era = Column(
        Enum(
            "pre-1940", "1940s-1960s", "1970s-1990s",
            "2000s-2010s", "2010s-present",
            name="property_era_enum",
        ),
        nullable=True,
    )

    condition = Column(
        Enum("excellent", "good", "fair", "poor", name="property_condition_enum"),
        nullable=True,
    )

    # ── Timestamps ─────────────────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=True,  default=_now, onupdate=_now)

    # ── Relationships ──────────────────────────────────────────────────────
    valuations = relationship(
        "Valuation", back_populates="property", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_properties_location",        "location",        postgresql_using="gist"),
        Index("ix_properties_parcel_boundary", "parcel_boundary", postgresql_using="gist"),
        Index("ix_properties_suburb_city",     "suburb", "city"),
    )

    def __repr__(self) -> str:
        return f"<Property id={self.id} address={self.address!r}>"


class Valuation(Base):
    """
    Snapshot of one valuation run for a Property.

    Stores the final figures plus a JSON snapshot of the GIS inputs
    used so results can be audited or replayed.
    """

    __tablename__ = "valuations"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    property_id = Column(
        UUID(as_uuid=True),
        ForeignKey("properties.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ── Figures ────────────────────────────────────────────────────────────
    estimated_value_nzd = Column(BigInteger, nullable=True)
    estimated_value_aud = Column(BigInteger, nullable=True)
    price_per_sqm       = Column(Float,      nullable=True)
    confidence_score    = Column(Integer,    nullable=True)
    risk_level          = Column(
        Enum("low", "medium", "high", name="risk_level_enum"), nullable=True
    )

    # ── Factor breakdown ───────────────────────────────────────────────────
    condition_multiplier = Column(Float, nullable=True)
    era_factor           = Column(Float, nullable=True)
    flood_discount       = Column(Float, nullable=True)
    zoning_multiplier    = Column(Float, nullable=True)

    # ── Audit trail ────────────────────────────────────────────────────────
    engine_version    = Column(String(20), nullable=False, default="0.2.0")
    gis_data_snapshot = Column(Text,       nullable=True)   # JSON snapshot of GIS inputs

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    # ── Relationships ──────────────────────────────────────────────────────
    property = relationship("Property", back_populates="valuations")

    def __repr__(self) -> str:
        return (
            f"<Valuation id={self.id} "
            f"property_id={self.property_id} "
            f"value={self.estimated_value_nzd}>"
        )


class ZoningRule(Base):
    """
    Council zoning polygons ingested from:
        NZ  — Auckland Unitary Plan (AUP) via Auckland Council WFS
        AU  — Local Environmental Plans (LEP) via NSW Planning Portal

    Populated by the Phase 2 data ingestion pipeline.
    """

    __tablename__ = "zoning_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Identification ─────────────────────────────────────────────────────
    zone_code    = Column(String(50),  nullable=False)   # e.g., "MHU", "R2"
    zone_name    = Column(String(200), nullable=False)   # e.g., "Mixed Housing Urban"
    jurisdiction = Column(String(10),  nullable=False)   # "NZ" | "AU"
    council_name = Column(String(100), nullable=True)    # e.g., "Auckland Council"
    plan_name    = Column(String(200), nullable=True)    # e.g., "Auckland Unitary Plan 2016"

    # ── Development Controls ───────────────────────────────────────────────
    max_height_m          = Column(Float, nullable=True)
    max_site_coverage_pct = Column(Float, nullable=True)
    min_lot_size_sqm      = Column(Float, nullable=True)
    min_front_setback_m   = Column(Float, nullable=True)
    min_side_setback_m    = Column(Float, nullable=True)
    min_rear_setback_m    = Column(Float, nullable=True)
    floor_area_ratio      = Column(Float, nullable=True)   # FAR / GFA ratio

    # ── Geometry (WGS-84 / EPSG:4326) ──────────────────────────────────────
    boundary = Column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=True)

    # ── Provenance ─────────────────────────────────────────────────────────
    source_url         = Column(Text,    nullable=True)
    data_vintage_year  = Column(Integer, nullable=True)
    is_active          = Column(Integer, nullable=False, default=1)

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=True,  default=_now, onupdate=_now)

    __table_args__ = (
        Index("ix_zoning_rules_boundary", "boundary", postgresql_using="gist"),
        Index("ix_zoning_rules_jurisdiction", "jurisdiction"),
        UniqueConstraint(
            "zone_code", "jurisdiction", "council_name",
            name="uq_zoning_jurisdiction_council",
        ),
    )

    def __repr__(self) -> str:
        return f"<ZoningRule {self.zone_code!r} [{self.jurisdiction}]>"


class FloodData(Base):
    """
    Flood-risk zone polygons ingested from:
        NZ  — Auckland Council GIS flood-plain layers
        AU  — NSW Flood Data Portal

    Populated by the Phase 2 data ingestion pipeline.
    """

    __tablename__ = "flood_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Identification ─────────────────────────────────────────────────────
    flood_zone_code = Column(String(50), nullable=False)   # e.g., "FZ100", "HIGH"
    risk_level      = Column(
        Enum("low", "medium", "high", name="flood_risk_enum"), nullable=False
    )
    jurisdiction = Column(String(10),  nullable=False)     # "NZ" | "AU"
    council_name = Column(String(100), nullable=True)

    # ── Annual Exceedance Probability ──────────────────────────────────────
    aep_pct       = Column(Float, nullable=True)   # e.g., 1.0 = 1% AEP (100-year event)
    flood_depth_m = Column(Float, nullable=True)   # estimated max inundation depth

    # ── Geometry (WGS-84 / EPSG:4326) ──────────────────────────────────────
    flood_extent = Column(
        Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False
    )

    # ── Provenance ─────────────────────────────────────────────────────────
    source_dataset    = Column(String(200), nullable=False)   # e.g., "Auckland Council GIS v2025"
    source_url        = Column(Text,        nullable=True)
    data_vintage_date = Column(DateTime(timezone=True), nullable=True)
    is_active         = Column(Integer, nullable=False, default=1)

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    __table_args__ = (
        Index("ix_flood_data_extent",       "flood_extent", postgresql_using="gist"),
        Index("ix_flood_data_jurisdiction", "jurisdiction"),
        Index("ix_flood_data_risk_level",   "risk_level"),
    )

    def __repr__(self) -> str:
        return (
            f"<FloodData {self.flood_zone_code!r} "
            f"risk={self.risk_level} [{self.jurisdiction}]>"
        )


class Waitlist(Base):
    """
    Early-access waitlist signups.

    Tier segmentation allows targeted onboarding communications.
    """

    __tablename__ = "waitlist"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Contact ────────────────────────────────────────────────────────────
    email = Column(String(254), nullable=False)
    name  = Column(String(200), nullable=True)

    # ── Segmentation ───────────────────────────────────────────────────────
    suburb          = Column(String(100), nullable=True)
    city            = Column(String(50),  nullable=True)
    country_code    = Column(String(2),   nullable=True, default="NZ")
    tier_interest   = Column(
        Enum(
            "tier_1", "tier_2", "tier_3", "tier_4", "tier_5",
            name="tier_interest_enum",
        ),
        nullable=True,
    )
    referral_source = Column(String(100), nullable=True)   # "trademe" | "google" | "word_of_mouth"

    # ── Notification Status ────────────────────────────────────────────────
    is_notified  = Column(Integer,              nullable=False, default=0)
    notified_at  = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    __table_args__ = (
        UniqueConstraint("email", name="uq_waitlist_email"),
        Index("ix_waitlist_tier_interest", "tier_interest"),
        Index("ix_waitlist_created_at",    "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Waitlist id={self.id} email={self.email!r}>"


# ─── Account & Engine Audit Tables ───────────────────────────────────────────

class Organization(Base):
    """
    Corporate developer account.

    api_credits acts as a prepaid ledger: each engine run debits one credit.
    A credit of -1 signals unlimited access (internal / enterprise tier).
    """

    __tablename__ = "organizations"

    id   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)

    # ── Credit ledger ──────────────────────────────────────────────────────
    api_credits = Column(
        Integer, nullable=False, default=0,
        comment="Remaining engine-run credits. -1 = unlimited.",
    )

    is_active  = Column(Integer,               nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=True,  default=_now, onupdate=_now)

    # ── Relationships ──────────────────────────────────────────────────────
    users            = relationship(
        "User", back_populates="organization", cascade="all, delete-orphan",
    )
    audits           = relationship(
        "Audit", back_populates="organization", cascade="all, delete-orphan",
    )
    saved_properties = relationship(
        "SavedProperty", back_populates="organization", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_organizations_name", "name"),
    )

    def __repr__(self) -> str:
        return f"<Organization id={self.id} name={self.name!r} credits={self.api_credits}>"


class User(Base):
    """
    Platform user belonging to an Organization.

    Roles:
        ANALYST    — read-only access; can run the engine and save properties.
        PRINCIPAL  — full access; can manage org settings and team members.

    Note: if Supabase Auth is used, map supabase_uid to the Supabase
    auth.users.id so this table holds the application-layer profile.
    """

    __tablename__ = "users"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ── Authentication ─────────────────────────────────────────────────────
    email         = Column(String(254), nullable=False)
    password_hash = Column(String(255), nullable=False,
                           comment="bcrypt hash — never store plaintext.")

    # ── Account ────────────────────────────────────────────────────────────
    role = Column(
        Enum("ANALYST", "PRINCIPAL", name="account_role_enum"),
        nullable=False,
        default="ANALYST",
    )
    is_active     = Column(Integer,               nullable=False, default=1)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=True,  default=_now, onupdate=_now)

    # ── Relationships ──────────────────────────────────────────────────────
    organization     = relationship("Organization", back_populates="users")
    audits           = relationship(
        "Audit", back_populates="user", cascade="all, delete-orphan",
    )
    saved_properties = relationship(
        "SavedProperty", back_populates="user", cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        Index("ix_users_organization_id", "organization_id"),
        Index("ix_users_email",           "email"),
        Index("ix_users_role",            "role"),
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} role={self.role}>"


class Audit(Base):
    """
    Immutable record of every TerraAI engine run.

    Written once on successful engine execution; never mutated.
    organization_id is denormalised from the executing user so that
    org-level aggregate queries avoid a join through the users table.
    """

    __tablename__ = "audits"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id         = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ── Property context ───────────────────────────────────────────────────
    address = Column(String(300), nullable=False)
    suburb  = Column(String(100), nullable=False)

    # ── Engine outputs ─────────────────────────────────────────────────────
    gross_area               = Column(Float,      nullable=False,
                                      comment="LINZ calc_area in m².")
    net_buildable_envelope   = Column(Float,      nullable=False,
                                      comment="Gross area minus all GIS deductions, m².")
    true_residual_land_value = Column(BigInteger, nullable=False,
                                      comment="True RLV after slope penalty, NZD.")
    property_status          = Column(String(50), nullable=True,
                                      comment="e.g. 'CRITICAL_DEVELOPMENT_RISK'; null if healthy.")

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    # ── Relationships ──────────────────────────────────────────────────────
    user             = relationship("User",         back_populates="audits")
    organization     = relationship("Organization", back_populates="audits")
    saved_properties = relationship(
        "SavedProperty", back_populates="audit",
    )

    __table_args__ = (
        Index("ix_audits_user_id",         "user_id"),
        Index("ix_audits_organization_id", "organization_id"),
        Index("ix_audits_created_at",      "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<Audit id={self.id} "
            f"user_id={self.user_id} "
            f"rlv={self.true_residual_land_value}>"
        )


class SavedProperty(Base):
    """
    User-bookmarked parcel for ongoing LINZ layer monitoring.

    A unique constraint on (user_id, parcel_id) prevents duplicate bookmarks.
    audit_id links back to the engine run that first surfaced the lot;
    it is nullable so users can save a property without running a full audit.
    """

    __tablename__ = "saved_properties"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id         = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    audit_id        = Column(
        UUID(as_uuid=True),
        ForeignKey("audits.id", ondelete="SET NULL"),
        nullable=True,
        comment="Source audit run; null if bookmarked without a prior engine run.",
    )

    # ── LINZ parcel reference ──────────────────────────────────────────────
    parcel_id = Column(String(100), nullable=False,
                       comment="LINZ parcel_id from Layer 50772.")
    address   = Column(String(300), nullable=False)
    suburb    = Column(String(100), nullable=False)

    # ── Monitoring metadata ────────────────────────────────────────────────
    notes               = Column(Text,               nullable=True)
    linz_last_checked_at = Column(DateTime(timezone=True), nullable=True,
                                  comment="Timestamp of last LINZ layer diff check.")

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=True,  default=_now, onupdate=_now)

    # ── Relationships ──────────────────────────────────────────────────────
    user         = relationship("User",         back_populates="saved_properties")
    organization = relationship("Organization", back_populates="saved_properties")
    audit        = relationship("Audit",        back_populates="saved_properties")

    __table_args__ = (
        UniqueConstraint("user_id", "parcel_id", name="uq_saved_property_user_parcel"),
        Index("ix_saved_properties_user_id",         "user_id"),
        Index("ix_saved_properties_organization_id", "organization_id"),
        Index("ix_saved_properties_parcel_id",       "parcel_id"),
        Index("ix_saved_properties_audit_id",        "audit_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<SavedProperty id={self.id} "
            f"user_id={self.user_id} "
            f"parcel_id={self.parcel_id!r}>"
        )
