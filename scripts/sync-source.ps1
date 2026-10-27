param([Parameter(Mandatory=$true)][string]$SshHost,[string]$RemoteRoot='/data/projects/unified-workbench')
$ErrorActionPreference='Stop'
if($SshHost -notmatch '^[A-Za-z0-9_.@-]+$' -or $RemoteRoot -notmatch '^/data/projects/[a-z0-9-]+$'){throw 'Invalid SSH alias or project directory'}
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskSha=(& git -C $taskRoot rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $taskSha -notmatch '^[a-f0-9]{40}$'){throw 'Cannot determine source revision'}
if((& git -C $taskRoot status --porcelain)){throw 'Commit the verified stage before source synchronization'}
$taskLocal=Join-Path $taskRoot '.local'
New-Item -ItemType Directory -Path $taskLocal -Force|Out-Null
$taskArchive=Join-Path $taskLocal "source-$taskSha.tar"
& git -C $taskRoot archive --format=tar -o $taskArchive HEAD
if($LASTEXITCODE -ne 0){throw 'Source archive failed'}
$taskRemote="$RemoteRoot/releases/$taskSha"
$taskPrepare='sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" '+$taskRemote
& ssh -o BatchMode=yes $SshHost $taskPrepare
if($LASTEXITCODE -ne 0){throw 'Remote release directory unavailable'}
& scp -q $taskArchive "${SshHost}:${taskRemote}/source.tar"
if($LASTEXITCODE -ne 0){throw 'Source transfer failed'}
$taskExtract="set -eu`ntar --no-same-owner -xf $taskRemote/source.tar -C $taskRemote`nprintf '%s\n' '$taskSha' > $taskRemote/.source-revision`nsudo ln -sfn $taskRemote $RemoteRoot/source-current"
& ssh -o BatchMode=yes $SshHost $taskExtract
if($LASTEXITCODE -ne 0){throw 'Source extraction failed'}
[pscustomobject]@{sourceRevision=$taskSha;sourceDirectory=$taskRemote;deployment='source-only'}|ConvertTo-Json -Compress
