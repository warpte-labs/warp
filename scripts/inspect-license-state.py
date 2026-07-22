import sqlite3
import json
import sys

p = r"C:\Users\alecc\AppData\Roaming\Cursor\User\globalStorage\state.vscdb"
c = sqlite3.connect(p)
print("=== keys matching warp/license ===")
for row in c.execute(
    "SELECT key, length(value) FROM ItemTable WHERE lower(key) LIKE '%warp%' OR lower(key) LIKE '%license%' OR value LIKE '%trialStarted%'"
):
    print(row[0], row[1])

print("=== sample values ===")
for row in c.execute(
    "SELECT key, value FROM ItemTable WHERE lower(key) LIKE '%warptelabs%' OR lower(key) LIKE '%warp.license%' OR value LIKE '%trialStarted%'"
):
    key, val = row
    try:
        s = val.decode("utf-8") if isinstance(val, bytes) else str(val)
    except Exception:
        s = repr(val)[:200]
    print("---", key)
    print(s[:500])
c.close()
