$indexHtmlPath = "public\index.html"
$appJsPath = "public\app.js"
$styleCssPath = "public\style.css"
$serverJsPath = "server.js"

# 1. Update index.html
$indexHtml = Get-Content $indexHtmlPath -Raw
$indexHtml = $indexHtml -replace '(?s)<script src="https://cdn\.jsdelivr\.net/npm/apexcharts"></script>\s*', ''
$indexHtml = $indexHtml -replace '(?s)<div class="tab" id="tabStats" onclick="switchTab\(''stats''\)">.*?</div>\s*', ''
$indexHtml = $indexHtml -replace '(?s)<!-- 📊 STATISTICS DASHBOARD -->.*?<script src="app\.js', '<script src="app.js'
Set-Content $indexHtmlPath $indexHtml -Encoding UTF8
Write-Host "Updated index.html"

# 2. Update style.css
$styleCss = Get-Content $styleCssPath -Raw
$styleCss = $styleCss -replace '(?s)/\*\s*[=]*\s*📊 PREMIUM STATISTICS DASHBOARD\s*[=]*\s*\*/.*', ''
Set-Content $styleCssPath $styleCss -Encoding UTF8
Write-Host "Updated style.css"

# 3. Update app.js
$appJs = Get-Content $appJsPath -Raw
$appJs = $appJs -replace ",'stats'", ""
$appJs = $appJs -replace "if \(which === 'stats'\) renderStatsDashboard\(\);\s*", ""
$appJs = $appJs -replace '(?s)// ── Shared noData config ──.*(?=// ============================================================)', ''
Set-Content $appJsPath $appJs -Encoding UTF8
Write-Host "Updated app.js"

# 4. Update server.js
$serverJs = Get-Content $serverJsPath -Raw
$serverJs = $serverJs -replace '(?s)// ══════════════════════════════════════════════════════════════\s*// 📊 STATISTICS DASHBOARD API\s*// ══════════════════════════════════════════════════════════════.*?// ══════════════════════════════════════════════════════════════\s*// 🔔 PUSH NOTIFICATIONS', '// ══════════════════════════════════════════════════════════════\r\n// 🔔 PUSH NOTIFICATIONS'
Set-Content $serverJsPath $serverJs -Encoding UTF8
Write-Host "Updated server.js"
