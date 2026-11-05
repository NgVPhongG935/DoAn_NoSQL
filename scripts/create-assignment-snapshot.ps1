param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9_]{0,47}$')][string]$Keyspace,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Tag
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'C:\Program Files\Java\jre1.8.0_251'
$env:CASSANDRA_HOME = 'C:\apache-cassandra-3.11.17'
& 'C:\apache-cassandra-3.11.17\bin\nodetool.bat' snapshot -t $Tag $Keyspace
if ($LASTEXITCODE -ne 0) { throw 'Cassandra snapshot failed' }
