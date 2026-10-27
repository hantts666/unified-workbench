"""Create private test configuration on the target host without logging secrets."""
import os
import secrets
from pathlib import Path

root = Path(os.environ.get("WORKBENCH_ROOT", "/data/projects/unified-workbench"))
if not root.is_absolute() or root.parent != Path("/data/projects"):
    raise SystemExit("Expected a dedicated /data/projects directory")
root.mkdir(parents=True, exist_ok=True)
target = root / ".env"
if target.exists():
    print("Private environment already exists; credentials retained")
else:
    values = {key: secrets.token_hex(32) for key in (
        "PLATFORM_DB_OWNER_PASSWORD", "PLATFORM_DB_APP_PASSWORD",
        "FINANCE_DB_OWNER_PASSWORD", "FINANCE_DB_APP_PASSWORD",
        "INTERNAL_SERVICE_SECRET", "MASTER_KEY", "BOOTSTRAP_PASSWORD"
    )}
    values["BOOTSTRAP_ACCOUNT"] = "owner"
    values["COOKIE_SECURE"] = "false"
    values["WEB_PORT"] = "3200"
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        handle.write("".join(f"{key}={value}\n" for key, value in values.items()))
    print("Private test environment created")
