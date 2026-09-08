import re

with open('inject_drills.ps1', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract between @" and "@
match = re.search(r'@"(.*?)"@', content, re.DOTALL)
if match:
    drills_js = match.group(1)
    
    with open('public/app.js', 'r', encoding='utf-8') as app_js_file:
        app_js = app_js_file.read()
    
    app_js = re.sub(
        r'(// ============================================================\r?\n// 🖼️ LIGHTBOX LOGIC)',
        drills_js + r'\n\n\1',
        app_js,
        flags=re.DOTALL
    )
    
    with open('public/app.js', 'w', encoding='utf-8') as app_js_file:
        app_js_file.write(app_js)
    print("Successfully injected drills code.")
else:
    print("Could not find JS code in ps1 file.")
