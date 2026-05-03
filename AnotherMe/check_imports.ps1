$baseDir = "anotherme2_engine/agents"
$subDirs = @("foundation", "perception", "planning", "execution", "orchestration")
$missingCount = 0

foreach ($subDir in $subDirs) {
    $dirPath = Join-Path $baseDir $subDir
    if (Test-Path $dirPath) {
        $files = Get-ChildItem -Path $dirPath -Filter "*.py"
        foreach ($file in $files) {
            $content = Get-Content $file.FullName
            foreach ($line in $content) {
                if ($line -match '^from\s+\.(\w+)\s+import') {
                    $moduleName = $Matches[1]
                    $modulePath = Join-Path $dirPath "$moduleName.py"
                    if (-not (Test-Path $modulePath)) {
                        Write-Output "$($file.FullName) -> missing local module $moduleName"
                        $missingCount++
                    }
                }
            }
        }
    }
}

Write-Output "`nTotal missing local modules: $missingCount"
