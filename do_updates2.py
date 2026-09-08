import re

with open('public/app.js', 'r', encoding='utf-8') as f:
    app = f.read()

with open('server.js', 'r', encoding='utf-8') as f:
    server = f.read()

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ---------------------------------------------------------
# 5. Add "Emergency Drills" Count to Employee List
# ---------------------------------------------------------
# In index.html, add column header
html = html.replace('<th>🎓 المحاضرات</th>', '<th>🎓 المحاضرات</th>\n              <th>🚨 تجارب الطوارئ</th>')
# Wait, the header is actually in app.js!
app = app.replace('<th>🎓 المحاضرات</th>', '<th>🎓 المحاضرات</th>\n              <th>🚨 تجارب الطوارئ</th>')

# In app.js renderEmployeesTableRows
app = app.replace(
    'const tPerc = e.tPerc;',
    'const tPerc = e.tPerc;\n    const dCount = e.stats && e.stats.drillsCount ? e.stats.drillsCount : 0;'
)

row_replacement = """          <span class="emp-role-badge ${tBadgeClass}" style="min-width:35px;text-align:center;font-size:10px;">${tPerc}%</span>
        </div>
      </td>
      <td>
        <div style="font-size:12px; font-weight:bold; margin-bottom:4px; color:var(--danger);">${dCount} تجربة</div>
      </td>
      <td>"""
app = app.replace(
    """          <span class="emp-role-badge ${tBadgeClass}" style="min-width:35px;text-align:center;font-size:10px;">${tPerc}%</span>
        </div>
      </td>
      <td>
        <div class="um-action-btns">""",
    row_replacement + '\n        <div class="um-action-btns">'
)

# In server.js `GET /api/employees` to add drillsCount
server = server.replace(
    'let hCount = 0;\n      let tCount = 0;',
    'let hCount = 0;\n      let tCount = 0;\n      let dCount = 0;'
)
server = server.replace(
    'let tCount = 0;',
    'let tCount = 0;\n      let dCount = 0;'
)

server_drills_loop = """
      const drills = readDrills();
      drills.forEach(drl => {
        if (drl.status === 'closed' || drl.isClosed) {
          const me = drl.attendees.find(a => normalizeEmpCode(a.empCode) === normalizeEmpCode(e.code || e.empCode));
          if (me && me.verified) dCount++;
        }
      });
"""
server = server.replace(
    '          if (me && me.verified) tCount++;\n        }\n      });',
    '          if (me && me.verified) tCount++;\n        }\n      });' + server_drills_loop
)
server = server.replace(
    'trainingsCount: tCount',
    'trainingsCount: tCount, drillsCount: dCount'
)

# ---------------------------------------------------------
# 6. Update Worker Drill Stats Logic
# ---------------------------------------------------------
# In app.js
app = re.sub(
    r'const pct = totalClosed > 0 \? Math\.round\(\(myAttended / totalClosed\) \* 100\) : 0;\s*textEl\.textContent = `🎯 حضرت \$\{myAttended\} من إجمالي \$\{totalClosed\} تجربة أداء مغلقة \(نسبة الحضور: \$\{pct\}%\)`;\s*barEl\.style\.width = `\$\{pct\}%`;\s*barEl\.style\.background = pct >= 80 \? \'var\(--success\)\' : \(pct >= 50 \? \'#f39c12\' : \'var\(--danger\)\'\);',
    r'textEl.textContent = `🎯 حضرت ${myAttended} تجربة طوارئ`;\n    if(barEl && barEl.parentElement) barEl.parentElement.style.display = "none";',
    app
)

# ---------------------------------------------------------
# 7. Update Worker Training Stats Logic (Hours instead of %)
# ---------------------------------------------------------
# In app.js `loadWorkerTraining`
app = re.sub(
    r'const pct = totalClosed > 0 \? Math\.round\(\(myAttended / totalClosed\) \* 100\) : 0;\s*textEl\.textContent = `🎓 حضرت \$\{myAttended\} من إجمالي \$\{totalClosed\} محاضرة \(نسبة الحضور: \$\{pct\}%\)`;\s*barEl\.style\.width = `\$\{pct\}%`;\s*barEl\.style\.background = pct >= 80 \? \'var\(--success\)\' : \(pct >= 50 \? \'#f39c12\' : \'var\(--danger\)\'\);',
    r'const hours = myAttended * 0.5;\n    const pct = Math.min(100, Math.round((hours / 8) * 100));\n    textEl.textContent = `🎓 حضرت ${hours} ساعة من إجمالي 8 ساعات`;\n    barEl.style.width = `${pct}%`;\n    barEl.style.background = pct >= 100 ? \'var(--success)\' : \'#3b82f6\';',
    app
)


with open('public/app.js', 'w', encoding='utf-8') as f:
    f.write(app)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Remaining updates applied successfully.")
