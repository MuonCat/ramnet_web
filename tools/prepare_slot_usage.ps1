param([Parameter(Mandatory = $true)][string]$SourcePath)

$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath $SourcePath -Encoding UTF8 -Raw | ConvertFrom-Json
if ($source.schema -ne 'slot-usage.web.v2' -or $source.slot_count -ne 1024) { throw 'Unsupported slot usage schema.' }

function Expand-U16([string]$encoded) {
    $bytes = [Convert]::FromBase64String($encoded)
    $inputStream = [IO.MemoryStream]::new($bytes, 2, $bytes.Length - 6)
    $deflate = [IO.Compression.DeflateStream]::new($inputStream, [IO.Compression.CompressionMode]::Decompress)
    $outputStream = [IO.MemoryStream]::new()
    $deflate.CopyTo($outputStream)
    $raw = $outputStream.ToArray()
    $values = [uint16[]]::new($raw.Length / 2)
    [Buffer]::BlockCopy($raw, 0, $values, 0, $raw.Length)
    $deflate.Dispose()
    $inputStream.Dispose()
    $outputStream.Dispose()
    return ,$values
}

function Compress-U16([uint16[]]$values) {
    $raw = [byte[]]::new($values.Length * 2)
    [Buffer]::BlockCopy($values, 0, $raw, 0, $raw.Length)
    $outputStream = [IO.MemoryStream]::new()
    $gzip = [IO.Compression.GZipStream]::new($outputStream, [IO.Compression.CompressionLevel]::Optimal, $true)
    $gzip.Write($raw, 0, $raw.Length)
    $gzip.Dispose()
    $encoded = [Convert]::ToBase64String($outputStream.ToArray())
    $outputStream.Dispose()
    return $encoded
}

$labels = @{
    synthetic_prose = 'English prose'; synthetic_structured = 'Code / tables / dialogue'
    niah1_1k = 'S-NIAH-1 · 1K'; niah1_2k = 'S-NIAH-1 · 2K'
    niah3_1k = 'S-NIAH-3 · 1K'; niah3_2k = 'S-NIAH-3 · 2K'
}
$corpora = @($source.corpora | ForEach-Object {
    $ids = Expand-U16 $_.token_ids_u16
    if ($ids.Length -ne $_.token_count) { throw 'Unexpected token dimensions.' }
    @{ id = $_.id; label = $labels[$_.id]; token_count = $_.token_count; sample_count = $_.samples.Count; token_ids_u16 = (Compress-U16 $ids) }
})
$heads = @()
foreach ($head in $source.heads) {
    $contexts = @()
    foreach ($corpus in $source.corpora) {
        $context = $head.contexts | Where-Object corpus -EQ $corpus.id
        $events = Expand-U16 $context.events_u16
        $positions = Expand-U16 $corpus.positions_u16
        $n = $corpus.token_count
        if ($events.Length -ne $n * 16 -or $positions.Length -ne $n) { throw 'Unexpected source dimensions.' }
        # Retain every visit in token order; undo CAPE once before lossless compression.
        for ($t = 0; $t -lt $n; $t++) {
            $shift = if ($head.uses_cape) { [int]$positions[$t] } else { 0 }
            for ($k = 0; $k -lt 16; $k++) {
                $index = $t * 16 + $k
                $physical = [int]$events[$index]
                if ($physical -ge 1024) { throw 'Invalid slot address.' }
                $events[$index] = ($physical + $shift) % 1024
            }
        }
        $contexts += @{ corpus = $corpus.id; events_u16 = (Compress-U16 $events) }
    }
    $heads += @{ id = $head.id; layer = $head.layer; head = $head.head; uses_cape = $head.uses_cape; contexts = $contexts }
    Write-Output ('Prepared head ' + $head.id)
}
$cleaned = [ordered]@{
    schema = 'slot-usage.tokens.v1'; slot_count = 1024; top_k = 8; directions = @('write', 'read')
    encoding = 'base64 of gzip-compressed little-endian uint16 arrays'
    address_basis = 'canonical'; phase = $source.phase; bos_excluded = $source.bos_excluded
    canonical_address = $source.canonical_address
    source = 'slot_usage_data.json'
    animation_unit = 'One actual token, with eight write visits followed by eight read visits. No sampling or aggregation.'
    corpus_limitations = $source.corpus_limitations
    vocabulary = $source.vocabulary; corpora = $corpora; heads = $heads
}
$target = Join-Path $PSScriptRoot '../data/probes/slot_usage.json'
[IO.File]::WriteAllText([IO.Path]::GetFullPath($target), ($cleaned | ConvertTo-Json -Depth 10 -Compress), [Text.UTF8Encoding]::new($false))
Get-Item -LiteralPath $target | Select-Object Name, Length
