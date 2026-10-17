"""Check the Core artifact against the actual shared report contract, read-only."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True

parser = argparse.ArgumentParser()
parser.add_argument("--contract", type=Path, default=Path(__file__).resolve().parents[3] / "qiqi/contracts/report.py")
args = parser.parse_args()
if not args.contract.is_file():
    parser.exit(2, "Shared report contract is missing. Use --contract with the team checkout path.\n")
spec = importlib.util.spec_from_file_location("shared_report_contract", args.contract)
contract = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = contract
spec.loader.exec_module(contract)
fixture = json.loads(subprocess.check_output(["node", str(Path(__file__).with_name("fixture.js"))], encoding="utf-8"))
data = fixture["report"]
sections = [contract.ReportSection(**{**s, "blocks": [contract.block_from_dict(b) for b in s["blocks"]]}) for s in data["sections"]]
artifact = contract.ReportArtifact(**{**data, "meta": contract.ReportMeta(**data["meta"]),
    "layout": contract.ReportLayout(**data["layout"]), "sections": sections,
    "provenance": [contract.DataProvenance(**p) for p in data["provenance"]]})
contract.assert_valid(artifact)
print(json.dumps({"status": "PASS", "contract": "ReportArtifact 1.0", "sections": len(sections),
    "renderers_available": [], "data_mode": data["meta"]["mode"]}))
