"""Convert the supplied Excel tables to small JSON files for the JavaScript service."""
from pathlib import Path
import json
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
workbook = load_workbook(DATA / "listening_memory.xlsx", read_only=True, data_only=True)


def sections(sheet_name):
    # Several worksheets contain named tables below the first one.
    result = {}
    name = sheet_name
    header = None
    for row in workbook[sheet_name].values:
        cells = [value for value in row if value is not None]
        if not cells:
            header = None
        elif len(cells) == 1 and header is None:
            name = cells[0]
        elif header is None:
            header = list(row)
            result[name] = []
        else:
            result[name].append({key: value for key, value in zip(header, row) if key})
    return result


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def normalized_event(row):
    event = {k: v for k, v in row.items() if not k.startswith("payload_")}
    event["payload"] = {k.removeprefix("payload_"): v for k, v in row.items()
                        if k.startswith("payload_") and v is not None}
    return event


catalog = sections("Catalog")
policies = sections("Policy and Deletion")
users = sections("Users")["Users"]
events = [normalized_event(row) for row in sections("Events")["Events"]]
cases = sections("Golden Cases")["Golden Cases"]
checks = sections("Golden Details")
contract_rows = sections("Contracts")
save(DATA / "catalog.json", {"entities": catalog["Catalog"], "relationships": catalog["Catalog Relationships"]})
save(DATA / "policy.json", policies["Policy and Deletion"])
save(DATA / "events.json", events)
save(DATA / "users.json", users)
# Expected answers stay in tests. Only the three real operations receipts from
# each type of deletion and the prior response references feed historical replay.
save(ROOT / "tests" / "fixtures.json", {"cases": cases, "checks": checks,
     "deletions": policies["Deletion Jobs"]})
demo_ids = {"U0001", "U0002", "U0003", "U0016"}
save(DATA / "demo.json", {"users": [u for u in users if u["subject_id"] in demo_ids],
     "events": [e for e in events if e["subject_id"] in demo_ids]})
save(DATA / "contracts.json", contract_rows)
