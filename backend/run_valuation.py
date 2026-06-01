"""
TerraAI — Interactive DNA Valuation Runner  v2.0
=================================================
Usage:
    python run_valuation.py          (from repo root)

Prompts for 5 property inputs and prints a high-end terminal report
that mirrors the layout of the TerraAI $49 PDF product.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

# Enable ANSI colour codes on Windows 10+ without third-party libs
if sys.platform == "win32":
    os.system("")

try:
    from zoneinfo import ZoneInfo
    _NZ_TZ: object = ZoneInfo("Pacific/Auckland")
except Exception:
    import datetime as _dtmod
    _NZ_TZ = _dtmod.timezone.utc

ENGINE_DIR = Path(__file__).parent / "backend" / "app" / "engine"
sys.path.insert(0, str(ENGINE_DIR))
from async_engine import calculate_dna_value  # noqa: E402

# ── ANSI codes ────────────────────────────────────────────────────────────────
_R    = "\033[0m"
_BOLD = "\033[1m"
_DIM  = "\033[2m"
_GRN  = "\033[92m"
_RED  = "\033[91m"
_YLW  = "\033[93m"
_CYN  = "\033[96m"
_WHT  = "\033[97m"
_BLU  = "\033[94m"

W = 68  # report column width


def _c(*parts: str) -> str:
    """_c(ANSI_CODE, ..., text) — wraps text in codes with auto-reset."""
    return "".join(parts[:-1]) + str(parts[-1]) + _R


def _rule(char: str = "-", col: str = _DIM) -> str:
    return _c(col, char * W)


# ── Input helpers ─────────────────────────────────────────────────────────────

def _prompt(label: str, hint: str = "") -> str:
    h = ("  " + _c(_DIM, f"({hint})")) if hint else ""
    return input(f"\n  {_c(_CYN, _BOLD, label)}{h}\n  > ").strip()


def _int_prompt(label: str, hint: str = "") -> int:
    while True:
        raw = _prompt(label, hint)
        if raw.isdigit() and int(raw) > 0:
            return int(raw)
        print(f"  {_c(_RED, 'Please enter a whole number greater than 0.')}")


def _menu(label: str, options: list[tuple[str, str]]) -> str:
    print(f"\n  {_c(_CYN, _BOLD, label)}")
    for i, (display, _) in enumerate(options, 1):
        print(f"    {_c(_YLW, _BOLD, str(i))}.  {display}")
    while True:
        raw = input("  > ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            display, value = options[int(raw) - 1]
            print(f"  {_c(_GRN, 'OK')} {display}")
            return value
        print(f"  {_c(_RED, 'Enter a number 1-' + str(len(options)))}")


def _yes_no(label: str) -> bool:
    print(f"\n  {_c(_CYN, _BOLD, label)}")
    while True:
        raw = input(f"  {_c(_DIM, '[Y]es / [N]o')}  > ").strip().lower()
        if raw in ("y", "yes"):
            print(f"  {_c(_GRN, 'OK')} Yes")
            return True
        if raw in ("n", "no"):
            print(f"  {_c(_GRN, 'OK')} No")
            return False
        print(f"  {_c(_RED, 'Enter Y or N.')}")


def _optional_int_prompt(label: str, hint: str = "") -> int | None:
    """Returns None if Enter is pressed (skip), else validates a positive int."""
    h = ("  " + _c(_DIM, f"({hint})")) if hint else ""
    while True:
        raw = input(f"\n  {_c(_CYN, _BOLD, label)}{h}\n  {_c(_DIM, '[press Enter to skip]')}  > ").strip()
        if raw == "":
            print(f"  {_c(_DIM, 'Skipped.')}")
            return None
        if raw.isdigit() and int(raw) > 0:
            return int(raw)
        print(f"  {_c(_RED, 'Enter a whole number > 0, or press Enter to skip.')}")


def _multi_select(label: str, options: list) -> list:
    """Numbered options; user enters space-separated numbers or 0/Enter for none."""
    print(f"\n  {_c(_CYN, _BOLD, label)}")
    print(f"  {_c(_DIM, '(Enter numbers separated by spaces, or 0 / Enter for none)')}")
    print(f"    {_c(_YLW, _BOLD, '0')}.  None")
    for i, (display, _) in enumerate(options, 1):
        print(f"    {_c(_YLW, _BOLD, str(i))}.  {display}")
    while True:
        raw = input("  > ").strip()
        if raw == "" or raw == "0":
            print(f"  {_c(_GRN, 'OK')} None selected")
            return []
        parts = raw.replace(",", " ").split()
        chosen, labels, valid = [], [], True
        for p in parts:
            if p.isdigit() and 1 <= int(p) <= len(options):
                idx = int(p) - 1
                if options[idx][1] not in chosen:
                    chosen.append(options[idx][1])
                    labels.append(options[idx][0])
            else:
                valid = False
                break
        if valid and chosen:
            print(f"  {_c(_GRN, 'OK')} {', '.join(labels)}")
            return chosen
        print(f"  {_c(_RED, 'Enter numbers 0-' + str(len(options)) + ', separated by spaces.')}")


# ── Report helpers ────────────────────────────────────────────────────────────

_FACTOR_LABEL = {
    "era":                   "ERA",
    "cladding":              "CLADDING",
    "risk":                  "GEO RISK",
    "topography":            "TOPOGRAPHY",
    "solar_exposure":        "SOLAR EXPOSURE",
    "school_zone":           "SCHOOL ZONE",
    "flood_risk":            "FLOOD / HAZARD RISK",
    "land_value":            "LAND VALUE",
    "utility_ensuite":       "UTILITY: ENSUITE BONUS",
    "utility_density":       "UTILITY: FRICTION PENALTY",
    "asset_pool":            "ASSET: POOL",
    "asset_minor_dwelling":  "ASSET: MINOR DWELLING",
    "asset_solar_array":     "ASSET: SOLAR ARRAY",
}

_FACTOR_CONTEXT = {
    "era": (
        "Construction era adjustment from decade-era matrix. New builds carry a "
        "performance premium; leaky-era homes (1990-2004) carry a market-stigma "
        "discount sourced from UTS / BRANZ research."
    ),
    "cladding": (
        "Exterior material premium or discount vs the fibre-cement benchmark. "
        "Brick & tile outperforms by ~20%; monolithic plaster carries a stigma "
        "discount due to unremediated leaky-building liability risk."
    ),
    "risk": (
        "Geospatial flood or coastal-erosion risk discount from registered council "
        "flood maps and LINZ / NSW Spatial hazard-zone overlays."
    ),
    "topography": (
        "Site slope engineering-cost penalty from LiDAR data. Moderate sites "
        "require retaining walls (-7%); steep sites require full structural "
        "engineering solutions (-20%)."
    ),
    "solar_exposure": (
        "TerraAI 2.4% Rule: each hour of direct sun above the city daily average "
        "adds 2.4% to estimated value. Source: NIWA / BOM public data."
    ),
    "school_zone": (
        "Prime school-catchment demand premium. Decile-9/10 (NZ) and Band A/B (AU) "
        "catchments command a sustained 15% premium above comparable standard-zone "
        "properties."
    ),
    "flood_risk": (
        "Insurance-market hazard penalty. Banks apply LVR restrictions and insurers "
        "load premiums on properties within council flood-mapped zones. Data sourced "
        "from LINZ flood hazard layers and NIWA RiskScape. 2026 market reality."
    ),
    "land_value": (
        "Land value is calculated separately from the floor-area improvement value, "
        "using the city-average rate per m2 from TerraAI's 2026 land-market "
        "database. Land value is NOT subject to the DNA multiplier chain."
    ),
    "utility_ensuite": (
        "Ensuite addition raises the buyer utility score. A dedicated 2nd bathroom "
        "reduces negotiation friction and broadens the buyer pool, delivering a "
        "consistent flat-rate premium in NZ and AU markets."
    ),
    "utility_density": (
        "Utility friction penalty: four or more bedrooms served by only one bathroom "
        "creates significant buyer resistance. Buyers discount heavily for "
        "under-serviced floor plans in the 4-bed+ configuration."
    ),
    "asset_pool": (
        "In-ground pool premium based on 2026 comparable-sales analysis. Value is "
        "fully realised in premium and lifestyle markets; standard-zone realisation "
        "is typically 85-95% of the stated flat-rate figure."
    ),
    "asset_minor_dwelling": (
        "Minor dwelling (granny flat / income unit) premium. Rental income potential "
        "and multi-generational living demand drive a sustained flat-rate premium, "
        "particularly strong in Auckland and Sydney markets."
    ),
    "asset_solar_array": (
        "Solar array add-on value based on installed system replacement cost and "
        "energy-savings capitalisation at a 6% yield. Value may be higher in "
        "regions with strong feed-in tariffs (e.g. Queensland, SA)."
    ),
}


def _impact_bar(pct: float, width: int = 22, scale: float = 25.0) -> str:
    """Coloured ASCII bar. scale% maps to full width."""
    filled = min(width, max(0, round(abs(pct) / scale * width)))
    col = _GRN if pct >= 0 else _RED
    bar = _c(col, "#" * filled) + _c(_DIM, "." * (width - filled))
    return f"[{bar}]"


def _pct_str(pct: float) -> str:
    if pct > 0:
        return _c(_GRN, _BOLD, f"+{pct:.2f}%")
    if pct < 0:
        return _c(_RED, _BOLD, f"{pct:.2f}%")
    return _c(_DIM, " 0.00%")


def _conf_bar(score: int, width: int = 22) -> str:
    filled = round(score / 100 * width)
    col = _GRN if score >= 80 else (_YLW if score >= 50 else _RED)
    return f"[{_c(col, '#' * filled)}{_c(_DIM, '.' * (width - filled))}]"


def _wrap(text: str, indent: int = 6, col_width: int = W) -> list[str]:
    """Word-wrap to col_width; return indented lines."""
    words, lines, current = text.split(), [], ""
    avail = col_width - indent
    for word in words:
        if current and len(current) + 1 + len(word) > avail:
            lines.append(current)
            current = word
        else:
            current = (current + " " + word).lstrip()
    if current:
        lines.append(current)
    pad = " " * indent
    return [pad + ln for ln in lines]


def _section(title: str) -> None:
    print(f"  {_c(_WHT, _BOLD, title)}")
    print(_c(_DIM, "  " + "-" * (W - 2)))


def _kv(key: str, value: str, kw: int = 18) -> None:
    """key: value — key is padded BEFORE ANSI so columns align visually."""
    label = (key + ":").ljust(kw)
    print(f"  {_c(_DIM, label)}  {value}")


def _print_factor(item: dict, base_val: float, currency: str) -> None:
    """Render one DNA factor block: header, bar, pct, dollar impact, context."""
    factor = item["factor"]
    pct    = item["impact_pct"]
    reason = item["reasoning_string"]

    if factor.startswith("lifestyle_"):
        asset = factor.replace("lifestyle_", "").replace("_", " ").title()
        label = f"LIFESTYLE: {asset.upper()}"
        ctx   = f"Property lifestyle amenity premium for {asset.lower()}."
    else:
        label = _FACTOR_LABEL.get(factor, factor.upper().replace("_", " "))
        ctx   = _FACTOR_CONTEXT.get(factor, "")

    col        = _GRN if pct >= 0 else _RED
    dollar_imp = abs(base_val * pct / 100) if base_val else 0.0
    sign       = "+" if pct >= 0 else "-"
    dollar_str = f"~ {sign}${dollar_imp:,.0f} {currency}"

    header_text = "--- " + label + " "
    dash = "-" * max(0, W - len(header_text) - 2)
    print(f"  {_c(col, _BOLD, header_text)}{_c(_DIM, dash)}")
    print()
    print(f"      {_impact_bar(pct)}  {_pct_str(pct)}   {_c(_DIM, dollar_str)}")
    print(f"      {_c(_WHT, reason)}")
    if ctx:
        for line in _wrap(ctx, indent=6, col_width=W):
            print(_c(_DIM, line))
    print()


# ── Main report ────────────────────────────────────────────────────────────────

def print_report(
    result:        dict,
    address:       str,
    area_sqm:      int,
    city:          str,
    now:           datetime,
    land_area_sqm: int | None       = None,
    bedrooms:      int | None       = None,
    bathrooms:     int | None       = None,
    flood_risk:    str | None       = None,
    assets:        list[str] | None = None,
) -> None:
    m        = result["metadata"]
    val      = result["final_valuation"]
    base_val = m["base_cost_per_sqm"] * area_sqm
    currency = "NZD" if city.lower() in ("auckland", "wellington", "christchurch") else "AUD"
    rid      = f"TRA-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"

    try:
        ts = now.astimezone(_NZ_TZ).strftime("%d %B %Y  %H:%M %Z")  # type: ignore[arg-type]
    except Exception:
        ts = now.strftime("%d %B %Y  %H:%M")

    inner = W - 4

    print()

    # ── HEADER BOX ────────────────────────────────────────────────────────────
    L1 = "T E R R A  A I   *   P R O P E R T Y   R E P O R T"
    L2 = "DNA  VALUATION   *   CONFIDENTIAL  DRAFT"
    print(_c(_BLU, _BOLD, "  +" + "=" * inner + "+"))
    print(_c(_BLU, _BOLD, "  |") + _c(_WHT, _BOLD, L1.center(inner)) + _c(_BLU, _BOLD, "|"))
    print(_c(_BLU, _BOLD, "  |") + _c(_CYN,         L2.center(inner)) + _c(_BLU, _BOLD, "|"))
    print(_c(_BLU, _BOLD, "  +" + "=" * inner + "+"))
    print()

    # ── REPORT METADATA ───────────────────────────────────────────────────────
    kw = 14
    print(f"  {_c(_DIM, 'Report ID:'.ljust(kw))}  {_c(_WHT, _BOLD, rid)}")
    print(f"  {_c(_DIM, 'Generated:'.ljust(kw))}  {ts}")
    print(f"  {_c(_DIM, 'Engine:'.ljust(kw))}  {m['engine_version']}  |  Rules: 2026 Market Data")
    print()
    print(_rule("=", _BLU))
    print()

    # ── SUBJECT PROPERTY ──────────────────────────────────────────────────────
    _section("SUBJECT PROPERTY")
    print()

    topo_note = {
        "flat":     "no structural penalty",
        "moderate": "-7%  structural penalty",
        "steep":    "-20%  structural penalty",
    }
    topo = m["topo_grade"]

    _kv("Address",     _c(_WHT, _BOLD, address))
    _kv("Floor Area",  f"{area_sqm:,} m2")
    if land_area_sqm:
        lr = m.get("land_rate_per_sqm") or 0
        _kv("Land Area",  f"{land_area_sqm:,} m2")
        _lr_str = "  (" + str(land_area_sqm) + " m2  @  $" + f"{lr:,.0f}" + "/m2 city rate)"
        print(f"  {_c(_DIM, _lr_str)}")
    if bedrooms is not None and bathrooms is not None:
        _kv("Bed / Bath",  f"{bedrooms} bed  /  {bathrooms} bath")
    _kv("City / Tier", f"{city.title()}  |  {m['tier'].title()} Market Tier")
    _kv("Base Cost",   f"${m['base_cost_per_sqm']:,.0f} / m2  |  {_c(_DIM, m['base_source'])}")
    if flood_risk and flood_risk != "none":
        _flood_zone_labels = {
            "floodplain":    "Floodplain (1-in-100yr)  --  LVR restrictions apply",
            "overland_flow": "Overland Flow Path  --  Insurance loading applies",
        }
        _kv("Flood Zone",  _c(_RED, _BOLD, _flood_zone_labels.get(flood_risk, flood_risk.title())))
    _kv("LiDAR Slope", f"{topo.title()}  ({topo_note.get(topo, '')})")
    _kv("Solar",       f"{m['solar_hours_daily']}h / day average")
    _kv("School Zone",
        _c(_GRN, _BOLD, "YES  Prime Catchment Confirmed") if m["is_in_prime_zone"]
        else _c(_DIM,   "NO   Standard Zone"))

    print()
    print(_rule("=", _BLU))
    print()

    # ── DNA BREAKDOWN ─────────────────────────────────────────────────────────
    _HAZARD_FACTORS  = {"flood_risk"}
    non_hazard_items = [i for i in result["dna_breakdown"] if i["factor"] not in _HAZARD_FACTORS]
    hazard_items     = [i for i in result["dna_breakdown"] if i["factor"] in _HAZARD_FACTORS]

    n_total = len(result["dna_breakdown"])
    _section(f"DNA BREAKDOWN  |  {n_total} Factors Assessed")
    print()

    for item in non_hazard_items:
        _print_factor(item, base_val, currency)

    # ── RISK & RESILIENCE sub-section (only shown when flood data is present) ───
    if hazard_items:
        print(_rule("=", _BLU))
        print()
        _section("RISK & RESILIENCE  |  Hazard Assessment")
        print()
        for item in hazard_items:
            _print_factor(item, base_val, currency)

    print(_rule("=", _BLU))
    print()

    # ── VALUATION SUMMARY ─────────────────────────────────────────────────────
    _section("VALUATION SUMMARY")
    print()

    combined_pct = (m["combined_multiplier"] - 1.0) * 100
    sign_c = "+" if combined_pct >= 0 else ""

    land_val = m.get("land_value") or 0.0
    if land_val:
        improvement_val = val - land_val
        _kv("Land Value",        f"${land_val:,.0f}  {currency}", kw=26)
        _lv_str = "  (" + str(land_area_sqm or 0) + " m2  x  $" + f"{m.get('land_rate_per_sqm', 0):,.0f}" + "/m2 city rate)"
        print(f"  {_c(_DIM, _lv_str)}")
        print()
        _kv("Improvement Value", f"${improvement_val:,.0f}  {currency}", kw=26)
        print(f"  {_c(_DIM, '  (structure + DNA multipliers + asset premiums)')}")
    else:
        _kv("Base Value",    f"${base_val:,.0f}  {currency}", kw=26)
        base_line = "  (" + str(area_sqm) + " m2  x  $" + f"{m['base_cost_per_sqm']:,}" + "/m2)"
        print(f"  {_c(_DIM, base_line)}")
    print()
    mult_disp = "x " + str(m["combined_multiplier"]) + "  (" + sign_c + f"{combined_pct:.2f}%)"
    _kv("DNA Multiplier", _c(_YLW, _BOLD, mult_disp), kw=26)
    print()

    sep = _c(_DIM, "  " + "-" * (W - 4))
    print(sep)
    print()

    # Final value — right-aligned
    val_str  = "$" + f"{val:,.0f}" + "  " + currency
    em_label = "ESTIMATED MARKET VALUE"
    gap      = W - len(em_label) - len(val_str) - 4
    print(f"  {_c(_WHT, _BOLD, em_label)}{' ' * max(2, gap)}{_c(_GRN, _BOLD, val_str)}")

    print()
    print(sep)
    print()

    # ── CONFIDENCE ────────────────────────────────────────────────────────────
    conf     = result["confidence_score"]
    conf_col = _GRN if conf >= 80 else (_YLW if conf >= 50 else _RED)
    conf_lbl = (
        "HIGH     Live GIS connected"     if conf >= 80 else
        "MEDIUM   Partial data available" if conf >= 50 else
        "LOW      Rules fallback only"
    )
    _kv("Model Confidence",
        f"{_conf_bar(conf)}  {_c(conf_col, _BOLD, str(conf) + '/100')}", kw=22)
    print(f"  {''.ljust(24)}  {_c(conf_col, conf_lbl)}")

    if conf < 80:
        print()
        print(f"  {_c(_YLW, '  ! Confidence rises to 100 when live GIS keys are configured')}")
        print(f"  {_c(_YLW, '    and data_v1.json is populated with 2026 market data.')}")

    print()
    print(_rule("=", _BLU))

    # ── DISCLAIMER ────────────────────────────────────────────────────────────
    print()
    disc = (
        "INDICATIVE MODEL ESTIMATE ONLY.  This report does NOT constitute a "
        "Registered Valuation, Geotechnical Assessment, or Legal Advice. "
        "All figures derive from public market-research data and statistical "
        "models.  Verify with a licensed professional (PINZ / API member) "
        "before making any financial or investment decision.  LAWYER_SHIELD.md."
    )
    for line in _wrap(disc, indent=2, col_width=W):
        print(_c(_DIM, line))
    print()
    print(f"  {_c(_DIM, '(c) 2026 TerraAI  |  Confidential  |  ' + rid)}")
    print()


# ── Selection menus ───────────────────────────────────────────────────────────

_ERA_OPTIONS: list[tuple[str, str]] = [
    ("1900s  --  NZ Villa / Heritage Character",     "villa_heritage_1900_1920"),
    ("1950s  --  Post-War Solid Build",              "post_war_solid_1950_1960"),
    ("1990s  --  Leaky Building Era  (1990-2004)",   "leaky_era_1990_2004"),
    ("Modern --  High Performance   (2020-present)", "modern_high_performance_2020_2026"),
]

_CLADDING_OPTIONS: list[tuple[str, str]] = [
    ("Brick & Tile          (+20.0%  resale premium)",    "brick_and_tile"),
    ("Vertical Cedar        ( +8.5%  aesthetic premium)", "vertical_cedar"),
    ("Monolithic Plaster    (-11.5%  stigma discount)",   "monolithic_plaster"),
]

_FLOOD_OPTIONS: list[tuple[str, str]] = [
    ("None  --  No registered flood hazard",                     "none"),
    ("Overland Flow Path  (-4.0%  insurance loading)",           "overland_flow"),
    ("Floodplain  (-12.5%  LVR restriction + insurance impact)", "floodplain"),
]

_ASSET_OPTIONS: list[tuple[str, str]] = [
    ("Pool            (+$65,000  comparable-sales premium)", "pool"),
    ("Minor Dwelling  (+$150,000  income / granny flat)",    "minor_dwelling"),
    ("Solar Array     (+$15,000  system + energy savings)",  "solar_array"),
]

_CITY_OPTIONS: list[tuple[str, str]] = [
    ("Auckland",     "auckland"),
    ("Wellington",   "wellington"),
    ("Christchurch", "christchurch"),
    ("Sydney",       "sydney"),
    ("Melbourne",    "melbourne"),
    ("Brisbane",     "brisbane"),
]


# ── Entry point ───────────────────────────────────────────────────────────────

async def _main() -> None:
    # Welcome banner
    print()
    hr = "-" * (W - 2)
    print(f"  {_c(_CYN, _BOLD, hr)}")
    print(f"  {_c(_CYN, _BOLD, '  TerraAI  |  DNA Property Valuation Engine  v2.1')}")
    print(f"  {_c(_DIM,        '  Interactive Runner  --  type your answers and press Enter')}")
    print(f"  {_c(_CYN, _BOLD, hr)}")
    print()

    # 1. Address
    address = ""
    while not address:
        address = _prompt("1.  Property Address", "e.g.  42 Remuera Road, Auckland")
        if not address:
            print(f"  {_c(_RED, 'Address cannot be blank.')}")

    # 2. Floor Area
    area_sqm = _int_prompt("2.  Floor Area (m2)", "whole number, e.g.  150")

    # 3. Land Area  (optional)
    land_area_sqm = _optional_int_prompt(
        "3.  Land Area (m2)",
        "total site area e.g.  400  --  press Enter to skip",
    )

    # 4. Bedrooms
    bedrooms = _int_prompt("4.  Bedrooms", "whole number, e.g.  3")

    # 5. Bathrooms
    bathrooms = _int_prompt("5.  Bathrooms", "whole number, e.g.  2")

    # 6. Build Era
    era = _menu("6.  Build Era", _ERA_OPTIONS)

    # 7. Exterior Cladding
    cladding = _menu("7.  Exterior Cladding", _CLADDING_OPTIONS)

    # 8. Flood Risk
    flood_risk_raw = _menu("8.  Flood Risk", _FLOOD_OPTIONS)
    flood_risk = None if flood_risk_raw == "none" else flood_risk_raw

    # 9. High-Value Assets
    assets = _multi_select("9.  High-Value Assets", _ASSET_OPTIONS)

    # 10. School Zone
    in_prime_zone = _yes_no("10. Is this property in a Prime School Zone?")

    # City  (optional, defaults to Auckland)
    print(f"\n  {_c(_CYN, _BOLD, '    City')}  {_c(_DIM, '(press Enter for Auckland, or pick a number below)')}")
    for i, (display, _) in enumerate(_CITY_OPTIONS, 1):
        print(f"    {_c(_YLW, _BOLD, str(i))}.  {display}")
    city_raw = input("  > ").strip()
    if city_raw == "" or city_raw == "1":
        city = "auckland"
        print(f"  {_c(_GRN, 'OK')} Auckland (default)")
    elif city_raw.isdigit() and 1 <= int(city_raw) <= len(_CITY_OPTIONS):
        city = _CITY_OPTIONS[int(city_raw) - 1][1]
        print(f"  {_c(_GRN, 'OK')} {_CITY_OPTIONS[int(city_raw) - 1][0]}")
    else:
        city = "auckland"
        print(f"  {_c(_YLW, 'Unrecognised -- defaulting to Auckland.')}")

    # Run engine
    print()
    print(f"  {_c(_YLW, '  Fetching LiDAR and solar data concurrently...')}", end="", flush=True)

    now    = datetime.now()
    result = await calculate_dna_value(
        address          = address,
        city             = city,
        tier             = "standard",
        area_sqm         = float(area_sqm),
        era              = era,
        cladding         = cladding,
        flood_risk       = flood_risk,
        land_area_sqm    = float(land_area_sqm) if land_area_sqm else None,
        bedrooms         = bedrooms,
        bathrooms        = bathrooms,
        assets           = assets if assets else None,
        is_in_prime_zone = in_prime_zone,
    )

    print(f"\r  {_c(_GRN, _BOLD, '  Analysis complete.')}" + " " * 42)

    print_report(
        result,
        address,
        area_sqm,
        city,
        now,
        land_area_sqm = land_area_sqm,
        bedrooms      = bedrooms,
        bathrooms     = bathrooms,
        flood_risk    = flood_risk,
        assets        = assets if assets else None,
    )


def main() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        print(f"\n\n  {_c('Cancelled.', _DIM)}\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
