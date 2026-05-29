"""
conftest.py — adds backend/app/engine to sys.path so tests can
import async_engine and rules directly without package-prefix gymnastics.
"""
import sys
from pathlib import Path

# Insert the engine directory at the front of sys.path so that
#   from async_engine import calculate_dna_value
# resolves to backend/app/engine/async_engine.py
ENGINE_DIR = Path(__file__).parent.parent / "app" / "engine"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
