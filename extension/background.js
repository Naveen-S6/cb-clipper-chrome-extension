// Background Service Worker
importScripts("idb-helper.js");

// --- TIMER CONTROLLER ---

const DEFAULT_TIMER_STATE = {
    status: 'idle', // idle, running, paused, completed
    mode: 'focus', // focus, break
    type: 'timer', // timer, stopwatch
    startTime: null, // timestamp
    targetTime: null, // timestamp (for timer)
    duration: 25, // minutes
    timeRemaining: 25 * 60, // seconds (for pause/resume)
    sessionDetails: { name: '', tag: 'General' }
};

// Initialize Timer State
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['timerState'], (result) => {
        if (!result.timerState) {
            chrome.storage.local.set({ timerState: DEFAULT_TIMER_STATE });
        }
    });
    console.log("CB Clipper installed/updated");
    chrome.contextMenus.create({
        id: "capture-selection",
        title: "Save to CB Clipper",
        contexts: ["selection"]
    });
});

// Alarm Listener (Timer Finished)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'focusTimer') {
        finishTimer();
    }
});

function finishTimer() {
    chrome.storage.local.get(['timerState'], (result) => {
        const state = result.timerState || DEFAULT_TIMER_STATE;

        // Calculate final duration
        const finalDuration = (state.duration || 25) * 60;

        const newState = {
            ...state,
            status: 'completed',
            timeRemaining: 0,
            startTime: null,
            targetTime: null
        };

        chrome.storage.local.set({ timerState: newState });

        // Broadcast completion (UI can play sound)
        chrome.runtime.sendMessage({ action: 'TIMER_COMPLETE', mode: state.mode });

        // Log Session
        logSession(state.mode, finalDuration, state.sessionDetails);
    });
}

// Session Logging (Syncs with Activity Log in Storage)
function logSession(type, durationSeconds, details) {
    const today = new Date().toISOString().split('T')[0];

    chrome.storage.local.get(['cb_activity_log'], (result) => {
        const log = result.cb_activity_log || {};

        if (!log[today]) log[today] = { visits: 0, focusSeconds: 0, breakSeconds: 0, sessions: [] };

        // Update Totals
        if (type === 'focus') log[today].focusSeconds = (log[today].focusSeconds || 0) + durationSeconds;
        if (type === 'break') log[today].breakSeconds = (log[today].breakSeconds || 0) + durationSeconds;

        // Add Session Entry
        if (!log[today].sessions) log[today].sessions = [];
        log[today].sessions.push({
            ...details,
            timestamp: new Date().toISOString(),
            duration: durationSeconds,
            type: type
        });

        chrome.storage.local.set({ cb_activity_log: log });
    });
}


// Message Handler for Timer
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TIMER_START') {
        startTimer(request.payload);
        sendResponse({ success: true });
        return true;
    }
    else if (request.action === 'TIMER_PAUSE') {
        pauseTimer();
        sendResponse({ success: true });
        return true;
    }
    else if (request.action === 'TIMER_STOP') { // Reset
        stopTimer(request.payload); // Payload can contain 'save' flag for stopwatch
        sendResponse({ success: true });
        return true;
    }
    // Existing handlers...
    else if (request.action === "save_clip") {
        if (typeof addClip === 'function') {
            addClip(request.payload)
                .then((result) => {
                    console.log("Clip saved successfully", result);
                    sendResponse(result);
                    // Broadcast update so sidebar/popup can refresh
                    chrome.runtime.sendMessage({ action: "CLIPS_UPDATED" });
                })
                .catch((err) => {
                    console.error("Failed to save clip", err);
                    sendResponse({ success: false, error: err.message });
                });
        } else {
            console.error("addClip function not found");
            sendResponse({ success: false, error: "Storage helper not loaded" });
        }
        return true;
    } else if (request.action === "get_clip") {
        if (typeof getClip === 'function') {
            getClip(request.payload.id)
                .then((clip) => {
                    sendResponse({ success: true, clip: clip });
                })
                .catch((err) => {
                    console.error("Failed to get clip", err);
                    sendResponse({ success: false, error: err.message });
                });
        } else {
            sendResponse({ success: false, error: "Storage helper not loaded" });
        }
        return true;
    } else if (request.action === "broadcast_video_seek") {
        chrome.tabs.sendMessage(sender.tab.id, {
            action: "seek_video",
            videoTimestamp: request.videoTimestamp
        });
        return true;
    } else if (request.action === "get_all_tags") {
        if (typeof getAllClips === 'function') {
            getAllClips().then((clips) => {
                const tags = new Set();
                clips.forEach(clip => {
                    if (clip.tags && Array.isArray(clip.tags)) {
                        clip.tags.forEach(t => tags.add(t));
                    }
                });
                sendResponse({ success: true, tags: Array.from(tags) });
            }).catch(err => {
                console.error("Error getting tags", err);
                sendResponse({ success: false, error: err.message });
            });
        } else {
            sendResponse({ success: false, error: "Storage helper not loaded" });
        }
        return true;
    } else if (request.action === "capture_clip") {
        // Trigger capture on active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
                performCapture(tabs[0]);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: "No active tab" });
            }
        });
        return true;
    }
});

function startTimer(payload) {
    // payload: { mode, type, duration (mins), sessionDetails }
    chrome.storage.local.get(['timerState'], (result) => {
        let state = result.timerState || DEFAULT_TIMER_STATE;

        // If resuming from pause, use existing timeRemaining
        // If new start, use payload duration
        const isResume = state.status === 'paused' && state.mode === payload.mode && state.type === payload.type;

        // Correct duration handling
        const durationMins = payload.duration || state.duration || 25;

        let durationSecs;
        if (isResume) {
            durationSecs = state.timeRemaining;
        } else {
            // New Start
            if (payload.type === 'stopwatch') {
                durationSecs = 0; // Stopwatch always starts at 0
            } else {
                durationSecs = durationMins * 60; // Timer starts at duration
            }
        }

        const now = Date.now();
        const target = payload.type === 'timer' ? now + (durationSecs * 1000) : null;

        const newState = {
            ...state,
            ...payload,
            duration: durationMins, // Ensure duration is persisted
            status: 'running',
            startTime: now,
            targetTime: target,
            timeRemaining: durationSecs
        };

        chrome.storage.local.set({ timerState: newState });

        if (payload.type === 'timer') {
            chrome.alarms.create('focusTimer', { when: target });
        }
    });
}

function pauseTimer() {
    chrome.storage.local.get(['timerState'], (result) => {
        const state = result.timerState;
        if (state.status !== 'running') return;

        chrome.alarms.clear('focusTimer');

        // Calculate remaining
        const now = Date.now();
        let remaining = 0;

        if (state.type === 'timer') {
            const left = Math.max(0, Math.ceil((state.targetTime - now) / 1000));
            remaining = left;
        } else {
            // Stopwatch: Time elapsed
            const elapsed = Math.floor((now - state.startTime) / 1000);
            remaining = (state.timeRemaining || 0) + elapsed; // Accumulated
        }

        chrome.storage.local.set({
            timerState: { ...state, status: 'paused', timeRemaining: remaining }
        });
    });
}

function stopTimer(payload) { // payload might have { save: boolean } for stopwatch
    chrome.storage.local.get(['timerState'], (result) => {
        const state = result.timerState;
        chrome.alarms.clear('focusTimer');

        // Logic to save session if it was running or paused (and not idle)
        // For Timer: StartTime is set, Duration is set. 
        // We want to record how much time was actually spent.
        // If state.status was 'running', time spent = now - startTime.
        // If state.status was 'paused', time spent = (duration * 60) - timeRemaining.

        let shouldSave = false;
        let elapsed = 0;
        const now = Date.now();

        if (state.status !== 'idle' && state.status !== 'completed') {
            if (state.type === 'stopwatch') {
                if (payload?.save) {
                    shouldSave = true;
                    if (state.status === 'running') {
                        elapsed = Math.floor((now - state.startTime) / 1000) + (state.timeRemaining || 0);
                    } else {
                        elapsed = state.timeRemaining;
                    }
                }
            } else if (state.type === 'timer') {
                // For timer, we always want to record the "partial" session if stopped early? 
                // Or only if the user explicitly wants to? 
                // The request says "when stopped in between is not recording... this needs to record".
                // So we assume we always save effectively spent time.
                shouldSave = true;

                if (state.status === 'running') {
                    // Total duration - remaining
                    // But easier: elapsed = now - startTime (if it was a fresh run without pauses).
                    // Correct logic with pauses being handled by update of startTime/timeRemaining is tricky.
                    // simpler:
                    // timeRemaining is only updated on PAUSE. 
                    // When RUNNING, we rely on targetTime. 
                    // elapsed = duration*60 - (targetTime - now)/1000

                    const timeLeft = Math.max(0, Math.ceil((state.targetTime - now) / 1000));
                    elapsed = (state.duration * 60) - timeLeft;
                } else {
                    // Paused
                    elapsed = (state.duration * 60) - state.timeRemaining;
                }
            }
        }

        if (shouldSave && elapsed > 0) {
            logSession(state.mode, elapsed, state.sessionDetails);
        }

        chrome.storage.local.set({ timerState: DEFAULT_TIMER_STATE });
        chrome.runtime.sendMessage({ action: 'TIMER_UPDATE' }); // Force UI refresh
    });
}


// Listen for Context Menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "capture-selection") {
        performCapture(tab);
    }
});

// Listen for Commands (Hotkeys)
chrome.commands.onCommand.addListener((command) => {
    console.log("Command received:", command);
    if (command === "capture_clip") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            performCapture(tabs[0]);
        });
    }
});

async function performCapture(activeTab) {
    if (!activeTab || !activeTab.id) return;

    // Capture screenshot
    chrome.tabs.captureVisibleTab(activeTab.windowId, { format: "jpeg", quality: 50 }, async (screenshotUrl) => {

        // Query all frames in the tab for their capture data
        const frames = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            func: () => {
                if (typeof getFrameCaptureData === 'function') {
                    return getFrameCaptureData();
                }
                return null;
            }
        }).catch(err => {
            console.error("Script execution failed:", err);
            return [];
        });

        console.log("Responses from frames:", frames);

        let bestSelection = null;
        let bestVideoTimestamp = null;

        // Process responses
        frames.forEach(response => {
            const data = response.result;
            if (!data) return;

            // Preference 1: Non-empty text selection
            if (data.selection && data.selection.trim().length > 0) {
                if (!bestSelection || data.selection.length > bestSelection.length) {
                    bestSelection = data;
                }
            }

            // Preference 2: Video timestamp
            if (data.videoTimestamp) {
                // Keep the "best" timestamp:
                // Prioritize one that has actual time progress (> 0)
                if (!bestVideoTimestamp || (data.videoTimestamp.time > 0 && bestVideoTimestamp.time === 0)) {
                    bestVideoTimestamp = data.videoTimestamp;
                }
            }
        });

        // Fallback for selection: if none found, use top frame bookmark
        if (!bestSelection) {
            const topFrameResponse = frames.find(f => f.frameId === 0);
            if (topFrameResponse && topFrameResponse.result) {
                bestSelection = topFrameResponse.result;
            }
        }

        // Finally, tell the TOP frame to show the modal with the collected data
        if (bestSelection) {
            chrome.tabs.sendMessage(activeTab.id, {
                action: "finalize_capture_and_show_modal",
                data: {
                    selectionData: bestSelection,
                    videoTimestamp: bestVideoTimestamp,
                    screenshot: screenshotUrl
                }
            }, { frameId: 0 });
        }
    });
}
// --- STREAK & VISIT TRACKING ---

function checkAndIncrementStreak() {
    const today = new Date().toDateString();
    const todayISO = new Date().toISOString().split('T')[0];

    // 1. Update Activity Log Visits
    chrome.storage.local.get(['cb_activity_log'], (result) => {
        let log = result.cb_activity_log || {};
        if (typeof log === 'string') try { log = JSON.parse(log); } catch (e) { }

        if (!log[todayISO]) log[todayISO] = { visits: 0, focusSeconds: 0, breakSeconds: 0, sessions: [] };

        // We only want to increment if this is a "new" visit session? 
        // For simplicity, let's just increment. But to avoid spamming on every nav, maybe debounce?
        // Actually, the original logic in HomeView increments on every mount. 
        // Let's stick to updating the streak primarily.

        // Let's increment visits too, but maybe throttle?
        log[todayISO].visits = (log[todayISO].visits || 0) + 1;
        chrome.storage.local.set({ cb_activity_log: log });
    });

    // 2. Update Streak
    chrome.storage.local.get(['cb_streak_data'], (result) => {
        const stored = result.cb_streak_data;
        let currentData = { count: 1, lastVisit: today };

        if (stored) {
            let parsed = stored;
            if (typeof stored === 'string') try { parsed = JSON.parse(stored); } catch (e) { }

            const lastVisitDate = new Date(parsed.lastVisit);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            if (parsed.lastVisit === today) {
                currentData = parsed; // Already visited today
            } else if (lastVisitDate.toDateString() === yesterday.toDateString()) {
                currentData = { count: parsed.count + 1, lastVisit: today }; // Continue streak
            } else {
                currentData = { count: 1, lastVisit: today }; // Reset
            }
        }

        chrome.storage.local.set({ cb_streak_data: currentData });
    });
}

// Listen for navigation to codebasics.io
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('codebasics.io')) {
        console.log("Detected visit to codebasics.io, checking streak...");
        checkAndIncrementStreak();
    }
});
