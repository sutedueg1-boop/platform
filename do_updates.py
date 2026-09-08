import re
import os

with open('public/app.js', 'r', encoding='utf-8') as f:
    app = f.read()

with open('server.js', 'r', encoding='utf-8') as f:
    server = f.read()

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ---------------------------------------------------------
# 1. API routes in server.js
# ---------------------------------------------------------
if 'DRILLS_FILE' not in server:
    # Add DRILLS_FILE definition
    server = re.sub(
        r"(const TRAININGS_FILE\s*=\s*path\.join\(DATA_DIR,\s*'trainings\.json'\);)",
        r"\1\nconst DRILLS_FILE = path.join(DATA_DIR, 'drills.json');",
        server
    )
    
    # Add initialize file
    server = re.sub(
        r"(if \(!fs\.existsSync\(TRAININGS_FILE\)\) \{\s*fs\.writeFileSync\(TRAININGS_FILE, JSON\.stringify\(\[\], null, 2\), 'utf8'\);\s*\})",
        r"\1\nif (!fs.existsSync(DRILLS_FILE)) {\n  fs.writeFileSync(DRILLS_FILE, JSON.stringify([], null, 2), 'utf8');\n}",
        server
    )

    # Add readDrills / writeDrills
    # Let's extract readTrainings and writeTrainings
    rw_match = re.search(r'(function readTrainings\(\).*?function writeTrainings\(data\).*?})', server, re.DOTALL)
    if rw_match:
        rw_trainings = rw_match.group(1)
        rw_drills = rw_trainings.replace('Trainings', 'Drills').replace('TRAININGS_FILE', 'DRILLS_FILE')
        server = server.replace(rw_trainings, rw_trainings + '\n\n' + rw_drills)

    # Extract trainings routes block
    # Start: // ============================================================ \n // 🎓 API ROUTES — HSE TRAINING MODULE
    # End: before the next // ============================================================
    routes_match = re.search(r'(// ============================================================\r?\n// 🎓 API ROUTES — HSE TRAINING MODULE.*?)(?=\r?\n// ============================================================)', server, re.DOTALL)
    
    if routes_match:
        trainings_routes = routes_match.group(1)
        drills_routes = trainings_routes.replace('TRAINING MODULE', 'DRILLS MODULE')
        drills_routes = drills_routes.replace('🎓', '🚨')
        drills_routes = drills_routes.replace('Trainings', 'Drills')
        drills_routes = drills_routes.replace('trainings', 'drills')
        drills_routes = drills_routes.replace('Training', 'Drill')
        drills_routes = drills_routes.replace('training', 'drill')
        drills_routes = drills_routes.replace('trn', 'drl')
        drills_routes = drills_routes.replace('المحاضرة', 'التجربة')
        drills_routes = drills_routes.replace('محاضرة', 'تجربة')
        drills_routes = drills_routes.replace('Trn', 'Drl')
        drills_routes = drills_routes.replace('TRN', 'DRL')
        drills_routes = drills_routes.replace('topic', 'title') # In drills, it's title, not topic
        
        server = server.replace(trainings_routes, trainings_routes + '\n\n' + drills_routes)

# ---------------------------------------------------------
# 2. Auto-fill Supervisor Data in Drill Form
# ---------------------------------------------------------
# In app.js: update open drill modal function or `loadAdminDrill` to populate trainer info.
# Actually `switchTab` already calls `populateTrainerInfo()`. Let's check populateTrainerInfo.
# In app.js, `populateTrainerInfo` populates `trn_trainer` and `trn_trainerCode`. Let's add `drl_trainer` and `drl_trainerCode`.
app = re.sub(
    r'(document\.getElementById\(\'trn_trainer\'\)\.value\s*=\s*.*?)(?=;)',
    r"\1;\n    if(document.getElementById('drl_trainer')) document.getElementById('drl_trainer').value = currentEmployee ? currentEmployee.name : 'Admin'",
    app
)
app = re.sub(
    r'(document\.getElementById\(\'trn_trainerCode\'\)\.value\s*=\s*.*?)(?=;)',
    r"\1;\n    if(document.getElementById('drl_trainerCode')) document.getElementById('drl_trainerCode').value = currentEmployee ? currentEmployee.empCode : 'ADMIN'",
    app
)

# ---------------------------------------------------------
# 3. Make Drill Location Mandatory
# ---------------------------------------------------------
# In index.html
html = re.sub(
    r'(<input type="text" id="drl_location" placeholder="مثال: ساحة المصنع الرئيسية">)',
    r'<input type="text" id="drl_location" placeholder="مثال: ساحة المصنع الرئيسية" required>',
    html
)
# In app.js: createDrillSession validation
app = re.sub(
    r"(if \(!title \|\| !date \|\| !startTime \|\| !endTime\) \{)",
    r"if (!title || !date || !startTime || !endTime || !location) {",
    app
)

# ---------------------------------------------------------
# 4. Rename Module to "تجارب الطوارئ"
# ---------------------------------------------------------
html = html.replace('تجارب الأداء', 'تجارب الطوارئ')
app = app.replace('تجارب الأداء', 'تجارب الطوارئ')

# ---------------------------------------------------------
# 5. Add "Emergency Drills" Count to Employee List
# ---------------------------------------------------------
# In index.html, find Employees table header and add the column.
html = re.sub(
    r'(<th>المحاضرات</th>)',
    r'\1<th>تجارب الطوارئ</th>',
    html
)
# In app.js `renderEmployeesPanel` or `empList.innerHTML` loop
# Let's search for the row generation
app = re.sub(
    r"(<td style=\"font-weight:700;\">\$\{e\.stats \? e\.stats\.trainingsCount : 0\}</td>)",
    r'\1<td style="font-weight:700;">${e.stats && e.stats.drillsCount ? e.stats.drillsCount : 0} تجربة</td>',
    app
)
# In server.js `GET /api/employees` we need to calculate drillsCount
# Find `employees.map(e => { ... let tCount = 0; ... }`
# We'll replace it to include drills
server = re.sub(
    r'(let hCount = 0;\s*let tCount = 0;)',
    r'\1\n      let dCount = 0;',
    server
)
server = re.sub(
    r'(trainings\.forEach.*?if \(me && me\.verified\) tCount\+\+;\s*\}\s*\});)',
    r'\1\n      const drills = readDrills();\n      drills.forEach(drl => {\n        if (drl.status === "closed" || drl.isClosed) {\n          const me = drl.attendees.find(a => normalizeEmpCode(a.empCode) === normalizeEmpCode(e.code));\n          if (me && me.verified) dCount++;\n        }\n      });',
    server,
    flags=re.DOTALL
)
server = re.sub(
    r'(hazardsCount: hCount,\s*trainingsCount: tCount)',
    r'\1, drillsCount: dCount',
    server
)


# ---------------------------------------------------------
# 6. Update Worker Drill Stats Logic
# ---------------------------------------------------------
# Remove progress bar and update text
app = re.sub(
    r'(const pct = totalClosed > 0 \? Math\.round\(\(myAttended / totalClosed\) \* 100\) : 0;\s*textEl\.textContent = `🎯 حضرت \$\{myAttended\} من إجمالي \$\{totalClosed\} تجربة أداء مغلقة \(نسبة الحضور: \$\{pct\}%\)`;\s*barEl\.style\.width = `\$\{pct\}%`;\s*barEl\.style\.background = pct >= 80 \? \'var\(--success\)\' : \(pct >= 50 \? \'#f39c12\' : \'var\(--danger\)\'\);)',
    r'textEl.textContent = `🎯 حضرت ${myAttended} تجربة طوارئ`;\n    if(barEl && barEl.parentElement) barEl.parentElement.style.display = "none";',
    app
)


# ---------------------------------------------------------
# 7. Update Worker Training Stats Logic (Hours instead of %)
# ---------------------------------------------------------
# In app.js `loadWorkerTraining`
app = re.sub(
    r'(const pct = totalClosed > 0 \? Math\.round\(\(myAttended / totalClosed\) \* 100\) : 0;\s*textEl\.textContent = `🎓 حضرت \$\{myAttended\} من إجمالي \$\{totalClosed\} محاضرة \(نسبة الحضور: \$\{pct\}%\)`;\s*barEl\.style\.width = `\$\{pct\}%`;\s*barEl\.style\.background = pct >= 80 \? \'var\(--success\)\' : \(pct >= 50 \? \'#f39c12\' : \'var\(--danger\)\'\);)',
    r'const hours = myAttended * 0.5;\n    const pct = Math.min(100, Math.round((hours / 8) * 100));\n    textEl.textContent = `🎓 حضرت ${hours} ساعة من إجمالي 8 ساعات`;\n    barEl.style.width = `${pct}%`;\n    barEl.style.background = pct >= 100 ? \'var(--success)\' : \'#3b82f6\';',
    app
)


with open('public/app.js', 'w', encoding='utf-8') as f:
    f.write(app)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Updates applied successfully.")
