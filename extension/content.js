// Content Script

console.log("Universal Clipper Content Script Active");

// --- SIDEBAR WIDGET INJECTION ---
function injectSidebarWidget() {
    // Only inject in the top frame (main window)
    if (window !== top) return;

    // 1. Sticky Button
    const btn = document.createElement('div');
    btn.id = "uc-sticky-btn";
    // We'll use a container for flex layout inside
    btn.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <img src="${chrome.runtime.getURL('icons/sidebar-logo.png')}" alt="CB" style="width: 32px; height: 32px;">
            <span id="uc-sticky-timer" style="display: none; font-weight: 700; font-size: 13px; color: #1f2937; white-space: nowrap;"></span>
        </div>
    `;
    document.body.appendChild(btn);

    // Timer Logic for Sticky Button
    let stickyInterval = null;

    function updateStickyTimer() {
        chrome.storage.local.get(['timerState'], (result) => {
            const state = result.timerState || { status: 'idle' };
            const timerSpan = document.getElementById('uc-sticky-timer');
            const btn = document.getElementById('uc-sticky-btn');

            if (!timerSpan || !btn) return;

            if (state.status === 'running' || state.status === 'paused') {
                timerSpan.style.display = 'block';
                btn.style.width = 'auto'; // Allow expansion
                btn.style.padding = '0 12px'; // Add padding for text

                const updateDisplay = () => {
                    let displaySeconds = 0;
                    if (state.status === 'running') {
                        const now = Date.now();
                        if (state.type === 'timer') {
                            displaySeconds = Math.max(0, Math.ceil((state.targetTime - now) / 1000));
                        } else { // Stopwatch
                            displaySeconds = (state.timeRemaining || 0) + Math.floor((now - state.startTime) / 1000);
                        }
                    } else {
                        displaySeconds = state.timeRemaining || 0;
                    }

                    const m = Math.floor(displaySeconds / 60);
                    const s = displaySeconds % 60;
                    const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

                    timerSpan.textContent = timeStr;

                    // Style for paused
                    if (state.status === 'paused') {
                        timerSpan.style.color = '#9ca3af';
                    } else {
                        timerSpan.style.color = '#1f2937';
                    }
                };

                updateDisplay();

                // If running, keep updating
                if (state.status === 'running') {
                    if (!stickyInterval) stickyInterval = setInterval(updateDisplay, 1000);
                } else {
                    if (stickyInterval) { clearInterval(stickyInterval); stickyInterval = null; }
                }

            } else {
                // Idle / Completed
                timerSpan.style.display = 'none';
                btn.style.width = ''; // Reset to CSS default
                btn.style.padding = '';
                if (stickyInterval) { clearInterval(stickyInterval); stickyInterval = null; }
            }
        });
    }

    // Listen for timer updates
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.timerState) {
            updateStickyTimer();
        }
    });

    // Initial check
    updateStickyTimer();

    // 2. Sidebar Iframe Container
    const sidebar = document.createElement('div');
    sidebar.id = "uc-sidebar-container";
    sidebar.innerHTML = `
        <iframe src="${chrome.runtime.getURL('sidebar.html')}" id="uc-sidebar-frame" frameborder="0"></iframe>
    `;
    document.body.appendChild(sidebar);

    // Events
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent immediate close
        sidebar.classList.toggle('open');
        btn.classList.toggle('hidden');

        if (sidebar.classList.contains('open')) {
            chrome.runtime.sendMessage({ action: "refresh_sidebar_data" });
        }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById("uc-sidebar-container");
        const btn = document.getElementById("uc-sticky-btn");

        if (sidebar && sidebar.classList.contains('open') && !sidebar.classList.contains('pinned')) {
            // Check if click is outside sidebar and button
            if (!sidebar.contains(e.target) && !btn.contains(e.target)) {
                sidebar.classList.remove('open');
                btn.classList.remove('hidden');
            }
        }
    });
}

// Listen for messages from sidebar
window.addEventListener('message', (event) => {
    const sidebar = document.getElementById("uc-sidebar-container");
    const btn = document.getElementById("uc-sticky-btn");

    if (event.data.action === "CLOSE_SIDEBAR") {
        if (sidebar) sidebar.classList.remove('open');
        if (btn) btn.classList.remove('hidden');
    } else if (event.data.action === "HIDE_SIDEBAR") {
        if (sidebar) sidebar.style.display = 'none';
        // We might want to keep the "open" class so we know state, just visually hide
    } else if (event.data.action === "SHOW_SIDEBAR") {
        if (sidebar) sidebar.style.display = 'block';
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebarWidget);
} else {
    injectSidebarWidget();
}


// Check for restore param on load
const urlParams = new URLSearchParams(window.location.search);
const restoreId = urlParams.getAll('universal-clip-id').pop(); // Get value of last instance of param to handle duplicates

if (restoreId) {
    console.log("Restoring clip:", restoreId);

    // Wait for the page to be fully loaded to ensure video players are ready
    const runRestore = () => {
        chrome.runtime.sendMessage({ action: "get_clip", payload: { id: restoreId } }, (response) => {
            if (response && response.success && response.clip) {
                restoreHighlight(response.clip);
            } else {
                console.error("Could not fetch clip to restore", response);
            }
        });
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        runRestore();
    } else {
        window.addEventListener('load', runRestore);
    }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "finalize_capture_and_show_modal") {
        // Only show modal in top frame
        if (window === top) {
            handleFinalizeCapture(request.data);
        }
    } else if (request.action === "trigger_capture_context_menu") {
        // This will now be handled via background.js querying all frames
        // But we keep it as a fallback if needed
        captureSelection(request.screenshot);
    } else if (request.action === "seek_video") {
        console.log("[CB Clipper] Cross-frame seek received", request.videoTimestamp);
        handleVideoSeek({ videoTimestamp: request.videoTimestamp });
    }
});

function getFrameCaptureData() {
    const selection = window.getSelection();
    let text = selection.toString().trim();

    let offsets = null;
    let domPath = "";
    let element = null;

    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        element = container.nodeType === 1 ? container : container.parentElement;
        domPath = getDOMPath(element);

        offsets = {
            start: range.startOffset,
            end: range.endOffset,
            startContainerPath: getDOMPath(range.startContainer),
            endContainerPath: getDOMPath(range.endContainer)
        };
    }

    return {
        selection: text,
        offsets: offsets,
        domPath: domPath,
        videoTimestamp: getVideoTimestamp(),
        metadata: {
            url: window.location.href,
            title: document.title,
            favicon: getFavicon(),
            capturedAt: new Date().toISOString(),
            hostname: window.location.hostname
        },
        isTopFrame: window === top
    };
}

function handleFinalizeCapture(data) {
    const { selectionData, videoTimestamp, screenshot } = data;

    let text = selectionData.selection;
    const isBookmark = !text;

    if (isBookmark) {
        text = `[Bookmark: ${selectionData.metadata.title}]`;
    }

    const clipData = {
        content: text,
        metadata: selectionData.metadata,
        domPath: selectionData.domPath,
        offsets: selectionData.offsets,
        note: "",
        tags: [],
        screenshot: screenshot,
        isBookmark: isBookmark,
        videoTimestamp: videoTimestamp
    };

    showCaptureModal(clipData);
}

// This function might still be used for context menus if not refactored yet
function captureSelection(screenshotUrl = null) {
    const data = getFrameCaptureData();
    handleFinalizeCapture({
        selectionData: data,
        videoTimestamp: data.videoTimestamp,
        screenshot: screenshotUrl
    });
}

function showCaptureModal(clipData) {
    const existing = document.getElementById('universal-clipper-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'universal-clipper-modal-overlay';

    const modal = document.createElement('div');
    modal.id = 'universal-clipper-modal';

    const logoUrl = chrome.runtime.getURL('icons/icon48.png');

    // Fetch tags asynchronously and populate datalist
    chrome.runtime.sendMessage({ action: "get_all_tags" }, (response) => {
        if (response && response.success && response.tags) {
            const datalist = document.getElementById('uc-tag-list');
            if (datalist) {
                response.tags.forEach(tag => {
                    const option = document.createElement('option');
                    option.value = tag;
                    datalist.appendChild(option);
                });
            }
        }
    });

    let mediaRecorder = null;
    let audioChunks = [];
    let voiceNoteBase64 = null;
    let isRecording = false;

    modal.innerHTML = `
    <div class="uc-modal-header" style="display: flex; align-items: center; gap: 10px;">
      <img src="${logoUrl}" style="width: 24px; height: 24px; object-contain: fit;">
      <h3 class="uc-modal-title" style="margin: 0;">CB Clipper</h3>
    </div>
    
    ${clipData.screenshot ? `
    <div class="uc-screenshot-preview" style="margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; max-height: 120px;">
        <img src="${clipData.screenshot}" style="width: 100%; object-fit: cover;">
    </div>
    ` : ''}

    <div class="uc-preview" style="max-height: 80px; overflow-y: auto; ${clipData.isBookmark ? 'color: #666; font-style: italic;' : ''}">
      "${clipData.content.substring(0, 150)}${clipData.content.length > 150 ? '...' : ''}"
    </div>
    
    <div class="uc-input-group">
        <label class="uc-label">Note</label>
        <textarea class="uc-note-input" placeholder="What's interesting about this?"></textarea>
    </div>

    <div class="uc-input-group">
        <label class="uc-label">Voice Note</label>
        <div class="uc-voice-controls" style="display: flex; align-items: center; gap: 10px;">
            <button id="uc-record-btn" class="uc-btn-secondary" style="padding: 6px 12px; display: flex; align-items: center; gap: 6px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">
                <span id="uc-mic-icon">🎤</span>
                <span id="uc-record-text">Record</span>
            </button>
            <div id="uc-audio-status" style="font-size: 12px; color: #666;"></div>
            <button id="uc-delete-audio" style="display: none; background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px;">&times;</button>
        </div>
        <audio id="uc-audio-preview" controls style="display: none; width: 100%; margin-top: 8px; height: 32px;"></audio>
    </div>

    <div class="uc-input-group">
        <label class="uc-label">Tags</label>
        <input type="text" class="uc-tag-input" list="uc-tag-list" placeholder="productivity, research, ideas..." autocomplete="off">
        <datalist id="uc-tag-list"></datalist>
        <div class="uc-helper-text">Separate tags with commas</div>
    </div>
    
    <div class="uc-input-group uc-screenshot-opt" style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="uc-include-screenshot" style="width: 16px; height: 16px; cursor: pointer;">
        <label for="uc-include-screenshot" class="uc-label" style="margin: 0; cursor: pointer; font-weight: 600; font-size: 13px; color: #555;">Include Screenshot</label>
    </div>

    <div class="uc-modal-actions">
      <button class="uc-btn uc-btn-cancel">Cancel</button>
      <button class="uc-btn uc-btn-save">Save Clip</button>
    </div>
  `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const noteInput = modal.querySelector('.uc-note-input');
    const tagInput = modal.querySelector('.uc-tag-input');
    const recordBtn = modal.querySelector('#uc-record-btn');
    const recordText = modal.querySelector('#uc-record-text');
    const micIcon = modal.querySelector('#uc-mic-icon');
    const audioStatus = modal.querySelector('#uc-audio-status');
    const deleteAudioBtn = modal.querySelector('#uc-delete-audio');
    const audioPreview = modal.querySelector('#uc-audio-preview');

    noteInput.focus();

    // Voice Recorder Logic
    recordBtn.addEventListener('click', async () => {
        if (!isRecording) {
            // Start Recording
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = () => {
                        voiceNoteBase64 = reader.result;
                        audioPreview.src = voiceNoteBase64;
                        audioPreview.style.display = 'block';
                        deleteAudioBtn.style.display = 'block';
                        recordBtn.style.display = 'none'; // Hide record button after recording
                        audioStatus.innerText = "Recorded";
                    };

                    // Stop all tracks to release mic
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                isRecording = true;
                recordText.innerText = "Stop";
                micIcon.innerText = "⏹️";
                recordBtn.style.borderColor = "#ef4444";
                recordBtn.style.color = "#ef4444";
                audioStatus.innerText = "Recording...";
            } catch (err) {
                console.error("Error accessing microphone", err);
                alert("Could not access microphone. Please allow permission.");
            }
        } else {
            // Stop Recording
            if (mediaRecorder) mediaRecorder.stop();
            isRecording = false;
            recordText.innerText = "Record";
            micIcon.innerText = "🎤";
            recordBtn.style.borderColor = "#ddd";
            recordBtn.style.color = "inherit";
        }
    });

    deleteAudioBtn.addEventListener('click', () => {
        voiceNoteBase64 = null;
        audioPreview.style.display = 'none';
        deleteAudioBtn.style.display = 'none';
        recordBtn.style.display = 'flex';
        audioStatus.innerText = "";
    });

    const close = () => {
        if (isRecording && mediaRecorder) {
            mediaRecorder.stop(); // Ensure we stop if closed mid-recording
        }
        overlay.remove();
    };

    function save() {
        clipData.note = noteInput.value;
        const tags = tagInput.value.split(',').map(t => t.trim()).filter(t => t);
        clipData.tags = tags;
        if (voiceNoteBase64) {
            clipData.voiceNote = voiceNoteBase64;
        }

        // Respect screenshot toggle
        const screenshotCheck = modal.querySelector('#uc-include-screenshot');
        if (!screenshotCheck.checked) {
            clipData.screenshot = null; // Discard it if not checked
        }

        saveClip(clipData);
        close();
    }

    modal.querySelector('.uc-btn-cancel').addEventListener('click', close);
    modal.querySelector('.uc-btn-save').addEventListener('click', save);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
    });

    // Handle Cmd/Ctrl+Enter to save in note input too
    noteInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            save();
        }
    });
}

function saveClip(clipData) {
    console.log("Saving Clip:", clipData);
    chrome.runtime.sendMessage({ action: "save_clip", payload: clipData }, (response) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            alert("Error saving clip. Check console.");
            return;
        }
        if (response && response.success) {
            showToast("Clip Saved!");
        } else {
            console.log("Save response:", response);
            alert("Failed to save clip.");
        }
    });
}

function getVideoTimestamp() {
    const videos = findVideosDeep(document);
    if (videos.length === 0) return null;

    // Filter out very small or hidden elements
    const candidates = videos.filter(v => {
        try {
            const rect = v.getBoundingClientRect();
            // Allow custom tags even if 0x0
            const isCustom = ['HLS-VIDEO', 'GUMLET-VIDEO', 'MUX-VIDEO'].includes(v.tagName);
            return isCustom || (rect.width > 50 && rect.height > 50);
        } catch (e) { return false; }
    });

    if (candidates.length === 0) return null;

    // Prioritize by content/state
    const activeVideo = candidates.find(v => v.currentTime > 0 && !v.paused) ||
        candidates.find(v => v.currentTime > 0) ||
        candidates.find(v => !v.paused) ||
        candidates[0];

    if (activeVideo) {
        let currentTime = 0;
        try {
            // Guard against custom elements that don't expose currentTime
            currentTime = Number(activeVideo.currentTime);
            if (isNaN(currentTime)) currentTime = 0;
        } catch (e) {
            console.error("Could not read currentTime from video", e);
        }

        console.log(`[CB Clipper] Frame detects video (${activeVideo.tagName}) at ${formatTime(currentTime)}`);
        return {
            time: currentTime,
            formatted: formatTime(currentTime)
        };
    }
    return null;
}

function findVideosDeep(root) {
    let videos = [];

    // 1. Check current root for video or common custom video elements
    const selectors = ['video', 'hls-video', 'mux-video', 'gumlet-video', 'stream', 'cloudflare-stream'];
    selectors.forEach(selector => {
        try {
            const found = Array.from(root.querySelectorAll(selector));
            videos = videos.concat(found);
        } catch (e) { }
    });

    // 2. Recursively check shadow roots of all elements in this root
    try {
        const allElements = root.querySelectorAll('*');
        allElements.forEach(el => {
            if (el.shadowRoot) {
                videos = videos.concat(findVideosDeep(el.shadowRoot));
            }
        });
    } catch (e) { }

    return videos;
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v < 10 ? "0" + v : v).filter((v, i) => v !== "00" || i > 0).join(":");
}

function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    z-index: 2147483647;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    opacity: 0;
    transition: opacity 0.3s;
  `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getFavicon() {
    const link = document.querySelector("link[rel~='icon']");
    if (!link) return "";
    return link.href;
}

function getDOMPath(el) {
    if (!el) return "";
    if (el.nodeType === 3) el = el.parentElement;

    const stack = [];
    while (el.parentNode != null) {
        let sibCount = 0;
        let sibIndex = 0;
        for (let i = 0; i < el.parentNode.childNodes.length; i++) {
            const sib = el.parentNode.childNodes[i];
            if (sib.nodeName === el.nodeName) {
                if (sib === el) {
                    sibIndex = sibCount;
                }
                sibCount++;
            }
        }
        if (el.getAttribute("id") && el.id !== "") {
            stack.unshift(el.nodeName.toLowerCase() + "#" + el.id);
        } else if (sibCount > 1) {
            stack.unshift(el.nodeName.toLowerCase() + ":nth-of-type(" + (sibIndex + 1) + ")");
        } else {
            stack.unshift(el.nodeName.toLowerCase());
        }
        el = el.parentNode;
    }
    return stack.slice(1).join(" > ");
}

function restoreHighlight(clip) {
    console.log("Attempting to restore highlight", clip);

    let element = document.querySelector(clip.domPath);
    let scrolled = false;

    // 1. Try DOM Path
    if (element) {
        console.log("Restored via DOM Path");
        scrollToAndHighlight(element);
        scrolled = true;
    } else {
        console.warn("Element not found by DOM path. Attempting text search fallback...");

        // 2. Fallback: Text Search using XPath
        const text = clip.content;
        const safeText = text.replace(/'/g, "', \"'\", '");
        const xpath = `//*[contains(text(), concat('${safeText}', ''))]`;

        try {
            const matchingElement = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (matchingElement) {
                console.log("Restored via XPath Text Search");
                scrollToAndHighlight(matchingElement.parentElement || matchingElement);
                scrolled = true;
            } else {
                console.error("Could not restore clip location.");
                // We don't show an error toast here if we are going to show the clip info toast below anyway.
                // But if it's purely text and we failed, maybe we should? 
                // Let's stick to the requested "timestamp/note" popup.
            }
        } catch (e) {
            console.error("XPath Error", e);
        }
    }

    // 3. Always show the "Toast" (Popup) if there is relevant info (Timestamp or Note)
    // This matches the user's request for the "right side down" popup behavior.
    if (clip.videoTimestamp || clip.note) {
        let msg = "";

        if (clip.videoTimestamp) {
            const timeStr = clip.videoTimestamp.formatted || formatTime(clip.videoTimestamp.time);
            msg = `Clip at ${timeStr}`;
        }

        if (clip.note) {
            if (msg) msg += ` - ${clip.note}`;
            else msg = `Note: ${clip.note}`;
        }

        // Show for 10 seconds so it's readable
        showToast(msg, 10000);
    } else if (!scrolled) {
        // If we didn't scroll AND didn't show a note/timestamp, maybe warn?
        showToast("Clip content not found on page.", 4000);
    }
}

// Auto-seek functions removed.

function scrollToAndHighlight(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });

    // Highlight Style
    element.style.backgroundColor = "#fff9c4";
    element.style.color = "#000";
    element.style.padding = "2px";
    element.style.borderRadius = "2px";
    element.style.transition = "background-color 2s";

    // Flash outline
    const originalOutline = element.style.outline;
    element.style.outline = "2px solid #facc15";
    setTimeout(() => {
        element.style.outline = originalOutline;
    }, 2000);
}
