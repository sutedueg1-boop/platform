$appJsPath = "public\app.js"
$content = Get-Content $appJsPath -Raw -Encoding UTF8

$drillsJs = @"

// ============================================================
// 🚨 DRILLS MODULE (FRONTEND)
// ============================================================

async function loadWorkerDrill(isSilent = false) {
  if (!currentEmployee) return;
  
  const textEl = document.getElementById('drlWorkerStatText');
  const barEl = document.getElementById('drlWorkerProgressBar');
  const activeArea = document.getElementById('drlWorkerActiveSessionArea');
  const historyList = document.getElementById('drlWorkerHistoryList');

  try {
    const res = await fetch(`/api/drills/worker/` + encodeURIComponent(currentEmployee.empCode));
    const data = await res.json();
    
    const activeSession = data.activeSession;
    const myHistory = data.myHistory || [];
    const totalClosed = data.totalClosed || 0;
    const myAttended = data.myAttended || 0;

    const pct = totalClosed > 0 ? Math.round((myAttended / totalClosed) * 100) : 0;
    textEl.textContent = `🎯 حضرت ${myAttended} من إجمالي ${totalClosed} تجربة أداء مغلقة (نسبة الحضور: ${pct}%)`;
    barEl.style.width = `${pct}%`;
    barEl.style.background = pct >= 80 ? 'var(--success)' : (pct >= 50 ? '#f39c12' : 'var(--danger)');

    if (activeSession) {
      const alreadyAttended = activeSession.attendees.find(a => normalizeEmpCode(a.empCode) === normalizeEmpCode(currentEmployee.empCode));
      if (alreadyAttended) {
        activeArea.innerHTML = `
          <div class="ticket" style="border-left: 5px solid var(--success);">
            <div class="ticket-body" style="text-align:center;">
              <h3 style="color:var(--success); margin:0 0 8px 0;">✅ تم تسجيل حضورك بنجاح</h3>
              <p style="margin:0; font-size:14px;">تجربة: <strong>${escapeHtml(activeSession.title)}</strong></p>
            </div>
          </div>`;
      } else {
        activeArea.innerHTML = `
          <div class="ticket" style="border-left: 5px solid #ef4444;">
            <div class="ticket-body">
              <h3 style="margin:0 0 4px 0; color:#ef4444;">🚨 تجربة أداء جارية الآن</h3>
              <p style="margin:0 0 12px 0; font-size:14px; font-weight:700;">${escapeHtml(activeSession.title)} | ${escapeHtml(activeSession.location)}</p>
              <div style="display:flex; gap:8px;">
                <input type="text" id="drlWorkerPin" placeholder="أدخل رمز الجلسة (PIN)" style="flex:1; text-align:center; font-family:monospace; font-size:18px; font-weight:bold; letter-spacing:4px;" maxlength="4">
                <button class="submit-btn" style="flex:1; background:#ef4444; border-color:#ef4444;" onclick="submitDrillAttendance('${activeSession.id}')">✅ تسجيل حضوري</button>
              </div>
              <div id="drlWorkerMsg" class="wl-msg" style="margin-top:8px;"></div>
            </div>
          </div>`;
      }
    } else {
      activeArea.innerHTML = `
        <div class="ticket">
          <div class="ticket-body" style="text-align:center; color:var(--muted); font-size:14px;">
            لا توجد تجارب أداء جارية في الوقت الحالي.
          </div>
        </div>`;
    }

    if (myHistory.length === 0) {
      historyList.innerHTML = '<div class="empty">لم تسجل حضور في أي تجربة حتى الآن.</div>';
    } else {
      historyList.innerHTML = `
        <div class="um-table-wrap">
          <table class="um-table">
            <thead><tr><th>التاريخ</th><th>الموضوع</th><th>الحالة</th></tr></thead>
            <tbody>
              ${myHistory.map(h => {
                const stText = h.status || '';
                let stHtml = escapeHtml(stText);
                if (stText.includes('غائب')) {
                  stHtml = `<span class="badge badge-danger" style="background:#fee2e2; color:#b91c1c; border:1px solid #f87171; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${stText}</span>`;
                } else if (stText.includes('مؤكد')) {
                  stHtml = `<span class="badge badge-success" style="background:#dcfce7; color:#15803d; border:1px solid #86efac; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${stText}</span>`;
                } else {
                  stHtml = `<span class="badge badge-warning" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; white-space:nowrap; display:inline-block;">${stText}</span>`;
                }
                return `
                <tr>
                  <td style="font-size:12px; color:var(--muted);">${escapeHtml(h.date)}</td>
                  <td style="font-weight:700; font-size:13px;">${escapeHtml(h.title)}</td>
                  <td style="font-size:12px; font-weight:700;">${stHtml}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch (e) { console.error(e); }
}

async function submitDrillAttendance(sessionId) {
  const pin = document.getElementById('drlWorkerPin').value;
  const msgEl = document.getElementById('drlWorkerMsg');
  if (!pin || pin.length !== 4) {
    msgEl.textContent = 'الرجاء إدخال الرمز المكون من 4 أرقام';
    msgEl.className = 'um-msg error show';
    return;
  }
  try {
    const res = await fetch(`/api/drills/${sessionId}/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode: currentEmployee.empCode, pin: pin })
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = '✅ تم تسجيل حضورك';
      msgEl.className = 'um-msg success show';
      setTimeout(loadWorkerDrill, 1500);
    } else {
      msgEl.textContent = data.error || 'فشل التسجيل';
      msgEl.className = 'um-msg error show';
    }
  } catch(e) {
    msgEl.textContent = 'خطأ اتصال';
    msgEl.className = 'um-msg error show';
  }
}

async function loadAdminDrill(isSilent = false) {
  const container = document.getElementById('drlAdminLiveSessions');
  if (!container) return;
  try {
    const res = await authFetch('/api/drills');
    if (!res.ok) return;
    const data = await res.json();
    const activeDrills = (data.drills || []).filter(d => d.status === 'active' && !d.isDeleted);
    
    if (activeDrills.length === 0) {
      container.innerHTML = '<div class="empty">لا توجد تجارب أداء جارية الآن.</div>';
      return;
    }

    container.innerHTML = activeDrills.map(drl => {
      return `
        <div class="ticket" style="border-left: 5px solid #ef4444; margin-bottom:16px;">
          <div class="ticket-head" style="background:#ef4444; flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%;">
              <div class="ttype">🚨 ${escapeHtml(drl.title)}</div>
              <div class="tid">PIN: <span style="font-size:22px; font-family:monospace; background:white; color:black; padding:2px 8px; border-radius:4px;">${escapeHtml(drl.sessionPin)}</span></div>
            </div>
            <div style="font-size:12px; margin-top:6px; opacity:0.9;">
              📍 المكان: ${escapeHtml(drl.location)} | ⏱️ من ${escapeHtml(drl.startTime)} إلى ${escapeHtml(drl.endTime)}
            </div>
          </div>
          <div class="ticket-body">
            <h4 style="margin:0 0 12px 0;">سجل الحضور (${drl.attendees ? drl.attendees.length : 0})</h4>
            ${!drl.attendees || drl.attendees.length === 0 ? '<div class="empty">لم يسجل أحد بعد...</div>' : `
              <div class="um-table-wrap">
                <table class="um-table">
                  <thead><tr><th>الموظف</th><th>تأكيد المشرف</th></tr></thead>
                  <tbody>
                    ${drl.attendees.map(a => `
                      <tr>
                        <td>
                          <div style="font-weight:bold;">${escapeHtml(a.name || a.empCode)}</div>
                          <div style="font-size:12px; color:var(--muted);">${escapeHtml(a.department)} | ${escapeHtml(a.jobTitle)}</div>
                        </td>
                        <td>
                          <label class="toggle-switch">
                            <input type="checkbox" ${a.verified ? 'checked' : ''} onchange="toggleDrlVerification('${drl.id}', '${a.empCode}', this.checked)">
                            <span class="toggle-slider"></span>
                          </label>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
            <div style="margin-top:16px; text-align:left;">
              <button class="submit-btn" style="background:var(--danger); border-color:var(--danger);" onclick="closeDrillSession('${drl.id}')">🔒 إنهاء وإغلاق التجربة</button>
              <button class="logout-btn" style="border:none; color:var(--danger); margin-right:8px;" onclick="deleteDrillSession('${drl.id}')">🗑️ حذف الإدخال</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch(e) {}
}

async function createDrillSession() {
  const title = document.getElementById('drl_title').value;
  const targetGroup = document.getElementById('drl_targetGroup').value;
  const location = document.getElementById('drl_location').value;
  const date = document.getElementById('drl_date').value;
  const startTime = document.getElementById('drl_startTime').value;
  const endTime = document.getElementById('drl_endTime').value;
  const trainer = document.getElementById('drl_trainer').value;
  const trainerCode = document.getElementById('drl_trainerCode').value;
  const msgEl = document.getElementById('drl_createMsg');

  if (!title || !date || !startTime || !endTime) {
    msgEl.textContent = 'البيانات الأساسية (العنوان، التاريخ، الوقت) مطلوبة';
    msgEl.className = 'wl-msg error show';
    return;
  }
  const sessionPin = Math.floor(1000 + Math.random() * 9000).toString();
  const payload = { title, targetGroup, location, date, startTime, endTime, sessionPin, trainer, trainerCode };

  try {
    const res = await authFetch('/api/drills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      msgEl.textContent = `تم الإنشاء! الرمز السري للجلسة: ${sessionPin}`;
      msgEl.className = 'wl-msg success show';
      document.getElementById('drl_title').value = '';
      loadAdminDrill(true);
    } else {
      msgEl.textContent = data.error || 'فشل الإنشاء';
      msgEl.className = 'wl-msg error show';
    }
  } catch(e) {
    msgEl.textContent = 'خطأ اتصال';
    msgEl.className = 'wl-msg error show';
  }
}

async function closeDrillSession(id) {
  if (!confirm('هل أنت متأكد من إنهاء وإغلاق التجربة؟ (لن يتمكن العمال من تسجيل الحضور بعد ذلك)')) return;
  try {
    const res = await authFetch(`/api/drills/${id}/close`, { method: 'PUT' });
    if (res.ok) loadAdminDrill(true);
  } catch(e) {}
}

async function deleteDrillSession(id) {
  if (!confirm('هل أنت متأكد من حذف التجربة نهائياً؟')) return;
  try {
    const res = await authFetch(`/api/drills/${id}`, { method: 'DELETE' });
    if (res.ok) loadAdminDrill(true);
  } catch(e) {}
}

async function toggleDrlVerification(id, empCode, verified) {
  try {
    const res = await authFetch(`/api/drills/${id}/verify/${encodeURIComponent(empCode)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) loadAdminDrill(true);
  } catch(e) {}
}

"@

$content = $content -replace '(?s)(// ============================================================\r?\n// 🖼️ LIGHTBOX LOGIC)', "$drillsJs`n`n`$1"
Set-Content -Path $appJsPath -Value $content -Encoding UTF8
Write-Host "Drills JS injected"
