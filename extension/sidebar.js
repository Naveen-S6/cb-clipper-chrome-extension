// Sidebar Logic - largely reused from popup.js but handled for sidebar context

document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('clips-list');
    const openDashboardBtn = document.getElementById('open-dashboard');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    const captureBtn = document.getElementById('btn-sidebar-capture');
    const statsSection = document.getElementById('stats-section');

    // --- Navigation ---
    if (captureBtn) captureBtn.onclick = () => {
        // 1. Hide Sidebar
        window.parent.postMessage({ action: "HIDE_SIDEBAR" }, "*");

        // 2. Wait for hide transition (short delay), then Capture
        setTimeout(() => {
            chrome.runtime.sendMessage({ action: "capture_clip" }, (response) => {
                if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);

                // 3. Show Sidebar again
                window.parent.postMessage({ action: "SHOW_SIDEBAR" }, "*");
            });
        }, 200); // Wait 200ms to ensure it's hidden
    };

    openDashboardBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") });
    });

    closeSidebarBtn.addEventListener('click', () => {
        // Find the parent window (the webpage) and tell it to close the sidebar
        // Since we are in an iframe, we post a message to parent
        window.parent.postMessage({ action: "CLOSE_SIDEBAR" }, "*");
    });

    // --- Stats (Load from STORAGE LOCAL) ---
    function updateStats() {
        chrome.storage.local.get(['cb_streak_data', 'cb_activity_log'], (result) => {
            const streakData = result.cb_streak_data;
            const activityLog = result.cb_activity_log;

            if (streakData || activityLog) {
                // Streak
                if (streakData) {
                    let parsed = streakData;
                    if (typeof streakData === 'string') try { parsed = JSON.parse(streakData); } catch (e) { }

                    if (parsed && parsed.count) {
                        document.getElementById('streak-count').textContent = `${parsed.count} Days`;
                    }
                }

                // Focus
                if (activityLog) {
                    let parsed = activityLog;
                    if (typeof activityLog === 'string') try { parsed = JSON.parse(activityLog); } catch (e) { }

                    if (parsed) {
                        const today = new Date().toISOString().split('T')[0];
                        const todayStats = parsed[today];
                        if (todayStats) {
                            const totalSeconds = todayStats.focusSeconds || 0;
                            const m = Math.floor(totalSeconds / 60);
                            const h = Math.floor(m / 60);
                            const displayM = m % 60;
                            let timeStr = h > 0 ? `${h}h ${displayM}m` : `${m}m`;
                            document.getElementById('focus-time').textContent = timeStr;
                        }
                    }
                }
            }
        });
    }
    updateStats();

    // --- Timer UI (Injecting dynamically) ---
    const timerContainer = document.createElement('div');
    timerContainer.id = 'popup-timer';
    timerContainer.style.cssText = 'padding: 16px; background: #f0fdf4; border-bottom: 1px solid #bbf7d0; text-align: center; display: none;';
    statsSection.parentNode.insertBefore(timerContainer, statsSection.nextSibling);

    function updateTimerUI() {
        chrome.storage.local.get(['timerState'], (result) => {
            const state = result.timerState || { status: 'idle' };

            timerContainer.style.display = 'block';

            // --- IDLE STATE ---
            if (state.status === 'idle' || state.status === 'completed') {
                timerContainer.style.background = '#f9fafb';
                timerContainer.style.borderColor = '#e5e7eb';

                timerContainer.innerHTML = `
                <div style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 8px;">
                    Quick Start
                </div>

                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button id="btn-start-focus" style="flex: 1; padding: 8px; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                        <span>🎯</span> Focus (25m)
                    </button>
                    <button id="btn-start-break" style="flex: 1; padding: 8px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                        <span>☕</span> Break (5m)
                    </button>
                </div>
            `;

                const btnStartFocus = document.getElementById('btn-start-focus');
                if (btnStartFocus) btnStartFocus.onclick = () => {
                    chrome.runtime.sendMessage({
                        action: 'TIMER_START',
                        payload: { mode: 'focus', type: 'timer', duration: 25, sessionDetails: { name: 'Focus Session', tag: 'General' } }
                    });
                    setTimeout(updateTimerUI, 100);
                };

                const btnStartBreak = document.getElementById('btn-start-break');
                if (btnStartBreak) btnStartBreak.onclick = () => {
                    chrome.runtime.sendMessage({
                        action: 'TIMER_START',
                        payload: { mode: 'break', type: 'timer', duration: 5, sessionDetails: { name: 'Break', tag: 'General' } }
                    });
                    setTimeout(updateTimerUI, 100);
                };
                return;
            }

            // --- RUNNING / PAUSED STATE ---
            timerContainer.style.background = state.mode === 'focus' ? '#eef2ff' : '#f0fdf4';
            timerContainer.style.borderColor = state.mode === 'focus' ? '#e0e7ff' : '#bbf7d0';

            let displaySeconds = 0;
            if (state.status === 'running') {
                const now = Date.now();
                if (state.type === 'timer') {
                    displaySeconds = Math.max(0, Math.ceil((state.targetTime - now) / 1000));
                } else {
                    displaySeconds = (state.timeRemaining || 0) + Math.floor((now - state.startTime) / 1000);
                }
            } else {
                displaySeconds = state.timeRemaining || 0;
            }

            const m = Math.floor(displaySeconds / 60);
            const s = displaySeconds % 60;
            const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

            timerContainer.innerHTML = `
            <div style="font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                ${state.status === 'paused' ? 'PAUSED' : (state.mode === 'focus' ? 'FOCUSING' : 'ON BREAK')}
            </div>
            <div style="font-size: 32px; font-weight: 700; font-family: monospace; color: #1f2937; line-height: 1;">
                ${timeStr}
            </div>
            <div style="margin-top: 8px; display: flex; gap: 8px; justify-content: center;">
                ${state.status === 'running'
                    ? `<button id="btn-pause" style="padding: 4px 12px; font-size: 11px; font-weight: 600; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;">PAUSE</button>`
                    : `<button id="btn-resume" style="padding: 4px 12px; font-size: 11px; font-weight: 600; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">RESUME</button>`
                }
                <button id="btn-stop" style="padding: 4px 12px; font-size: 11px; font-weight: 600; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">STOP</button>
            </div>
        `;

            const btnPause = document.getElementById('btn-pause');
            const btnResume = document.getElementById('btn-resume');
            const btnStop = document.getElementById('btn-stop');

            if (btnPause) btnPause.onclick = () => { chrome.runtime.sendMessage({ action: 'TIMER_PAUSE' }); setTimeout(updateTimerUI, 100); };
            if (btnResume) btnResume.onclick = () => { chrome.runtime.sendMessage({ action: 'TIMER_START', payload: { mode: state.mode, type: state.type } }); setTimeout(updateTimerUI, 100); };
            if (btnStop) btnStop.onclick = () => { chrome.runtime.sendMessage({ action: 'TIMER_STOP', payload: { save: true } }); setTimeout(updateTimerUI, 100); };
        });
    }

    // Poll for Timer updates
    setInterval(updateTimerUI, 1000);
    updateTimerUI();

    // Listen for storage changes to update statistics in real-time
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.cb_streak_data || changes.cb_activity_log)) {
            updateStats();
        }
        if (area === 'local' && changes.timerState) {
            updateTimerUI();
        }
    });

    // --- Clips List ---
    async function loadClips() {
        try {
            if (typeof getAllClips !== 'function') {
                // Wait for IDB helper
                setTimeout(loadClips, 500);
                return;
            }

            const clips = await getAllClips();
            if (!clips || clips.length === 0) {
                list.innerHTML = '<div class="empty-state">No clips yet. Start capturing!</div>';
                return;
            }

            const recentClips = clips.sort((a, b) => new Date(b.metadata.capturedAt) - new Date(a.metadata.capturedAt)).slice(0, 50); // Show more in sidebar?
            list.innerHTML = '';

            recentClips.forEach(clip => {
                const item = document.createElement('li');
                item.className = 'clip-item';

                // Layout:
                // 1. Note (if exists) - Yellow box
                // 2. Screenshot (if exists)
                // 3. Content (Text)
                // 4. Footer

                let html = '';

                // Note
                if (clip.note) {
                    html += `<div style="background: #fef08a; color: #854d0e; padding: 8px; border-radius: 4px; font-size: 13px; margin-bottom: 8px; font-weight: 500;">${clip.note}</div>`;
                }

                // Screenshot
                if (clip.screenshot) {
                    html += `<div style="margin-bottom: 8px; border-radius: 4px; overflow: hidden; border: 1px solid #e5e7eb; max-height: 60px; display: flex; align-items: center; justify-content: center; background: #f9fafb;">
                        <img src="${clip.screenshot}" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>`;
                }

                // Content
                if (clip.content) {
                    const contentValues = clip.content.length > 100 ? clip.content.substring(0, 100) + '...' : clip.content;
                    html += `<div class="clip-text" style="${clip.note ? 'color: #4b5563;' : ''}">${contentValues}</div>`;
                }

                // Footer
                const date = new Date(clip.metadata.capturedAt);
                const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                html += `
                    <div class="clip-footer">
                        <span style="max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${clip.metadata.hostname || 'Web Page'}</span>
                        <span>${timeStr}</span>
                    </div>
                `;

                item.innerHTML = html;
                item.addEventListener('click', () => {
                    window.open(clip.metadata.url, '_blank');
                });
                list.appendChild(item);
            });

        } catch (err) {
            console.error("Error loading clips:", err);
            list.innerHTML = '<div class="empty-state">Error loading clips.</div>';
        }
    }

    // --- Message Listener for Refreshing Data ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "CLIPS_UPDATED" || request.action === "refresh_sidebar_data") {
            console.log("Refreshing sidebar data...");
            loadClips();
            updateStats();
        }
    });

    loadClips();
});
