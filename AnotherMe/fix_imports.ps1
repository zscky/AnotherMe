$mapping = @{
    "base_agent" = "foundation";
    "config" = "foundation";
    "fallback_matrix" = "foundation";
    "runtime_context" = "foundation";
    "parallel_subagent_executor" = "foundation";
    "state" = "foundation";
    "state_contracts" = "foundation";
    "vision_tool" = "perception";
    "vision_agent" = "perception";
    "geometry_fact_compiler" = "perception";
    "coordinate_scene" = "perception";
    "scene_graph" = "perception";
    "graph_builder" = "perception";
    "validator" = "perception";
    "learner_modeling_agent" = "planning";
    "script_agent" = "planning";
    "teaching_ir" = "planning";
    "problem_pattern" = "planning";
    "action_executability_checker" = "planning";
    "scene_graph_updater" = "planning";
    "animation_planner" = "planning";
    "canvas_scene" = "planning";
    "template_helpers" = "planning";
    "template_retriever" = "planning";
    "animation_agent" = "execution";
    "voice_agent" = "execution";
    "repair_agent" = "execution";
    "merge_agent" = "execution";
    "formal_video_validator" = "execution";
    "error_classifier" = "execution";
    "case_replay_recorder" = "execution";
    "manim_prew" = "execution";
    "workflow" = "orchestration";
    "coordinator_agent" = "orchestration"
}
$baseDir = "anotherme2_engine/agents"
$categories = "foundation", "perception", "planning", "execution", "orchestration"
$results = @()
foreach ($cat in $categories) {
    $dirPath = Join-Path $baseDir $cat
    if (Test-Path $dirPath) {
        $files = Get-ChildItem -Path $dirPath -Filter "*.py" | Where-Object { $_.Name -ne "__init__.py" }
        foreach ($file in $files) {
            $content = [System.IO.File]::ReadAllText($file.FullName)
            $newContent = $content
            $replaceCount = 0
            
            # Match "from ..<oldCat>.<module> import" OR "from .<module> import"
            # We want to normalize all of them based on the mapping and the current file's category.
            
            # Pattern 1: from .<module> import
            $regex1 = [regex]'from \.(\w+)([ \.\n\r\t,])'
            $matches = $regex1.Matches($newContent)
            for ($i = $matches.Count - 1; $i -ge 0; $i--) {
                $match = $matches[$i]
                $moduleName = $match.Groups[1].Value
                $suffix = $match.Groups[2].Value
                if ($mapping.ContainsKey($moduleName)) {
                    $targetCat = $mapping[$moduleName]
                    $newStatement = if ($targetCat -eq $cat) { "from .$moduleName$suffix" } else { "from ..$targetCat.$moduleName$suffix" }
                    if ($match.Value -ne $newStatement) {
                        $newContent = $newContent.Remove($match.Index, $match.Length).Insert($match.Index, $newStatement)
                        $replaceCount++
                    }
                }
            }
            
            # Pattern 2: from ..<anyCat>.<module> import
            $regex2 = [regex]'from \.\.\w+\.(\w+)([ \.\n\r\t,])'
            $matches = $regex2.Matches($newContent)
            for ($i = $matches.Count - 1; $i -ge 0; $i--) {
                $match = $matches[$i]
                $moduleName = $match.Groups[1].Value
                $suffix = $match.Groups[2].Value
                if ($mapping.ContainsKey($moduleName)) {
                    $targetCat = $mapping[$moduleName]
                    $newStatement = if ($targetCat -eq $cat) { "from .$moduleName$suffix" } else { "from ..$targetCat.$moduleName$suffix" }
                    if ($match.Value -ne $newStatement) {
                        $newContent = $newContent.Remove($match.Index, $match.Length).Insert($match.Index, $newStatement)
                        $replaceCount++
                    }
                }
            }

            if ($replaceCount -gt 0) {
                [System.IO.File]::WriteAllText($file.FullName, $newContent)
                $results += [PSCustomObject]@{ File = $file.FullName; Replacements = $replaceCount }
            }
        }
    }
}
if ($results.Count -eq 0) { Write-Host "No changes were made." } else { $results | Format-Table -AutoSize }
