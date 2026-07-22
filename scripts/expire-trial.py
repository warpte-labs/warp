"""Force Warp free trial expired in Cursor (+ optional VS Code) globalStorage."""
import json
import sqlite3
import time
from pathlib import Path

EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000
now = int(time.time() * 1000)
started = now - EIGHT_DAYS_MS

paths = [
    Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
    Path.home() / "AppData/Roaming/Code/User/globalStorage/state.vscdb",
]

KEY = "WarpteLabs.warp"

for p in paths:
    if not p.exists():
        print("skip missing", p)
        continue
    c = sqlite3.connect(str(p))
    row = c.execute("SELECT value FROM ItemTable WHERE key = ?", (KEY,)).fetchone()
    data = {}
    if row and row[0]:
        raw = row[0]
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    data["warp.license.trialStartedAt"] = started
    data["warp.license.proCached"] = False
    data["warp.license.proCachedUntil"] = 0
    # keep installId / billing email if present
    new_val = json.dumps(data, separators=(",", ":"))
    if row:
        c.execute("UPDATE ItemTable SET value = ? WHERE key = ?", (new_val, KEY))
    else:
        c.execute("INSERT INTO ItemTable (key, value) VALUES (?, ?)", (KEY, new_val))
    c.commit()
    c.close()
    print("updated", p)
    print("  trialStartedAt =", started, "(~8 days ago)")
    print("  data =", data)
