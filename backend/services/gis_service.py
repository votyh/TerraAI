"""
TerraAI GIS Orchestrator — services/gis_service.py
====================================================
Resolves addresses to Parcel IDs and fetches geospatial overlays.

Supported Jurisdictions:
    NZ  — LINZ Data Service         (data.linz.govt.nz)
    AU  — NSW Spatial Services      (portal.spatial.nsw.gov.au)
         NSW Planning Portal (LEP)  (mappingandwebservices.planning.nsw.gov.au)
         NSW Flood Data Portal      (flooddata.nsw.gov.au)

ZERO HALLUCINATION POLICY (LAWYER_SHIELD.md §4):
    If an API is not configured or returns no result, all fields are returned
    as None and data_available=False.  Nothing is interpolated or guessed.

Phase Roadmap:
    Phase 2  — Activate NZ / LINZ live calls
    Phase 3  — Activate AU / NSW Spatial live calls
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx


# ─── Data Transfer Objects ────────────────────────────────────────────────────

@dataclass
class ParcelResult:
    """Result of an address → parcel-ID lookup."""

    data_available: bool
    parcel_id:      Optional[str]   = None   # LINZ parcel id or NSW CADID
    title_ref:      Optional[str]   = None   # LINZ title ref or Lot/DP string
    latitude:       Optional[float] = None
    longitude:      Optional[float] = None
    land_area_sqm:  Optional[float] = None
    source:         Optional[str]   = None
    error:          Optional[str]   = None


@dataclass
class FloodOverlayResult:
    """Result of a spatial flood-risk overlay query."""

    data_available:   bool
    risk_level:       Optional[str]   = None   # "low" | "medium" | "high"
    flood_zone_code:  Optional[str]   = None
    aep_pct:          Optional[float] = None   # Annual Exceedance Probability %
    flood_depth_m:    Optional[float] = None
    source_dataset:   Optional[str]   = None
    error:            Optional[str]   = None


@dataclass
class ZoningOverlayResult:
    """Result of a spatial zoning overlay query."""

    data_available:         bool
    zone_code:              Optional[str]   = None   # "MHU", "R2", …
    zone_name:              Optional[str]   = None
    max_height_m:           Optional[float] = None
    max_site_coverage_pct:  Optional[float] = None
    min_lot_size_sqm:       Optional[float] = None
    floor_area_ratio:       Optional[float] = None
    source:                 Optional[str]   = None
    error:                  Optional[str]   = None


@dataclass
class GISBundle:
    """Consolidated GIS output for a single property lookup."""

    address:      str
    jurisdiction: str              # "NZ" | "AU"
    parcel:       ParcelResult
    flood:        FloodOverlayResult
    zoning:       ZoningOverlayResult


# ─── NZ: LINZ Data Service ────────────────────────────────────────────────────

class LINZClient:
    """
    Client for the LINZ Data Service.

    Live API docs  : https://data.linz.govt.nz/services/api/v1/
    Key layers     :
        Layer 50804 — NZ Parcels
        Layer 50772 — NZ Property Titles
    Authentication : LINZ_API_KEY in .env
    Free-tier limit: 1 000 req/day

    Flood overlays are sourced from Auckland Council's GIS WFS endpoint
    rather than LINZ directly; set AUCKLAND_COUNCIL_GIS_KEY in .env.
    """

    BASE_URL      = "https://data.linz.govt.nz/services/api/v1"
    PARCELS_LAYER = "50804"
    TITLES_LAYER  = "50772"

    # Auckland Council WFS — flood-plain and zoning layers
    AC_WFS_BASE   = "https://data.aucklandcouncil.govt.nz/arcgis/rest/services"
    # Layer identifiers (verify against the AC GIS portal before activating)
    AC_FLOOD_LAYER  = "FloodHazardOverlay/FeatureServer/0"
    AC_ZONING_LAYER = "AucklandUnitaryPlan/FeatureServer/0"

    def __init__(self) -> None:
        self._linz_key = os.environ.get("LINZ_API_KEY")
        self._ac_key   = os.environ.get("AUCKLAND_COUNCIL_GIS_KEY")

    def is_configured(self) -> bool:
        return bool(self._linz_key)

    # ── Parcel resolution ──────────────────────────────────────────────────

    async def resolve_address_to_parcel(self, address: str) -> ParcelResult:
        """
        Geocode an NZ address and return its LINZ parcel record.

        Steps (Phase 2 — live implementation):
            1. Geocode address → WGS-84 coordinate via LINZ geocoder.
            2. Spatial intersect against Layer 50804 (NZ Parcels).
            3. Return parcel_id (appro_no) and title reference.

        TODO Phase 2: uncomment the live block below.
        """
        if not self.is_configured():
            return ParcelResult(
                data_available=False,
                error="LINZ_API_KEY not set — see .env.example.",
                source="LINZ Data Service (NZ)",
            )

        # ── Phase 2 live implementation ──────────────────────────────────
        # async with httpx.AsyncClient(timeout=10.0) as client:
        #     # Step 1: Geocode address → coordinates
        #     geocode_resp = await client.get(
        #         f"{self.BASE_URL}/geocode/",
        #         params={"q": address, "key": self._linz_key},
        #     )
        #     geocode_resp.raise_for_status()
        #     results = geocode_resp.json().get("results", [])
        #     if not results:
        #         return ParcelResult(
        #             data_available=False,
        #             error="Address not found in LINZ geocoder.",
        #             source="LINZ Data Service (NZ)",
        #         )
        #     lat = results[0]["geometry"]["y"]
        #     lon = results[0]["geometry"]["x"]
        #
        #     # Step 2: Spatial intersect → NZ Parcels (Layer 50804)
        #     parcel_resp = await client.get(
        #         f"{self.BASE_URL}/tables/layer-{self.PARCELS_LAYER}/features/",
        #         params={
        #             "key": self._linz_key,
        #             "intersects": f"POINT({lon} {lat})",
        #             "srsname": "EPSG:4326",
        #             "limit": 1,
        #         },
        #     )
        #     parcel_resp.raise_for_status()
        #     features = parcel_resp.json().get("features", [])
        #     if not features:
        #         return ParcelResult(
        #             data_available=False,
        #             error="No parcel found at geocoded coordinates.",
        #             source="LINZ Data Service (NZ)",
        #         )
        #     p = features[0]["properties"]
        #     return ParcelResult(
        #         data_available=True,
        #         parcel_id=str(p["id"]),
        #         title_ref=p.get("appro_no"),
        #         latitude=lat,
        #         longitude=lon,
        #         land_area_sqm=p.get("land_area"),
        #         source="LINZ Data Service (NZ) — Layer 50804",
        #     )
        # ─────────────────────────────────────────────────────────────────

        return ParcelResult(
            data_available=False,
            error="LINZ live integration scheduled for Phase 2. "
                  "API key is present but the endpoint is not yet activated.",
            source="LINZ Data Service (NZ)",
        )

    # ── Flood overlay ──────────────────────────────────────────────────────

    async def get_flood_overlay(self, lat: float, lon: float) -> FloodOverlayResult:
        """
        Spatial query against the Auckland Council flood-plain layer.

        AC WFS endpoint: https://data.aucklandcouncil.govt.nz/arcgis/rest/services/
        TODO Phase 2: uncomment the live block below.
        """
        if not self._ac_key:
            return FloodOverlayResult(
                data_available=False,
                error="AUCKLAND_COUNCIL_GIS_KEY not set — see .env.example.",
                source_dataset="Auckland Council GIS (planned)",
            )

        # ── Phase 2 live implementation ──────────────────────────────────
        # async with httpx.AsyncClient(timeout=10.0) as client:
        #     resp = await client.get(
        #         f"{self.AC_WFS_BASE}/{self.AC_FLOOD_LAYER}",
        #         params={
        #             "geometry": f"{lon},{lat}",
        #             "geometryType": "esriGeometryPoint",
        #             "inSR": "4326",
        #             "spatialRel": "esriSpatialRelIntersects",
        #             "outFields": "ZONE_CODE,RISK_LEVEL,AEP_PCT,FLOOD_DEPTH_M",
        #             "f": "json",
        #             "token": self._ac_key,
        #         },
        #     )
        #     resp.raise_for_status()
        #     features = resp.json().get("features", [])
        #     if not features:
        #         return FloodOverlayResult(
        #             data_available=True,
        #             risk_level="low",
        #             flood_zone_code="OUTSIDE_FLOOD_ZONE",
        #             source_dataset="Auckland Council GIS — Flood Hazard Overlay",
        #         )
        #     a = features[0]["attributes"]
        #     return FloodOverlayResult(
        #         data_available=True,
        #         risk_level=a.get("RISK_LEVEL", "medium").lower(),
        #         flood_zone_code=a.get("ZONE_CODE"),
        #         aep_pct=a.get("AEP_PCT"),
        #         flood_depth_m=a.get("FLOOD_DEPTH_M"),
        #         source_dataset="Auckland Council GIS — Flood Hazard Overlay",
        #     )
        # ─────────────────────────────────────────────────────────────────

        return FloodOverlayResult(
            data_available=False,
            error="Auckland Council flood overlay scheduled for Phase 2.",
            source_dataset="Auckland Council GIS (planned)",
        )

    # ── Zoning overlay ─────────────────────────────────────────────────────

    async def get_zoning_overlay(self, lat: float, lon: float) -> ZoningOverlayResult:
        """
        Spatial query against the Auckland Unitary Plan zoning layer.

        AC WFS endpoint: https://data.aucklandcouncil.govt.nz/
        TODO Phase 2: uncomment the live block below.
        """
        if not self._ac_key:
            return ZoningOverlayResult(
                data_available=False,
                error="AUCKLAND_COUNCIL_GIS_KEY not set — see .env.example.",
                source="Auckland Council — Unitary Plan (planned)",
            )

        # ── Phase 2 live implementation ──────────────────────────────────
        # async with httpx.AsyncClient(timeout=10.0) as client:
        #     resp = await client.get(
        #         f"{self.AC_WFS_BASE}/{self.AC_ZONING_LAYER}",
        #         params={
        #             "geometry": f"{lon},{lat}",
        #             "geometryType": "esriGeometryPoint",
        #             "inSR": "4326",
        #             "spatialRel": "esriSpatialRelIntersects",
        #             "outFields": (
        #                 "ZONE_CODE,ZONE_NAME,MAX_HEIGHT_M,"
        #                 "MAX_SITE_COVERAGE_PCT,MIN_LOT_SIZE_SQM,FLOOR_AREA_RATIO"
        #             ),
        #             "f": "json",
        #             "token": self._ac_key,
        #         },
        #     )
        #     resp.raise_for_status()
        #     features = resp.json().get("features", [])
        #     if not features:
        #         return ZoningOverlayResult(
        #             data_available=False,
        #             error="No zoning polygon found at coordinates.",
        #             source="Auckland Council — Unitary Plan",
        #         )
        #     a = features[0]["attributes"]
        #     return ZoningOverlayResult(
        #         data_available=True,
        #         zone_code=a.get("ZONE_CODE"),
        #         zone_name=a.get("ZONE_NAME"),
        #         max_height_m=a.get("MAX_HEIGHT_M"),
        #         max_site_coverage_pct=a.get("MAX_SITE_COVERAGE_PCT"),
        #         min_lot_size_sqm=a.get("MIN_LOT_SIZE_SQM"),
        #         floor_area_ratio=a.get("FLOOR_AREA_RATIO"),
        #         source="Auckland Council — Auckland Unitary Plan 2016",
        #     )
        # ─────────────────────────────────────────────────────────────────

        return ZoningOverlayResult(
            data_available=False,
            error="Auckland Unitary Plan zoning integration scheduled for Phase 2.",
            source="Auckland Council — Unitary Plan (planned)",
        )


# ─── AU: NSW Spatial Services ─────────────────────────────────────────────────

class NSWSpatialClient:
    """
    Client for NSW Spatial Services and the NSW Planning / Flood portals.

    Live API docs:
        NSW Spatial     : https://portal.spatial.nsw.gov.au/
        NSW Planning    : https://mappingandwebservices.planning.nsw.gov.au/
        NSW Flood Data  : https://www.flooddata.nsw.gov.au/
        GNAF (open)     : https://data.gov.au/dataset/ds-dga-19432f89-dc3a-4ef3-b943-5326ef1dbecc

    Authentication:
        NSW_SPATIAL_API_KEY  — NSW Spatial Portal token
        GNAF_API_KEY         — PSMA GNAF token (optional; GNAF is also open-access)

    Key endpoints:
        Geocoding   : Geocoded Addressing Theme / FeatureServer/1
        Cadastre    : Land Parcel Property Theme / FeatureServer/0
        Zoning      : Planning Portal LEP MapServer/3
        Flood       : NSW Flood Data Portal /v1/flood-risk
    """

    GEOCODE_URL = (
        "https://portal.spatial.nsw.gov.au/server/rest/services/"
        "NSW_Geocoded_Addressing_Theme/FeatureServer/1/query"
    )
    CADASTRE_URL = (
        "https://portal.spatial.nsw.gov.au/server/rest/services/"
        "NSW_Land_Parcel_Property_Theme/FeatureServer/0/query"
    )
    LEP_ZONING_URL = (
        "https://mappingandwebservices.planning.nsw.gov.au/arcgis/rest/services/"
        "planning/getPlanningPortalSpatialData/MapServer/3/query"
    )
    FLOOD_URL = "https://api.flooddata.nsw.gov.au/v1/flood-risk"

    def __init__(self) -> None:
        self._api_key  = os.environ.get("NSW_SPATIAL_API_KEY")
        self._gnaf_key = os.environ.get("GNAF_API_KEY")

    def is_configured(self) -> bool:
        return bool(self._api_key)

    # ── Parcel resolution ──────────────────────────────────────────────────

    async def resolve_address_to_parcel(self, address: str) -> ParcelResult:
        """
        Geocode an NSW address and return its cadastre (Lot/DP) record.

        Steps (Phase 3 — live implementation):
            1. Geocode address via NSW Geocoded Addressing Theme.
            2. Spatial intersect against NSW Land Parcel Property Theme.
            3. Return CADID, Lot/DP string, centroid, and land area.

        TODO Phase 3: uncomment the live block below.
        """
        if not self.is_configured():
            return ParcelResult(
                data_available=False,
                error="NSW_SPATIAL_API_KEY not set — see .env.example.",
                source="NSW Spatial Services (AU)",
            )

        # ── Phase 3 live implementation ──────────────────────────────────
        # async with httpx.AsyncClient(timeout=10.0) as client:
        #     # Step 1: Geocode address
        #     geocode_resp = await client.get(
        #         self.GEOCODE_URL,
        #         params={
        #             "where": "1=1",
        #             "text": address,
        #             "outFields": "address,Shape",
        #             "outSR": "4326",
        #             "returnGeometry": "true",
        #             "f": "json",
        #             "token": self._api_key,
        #         },
        #     )
        #     geocode_resp.raise_for_status()
        #     features = geocode_resp.json().get("features", [])
        #     if not features:
        #         return ParcelResult(
        #             data_available=False,
        #             error="Address not found in NSW Spatial geocoder.",
        #             source="NSW Spatial Services (AU)",
        #         )
        #     geom = features[0]["geometry"]
        #     lon, lat = geom["x"], geom["y"]
        #
        #     # Step 2: Spatial intersect → NSW Land Parcel Property Theme
        #     parcel_resp = await client.get(
        #         self.CADASTRE_URL,
        #         params={
        #             "geometry": f"{lon},{lat}",
        #             "geometryType": "esriGeometryPoint",
        #             "inSR": "4326",
        #             "spatialRel": "esriSpatialRelIntersects",
        #             "outFields": "lotidstring,cadid,areasqm",
        #             "outSR": "4326",
        #             "f": "json",
        #             "token": self._api_key,
        #         },
        #     )
        #     parcel_resp.raise_for_status()
        #     p_features = parcel_resp.json().get("features", [])
        #     if not p_features:
        #         return ParcelResult(
        #             data_available=False,
        #             error="No parcel found at geocoded coordinates.",
        #             source="NSW Spatial Services (AU)",
        #         )
        #     p = p_features[0]["attributes"]
        #     return ParcelResult(
        #         data_available=True,
        #         parcel_id=str(p.get("cadid")),
        #         title_ref=p.get("lotidstring"),
        #         latitude=lat,
        #         longitude=lon,
        #         land_area_sqm=p.get("areasqm"),
        #         source="NSW Spatial Services — Land Parcel Property Theme",
        #     )
        # ─────────────────────────────────────────────────────────────────

        return ParcelResult(
            data_available=False,
            error="NSW Spatial live integration scheduled for Phase 3. "
                  "API key is present but the endpoint is not yet activated.",
            source="NSW Spatial Services (AU)",
        )

    # ── Flood overlay ──────────────────────────────────────────────────────

    async def get_flood_overlay(self, lat: float, lon: float) -> FloodOverlayResult:
        """
        Query the NSW Flood Data Portal for flood risk at a coordinate.

        Ref: https://www.flooddata.nsw.gov.au/
        TODO Phase 3: uncomment the live block below.
        """
        if not self.is_configured():
            return FloodOverlayResult(
                data_available=False,
                error="NSW_SPATIAL_API_KEY not set — see .env.example.",
                source_dataset="NSW Flood Data Portal (planned)",
            )

        # ── Phase 3 live implementation ──────────────────────────────────
        # async with httpx.AsyncClient(timeout=10.0) as client:
        #     resp = await client.get(
        #         self.FLOOD_URL,
        #         params={"lat": lat, "lon": lon},
        #         headers={"Authorization": f"Bearer {self._api_key}"},
        #     )
        #     resp.raise_for_status()
        #     data = resp.json()
        #     return FloodOverlayResult(
        #         data_available=True,
        #         risk_level=data.get("risk_level", "low").lower(),
        #         flood_zone_code=data.get("zone_code"),
        #         aep_pct=data.get("aep_pct"),
        #         flood_depth_m=data.get("flood_depth_m"),
        #         source_dataset="NSW Flood Data Portal",
        #     )
        # ─────────────────────────────────────────────────────────────────

        return FloodOverlayResult(
            data_available=False,
            error="NSW flood overlay integration scheduled for Phase 3.",
            source_dataset="NSW Flood Data Portal (planned)",
        )

    # ── Zoning overlay ─────────────────────────────────────────────────────

    async def get_zoning_overlay(self, lat: float, lon: float) -> ZoningOverlayResult:
        """
        Query the NSW Planning Portal Local Environmental Plan (LEP) layer.

        Ref: https://www.planningportal.nsw.gov.au/
        TODO Phase 3: uncomment the live block below.
        """
        if not self.is_configured():
            return ZoningOverlayResult(
                data_available=False,
                error="NSW_SPATIAL_API_KEY not set — see .env.example.",
                source="NSW Planning Portal — LEP (planned)",
            )

        # ── Phase 3 live implementation ──────────────────────────────────
        # async with httpx.AsyncClient(timeout=10.0) as client:
        #     resp = await client.get(
        #         self.LEP_ZONING_URL,
        #         params={
        #             "geometry": f"{lon},{lat}",
        #             "geometryType": "esriGeometryPoint",
        #             "inSR": "4326",
        #             "spatialRel": "esriSpatialRelIntersects",
        #             "outFields": (
        #                 "Zone_Code,Zone_Name,MaxBuildingHeight,"
        #                 "MaxFloorSpaceRatio,MinLotSize"
        #             ),
        #             "outSR": "4326",
        #             "f": "json",
        #             "token": self._api_key,
        #         },
        #     )
        #     resp.raise_for_status()
        #     features = resp.json().get("features", [])
        #     if not features:
        #         return ZoningOverlayResult(
        #             data_available=False,
        #             error="No LEP zoning polygon found at coordinates.",
        #             source="NSW Planning Portal — LEP",
        #         )
        #     a = features[0]["attributes"]
        #     return ZoningOverlayResult(
        #         data_available=True,
        #         zone_code=a.get("Zone_Code"),
        #         zone_name=a.get("Zone_Name"),
        #         max_height_m=a.get("MaxBuildingHeight"),
        #         floor_area_ratio=a.get("MaxFloorSpaceRatio"),
        #         min_lot_size_sqm=a.get("MinLotSize"),
        #         source="NSW Planning Portal — Local Environmental Plan",
        #     )
        # ─────────────────────────────────────────────────────────────────

        return ZoningOverlayResult(
            data_available=False,
            error="NSW LEP zoning integration scheduled for Phase 3.",
            source="NSW Planning Portal — LEP (planned)",
        )


# ─── Public Facade ────────────────────────────────────────────────────────────

_NZ_CITIES: frozenset[str] = frozenset(
    {"auckland", "wellington", "christchurch", "hamilton", "tauranga", "dunedin"}
)
_AU_CITIES: frozenset[str] = frozenset(
    {"sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra"}
)


async def resolve_address(address: str, city: str) -> GISBundle:
    """
    Route an address to the correct jurisdiction client and return a GISBundle.

    Jurisdiction routing:
        city in _AU_CITIES  → NSWSpatialClient  (jurisdiction = "AU")
        otherwise           → LINZClient         (jurisdiction = "NZ")

    Flood and zoning overlays are derived from the resolved parcel coordinates.
    If the parcel lookup fails, overlay calls still return data_available=False.
    """
    city_lower = city.lower().strip()

    if city_lower in _AU_CITIES:
        client: LINZClient | NSWSpatialClient = NSWSpatialClient()
        jurisdiction = "AU"
    else:
        client = LINZClient()
        jurisdiction = "NZ"

    parcel = await client.resolve_address_to_parcel(address)

    if parcel.data_available and parcel.latitude and parcel.longitude:
        flood  = await client.get_flood_overlay(parcel.latitude, parcel.longitude)
        zoning = await client.get_zoning_overlay(parcel.latitude, parcel.longitude)
    else:
        # No coordinates — spatial overlays cannot be run; return explicit unavailable
        flood  = await client.get_flood_overlay(0.0, 0.0)
        zoning = await client.get_zoning_overlay(0.0, 0.0)

    return GISBundle(
        address=address,
        jurisdiction=jurisdiction,
        parcel=parcel,
        flood=flood,
        zoning=zoning,
    )
