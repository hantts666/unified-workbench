"""Verify the dedicated test database containers without printing environment data."""
import json
import subprocess

names = ["unified-workbench-platform-postgres-1", "unified-workbench-finance-postgres-1"]
containers = [json.loads(subprocess.check_output(["sudo", "docker", "inspect", name]))[0] for name in names]
networks = [set(container["NetworkSettings"]["Networks"]) for container in containers]
volumes = [{mount["Name"] for mount in container["Mounts"] if mount["Type"] == "volume"} for container in containers]
assert networks[0].isdisjoint(networks[1])
assert volumes[0].isdisjoint(volumes[1])
assert all(not bindings for container in containers for bindings in container["NetworkSettings"]["Ports"].values())
for index, name in enumerate(names):
    target = next(iter(containers[1-index]["NetworkSettings"]["Networks"].values()))["IPAddress"]
    result = subprocess.run(["sudo", "docker", "exec", name, "pg_isready", "-h", target, "-p", "5432", "-t", "2"], capture_output=True)
    assert result.returncode == 2, "Unexpected cross-network reachability"
print(json.dumps({"result":"passed","containers":2,"distinctVolumes":True,"distinctNetworks":True,"crossNetworkRejected":True,"publicDatabasePorts":0}))
