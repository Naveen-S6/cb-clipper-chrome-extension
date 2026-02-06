import { useState, useEffect } from 'react';

// --- HOME PAGE (Stats & Overview) ---
export function HomeView({ onNavigateToLibrary, activityLog }) {

    // We can assume activityLog is passed from App, which syncs with chrome.storage
    // activityLog structure: { [date]: { visits, focusSeconds, breakSeconds, sessions: [] } }

    const updateVisit = () => {
        // Increment visit count in storage
        const today = new Date().toISOString().split('T')[0];
        chrome.storage.local.get(['cb_activity_log'], (result) => {
            let log = result.cb_activity_log || {};
            // Handle string legacy
            if (typeof log === 'string') try { log = JSON.parse(log); } catch (e) { }

            if (!log[today]) log[today] = { visits: 0, focusSeconds: 0, breakSeconds: 0, sessions: [] };
            log[today].visits = (log[today].visits || 0) + 1;
            chrome.storage.local.set({ cb_activity_log: log });
        });
    };

    return (
        <div className="p-8 max-w-4xl mx-auto animate-in fade-in duration-500 space-y-6">
            <header className="flex items-center justify-between mb-2">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Welcome Back, Learner! 👋</h1>
                    <p className="text-gray-500 text-sm">Ready to crush your goals today?</p>
                </div>
                <div className="hidden md:block">
                    <button
                        onClick={onNavigateToLibrary}
                        className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold rounded-lg hover:bg-indigo-100 transition-colors text-sm"
                    >
                        Go to My Library →
                    </button>
                </div>
            </header>

            {/* 1. Streak */}
            <StreakWidget onVisit={updateVisit} />

            {/* 2. Today's Activity (Bars) */}
            <DailyActivityWidget activityLog={activityLog} />

            {/* 3. Bottom Row: Calendar & Quick Links */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <CalendarHeatmapWidget activityLog={activityLog} />
                <div className="space-y-6 flex flex-col">
                    <QuickLinksWidget />
                    {/* Library Link for Mobile */}
                    <div className="flex-1 min-h-[100px] p-6 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl text-white shadow-lg flex items-center justify-between relative overflow-hidden md:hidden">
                        <div className="relative z-10">
                            <h3 className="text-lg font-bold mb-1">Library</h3>
                            <button
                                onClick={onNavigateToLibrary}
                                className="px-4 py-2 bg-white text-indigo-600 font-bold rounded-lg hover:bg-indigo-50 transition-colors shadow-sm text-sm"
                            >
                                Open
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- TIMER PAGE (Persistent Timer UI) ---
export function TimerPage() {
    // This component syncs with background.js timerState
    const [state, setState] = useState(null); // { status, mode, type, timeRemaining, ... }
    const [durationInput, setDurationInput] = useState(25);
    const [sessionName, setSessionName] = useState('');
    const [sessionTag, setSessionTag] = useState('General');
    const [dailyFocusSeconds, setDailyFocusSeconds] = useState(0);
    const [motivationalMsg, setMotivationalMsg] = useState('');

    // Poll for state updates (or use messaging, polling is simpler for interval UI)
    useEffect(() => {
        const fetchState = () => {
            // 1. Fetch Timer State
            chrome.storage.local.get(['timerState'], (result) => {
                if (result.timerState) {
                    setState(result.timerState);
                }
            });

            // 2. Fetch Activity Log for Motivation
            const today = new Date().toISOString().split('T')[0];
            chrome.storage.local.get(['cb_activity_log'], (result) => {
                const log = result.cb_activity_log;
                let todaySeconds = 0;

                if (log) {
                    let parsed = log;
                    if (typeof log === 'string') try { parsed = JSON.parse(log); } catch (e) { }
                    if (parsed[today]) {
                        todaySeconds = parsed[today].focusSeconds || 0;
                    }
                }
                setDailyFocusSeconds(todaySeconds);
            });
        };
        fetchState();
        const interval = setInterval(fetchState, 1000);
        return () => clearInterval(interval);
    }, []);

    // Dynamic Message Logic
    useEffect(() => {
        const messages = [
            "Small steps every day add up to big results.",
            "Focus is the key to unlocking your potential.",
            "You are building your future, one pomodoro at a time.",
            "Consistency is what transforms average into excellence.",
            "The secret of getting ahead is getting started.",
            "Your only limit is your mind.",
            "Make today count!",
            "Discipline is choosing what you want most over what you want now."
        ];

        // 4 Hours Goal = 14400 Seconds
        const goalSeconds = 4 * 60 * 60;
        const progress = dailyFocusSeconds / goalSeconds;
        let msg = "";

        if (dailyFocusSeconds === 0) {
            msg = "Ready to start your 4-hour focus goal? Let's go! 🚀";
        } else if (progress < 0.25) {
            msg = "Good start! Keep that momentum going. 💪";
        } else if (progress < 0.50) {
            msg = "You're doing great! Nearly halfway to your daily goal. 🔥";
        } else if (progress < 0.75) {
            msg = "Over halfway there! You are crushing it today! ⚡";
        } else if (progress < 1.0) {
            const minsLeft = Math.ceil((goalSeconds - dailyFocusSeconds) / 60);
            msg = `So close! Only ${minsLeft} mins to reach your 4-hour goal! 🏆`;
        } else {
            msg = "🎉 Amazing! You've hit your 4-hour focus goal today! You're unstoppable!";
        }

        // Add a random quote if early in the day
        if (progress < 0.5) {
            const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
            const quoteIndex = dayOfYear % messages.length; // consistent daily quote
            setMotivationalMsg(`${msg} "${messages[quoteIndex]}"`);
        } else {
            setMotivationalMsg(msg);
        }

    }, [dailyFocusSeconds]);

    if (!state) return <div className="p-8 text-center text-gray-400">Loading Timer...</div>;

    const isActive = state.status === 'running' || state.status === 'paused';

    // Calculate display time
    let displaySeconds = state.timeRemaining || 0;

    // IF IDLE: Show the input duration (preview) for Timer, or 0 for Stopwatch
    if (state.status === 'idle') {
        if (state.type === 'timer') {
            displaySeconds = durationInput * 60;
        } else {
            displaySeconds = 0;
        }
    }
    // IF RUNNING: Calculate live
    else if (state.status === 'running') {
        const now = Date.now();
        if (state.type === 'timer') {
            displaySeconds = Math.max(0, Math.ceil((state.targetTime - now) / 1000));
        } else {
            // Stopwatch
            displaySeconds = (state.timeRemaining || 0) + Math.floor((now - state.startTime) / 1000);
        }
    }

    // Helper for formatting
    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Actions
    const handleStart = () => {
        chrome.runtime.sendMessage({
            action: 'TIMER_START',
            payload: {
                mode: state.mode,
                type: state.type,
                duration: durationInput,
                sessionDetails: { name: sessionName, tag: sessionTag }
            }
        });
    };

    const handlePause = () => chrome.runtime.sendMessage({ action: 'TIMER_PAUSE' });
    const handleResume = () => chrome.runtime.sendMessage({ action: 'TIMER_START', payload: { mode: state.mode, type: state.type } });
    const handleStop = () => chrome.runtime.sendMessage({ action: 'TIMER_STOP', payload: { save: true } });

    // Mode Switchers
    const setMode = (m) => {
        // Update local state temporarily or save to storage? 
        // Since 'start' handles the payload, we can just update a local state or 
        // directly update storage for 'idle' state. 
        // Let's update storage to persist user choice even if not running.
        chrome.storage.local.set({ timerState: { ...state, mode: m } });
    };
    const setType = (t) => {
        chrome.storage.local.set({ timerState: { ...state, type: t } });
    };

    return (
        <div className="p-8 max-w-4xl mx-auto h-full flex flex-col items-center justify-center animate-in fade-in zoom-in-95">
            <div className="bg-white p-12 rounded-3xl shadow-xl border border-gray-100 w-full max-w-2xl text-center relative overflow-hidden">

                {/* Background decoration */}
                <div className={`absolute top-0 left-0 w-full h-2 ${state.mode === 'focus' ? 'bg-indigo-500' : 'bg-green-500'}`}></div>


                {/* Header / Mode Select */}
                <div className="flex justify-center mb-8 gap-4">
                    <button
                        onClick={() => setMode('focus')}
                        disabled={isActive}
                        className={`px-6 py-2 rounded-full font-bold transition-all ${state.mode === 'focus' ? 'bg-indigo-50 text-indigo-600 ring-2 ring-indigo-100' : 'text-gray-400 hover:bg-gray-50'}`}
                    >
                        Focus
                    </button>
                    <button
                        onClick={() => setMode('break')}
                        disabled={isActive}
                        className={`px-6 py-2 rounded-full font-bold transition-all ${state.mode === 'break' ? 'bg-green-50 text-green-600 ring-2 ring-green-100' : 'text-gray-400 hover:bg-gray-50'}`}
                    >
                        Break
                    </button>
                </div>

                {/* Motivational Message */}
                <div className="mb-6 -mt-4 px-6 text-center h-12 flex items-center justify-center">
                    <p className="text-sm font-medium text-slate-500 animate-in fade-in duration-1000">
                        {motivationalMsg}
                    </p>
                </div>

                {/* Timer Display */}
                <div className={`text-9xl font-mono font-bold tracking-tighter mb-8 ${state.mode === 'focus' ? 'text-gray-800' : 'text-green-600'}`}>
                    {formatTime(displaySeconds)}
                </div>

                {/* Controls */}
                <div className="space-y-8">
                    {/* Inputs (Only if IDLE) */}
                    {!isActive && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                            {state.type === 'timer' && (
                                <div className="flex justify-center gap-2">
                                    {[15, 25, 45, 60].map(m => (
                                        <button key={m} onClick={() => setDurationInput(m)} className={`w-10 h-10 rounded-full font-bold text-sm transition-all ${durationInput === m ? 'bg-indigo-600 text-white shadow-lg scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                            {m}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="flex gap-2 justify-center max-w-md mx-auto">
                                <input
                                    type="text"
                                    placeholder="Session Name (e.g., Deep Work)"
                                    className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 flex-1"
                                    value={sessionName}
                                    onChange={e => setSessionName(e.target.value)}
                                />
                                <select
                                    className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-600"
                                    value={sessionTag}
                                    onChange={e => setSessionTag(e.target.value)}
                                >
                                    <option>General</option>
                                    <option>Coding</option>
                                    <option>Learning</option>
                                    <option>Reading</option>
                                    <option>Work</option>
                                </select>
                            </div>

                            <div className="flex justify-center gap-4 text-sm text-gray-400 font-medium">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="type" checked={state.type === 'timer'} onChange={() => setType('timer')} /> Timer
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="type" checked={state.type === 'stopwatch'} onChange={() => setType('stopwatch')} /> Stopwatch
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Main Buttons */}
                    <div className="flex justify-center gap-4">
                        {state.status === 'running' ? (
                            <>
                                <button onClick={handlePause} className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-bold text-lg shadow-orange-200 shadow-xl transition-all hover:-translate-y-1">
                                    Pause
                                </button>
                                <button onClick={handleStop} className="px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold text-lg shadow-red-200 shadow-xl transition-all hover:-translate-y-1">
                                    Stop
                                </button>
                            </>
                        ) : state.status === 'paused' ? (
                            <>
                                <button onClick={handleResume} className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-lg shadow-indigo-200 shadow-xl transition-all hover:-translate-y-1">
                                    Resume
                                </button>
                                <button onClick={handleStop} className="px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold text-lg shadow-red-200 shadow-xl transition-all hover:-translate-y-1">
                                    Done
                                </button>
                            </>
                        ) : (
                            <button onClick={handleStart} className="px-12 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-xl shadow-indigo-200 shadow-xl transition-all hover:-translate-y-1 active:scale-95">
                                Start {state.mode === 'focus' ? 'Focus' : 'Break'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Current Session Info Banner */}
                {isActive && (
                    <div className="absolute bottom-0 left-0 w-full bg-gray-50 py-3 border-t border-gray-100 flex items-center justify-center gap-2 text-sm text-gray-600">
                        <span className="font-bold">{state.sessionDetails?.name || 'Untitled Session'}</span>
                        <span className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs">{state.sessionDetails?.tag}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// --- WIDGETS ---

function StreakWidget({ onVisit }) {
    const [streakData, setStreakData] = useState({ count: 1, lastVisit: new Date().toDateString() });

    useEffect(() => {
        const today = new Date().toDateString();

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
                    currentData = parsed;
                } else if (lastVisitDate.toDateString() === yesterday.toDateString()) {
                    currentData = { count: parsed.count + 1, lastVisit: today };
                } else {
                    currentData = { count: 1, lastVisit: today };
                }
            }

            chrome.storage.local.set({ cb_streak_data: currentData });
            setStreakData(currentData);
            if (onVisit) onVisit(); // Log visit for activity graph
        });
    }, []);

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group hover:shadow-md transition-all duration-300">
            <div>
                <h3 className="text-gray-500 font-medium text-sm uppercase tracking-wider mb-1">Current Streak</h3>
                <div className="flex items-baseline gap-3">
                    <span className="text-5xl font-extrabold text-orange-500">{streakData.count}</span>
                    <span className="text-gray-400 font-bold text-xl">days in a row!</span>
                </div>
            </div>
            <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center text-4xl group-hover:scale-110 transition-transform duration-300">
                🔥
            </div>
        </div>
    );
}

function DailyActivityWidget({ activityLog }) {
    // Show only the bars for today
    const today = new Date().toISOString().split('T')[0];
    const todayStats = activityLog?.[today] || { focusSeconds: 0, breakSeconds: 0 };

    const formatDuration = (totalSeconds) => {
        const m = Math.floor(totalSeconds / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ${m % 60}m`;
        return `${m}m`;
    };

    const maxVal = Math.max(todayStats.focusSeconds, todayStats.breakSeconds, 60);
    const focusWidth = Math.min(100, (todayStats.focusSeconds / maxVal) * 100);
    const breakWidth = Math.min(100, (todayStats.breakSeconds / maxVal) * 100);

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-gray-500 font-medium text-sm uppercase tracking-wider mb-4">Today's Focus</h3>
            <div className="space-y-4">
                {/* Focus Bar */}
                <div>
                    <div className="flex justify-between text-sm font-medium mb-2">
                        <span className="text-indigo-600 font-bold flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Focus Time
                        </span>
                        <span className="text-gray-700 font-bold">{formatDuration(todayStats.focusSeconds)}</span>
                    </div>
                    <div className="h-3 w-full bg-gray-50 rounded-full overflow-hidden">
                        <div style={{ width: `${focusWidth}%` }} className="h-full bg-indigo-500 rounded-full transition-all duration-1000"></div>
                    </div>
                </div>

                {/* Break Bar */}
                <div>
                    <div className="flex justify-between text-sm font-medium mb-2">
                        <span className="text-green-600 font-bold flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span> Break Time
                        </span>
                        <span className="text-gray-700 font-bold">{formatDuration(todayStats.breakSeconds)}</span>
                    </div>
                    <div className="h-3 w-full bg-gray-50 rounded-full overflow-hidden">
                        <div style={{ width: `${breakWidth}%` }} className="h-full bg-green-500 rounded-full transition-all duration-1000"></div>
                    </div>
                </div>
            </div>
        </div>
    );
}


function CalendarHeatmapWidget({ activityLog }) {
    const [currentDate, setCurrentDate] = useState(new Date());

    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sunday
        return { daysInMonth, firstDayOfWeek };
    };

    const { daysInMonth, firstDayOfWeek } = getDaysInMonth(currentDate);
    const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    const goToToday = () => setCurrentDate(new Date());

    const getColor = (day) => {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${year}-${month}-${dayStr}`;

        const data = activityLog?.[dateStr];
        const isToday = new Date().toDateString() === new Date(year, currentDate.getMonth(), day).toDateString();

        let baseClass = 'text-[10px] font-medium cursor-help relative group transition-colors aspect-square rounded flex items-center justify-center ';
        if (isToday) baseClass += 'ring-1 ring-indigo-400 ring-offset-1 z-10 ';

        if (!data) return baseClass + 'bg-gray-50 text-gray-300';

        const { visits, focusSeconds } = data;
        const focusMinutes = (focusSeconds || 0) / 60;

        let level = 0;
        if (visits) level = 1;
        if (focusMinutes >= 15) level = 2;
        if (focusMinutes > 45) level = 3;

        if (level === 0) return baseClass + 'bg-gray-50 text-gray-300';
        if (level === 1) return baseClass + 'bg-green-100 text-green-700';
        if (level === 2) return baseClass + 'bg-green-300 text-green-900';
        return baseClass + 'bg-green-500 text-white';
    };

    const getTooltip = (day) => {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${year}-${month}-${dayStr}`;
        const data = activityLog?.[dateStr];
        if (!data) return `No activity on ${dateStr}`;

        const fm = Math.floor((data.focusSeconds || 0) / 60);
        const bm = Math.floor((data.breakSeconds || 0) / 60);

        return `${dateStr}: ${fm}m Focus, ${bm}m Break`;
    };

    return (
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-500 font-medium text-xs uppercase tracking-wider">Activity</h3>
                <div className="flex items-center gap-1">
                    <button onClick={goToToday} className="px-2 py-0.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded mr-1">
                        Today
                    </button>
                    <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded text-gray-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="text-xs font-bold text-gray-700 min-w-[80px] text-center">{monthName}</span>
                    <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded text-gray-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-gray-400 mb-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => <div key={d} className="font-bold">{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1 flex-1 content-start">
                {Array(firstDayOfWeek).fill(null).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square"></div>
                ))}
                {Array(daysInMonth).fill(null).map((_, i) => {
                    const day = i + 1;
                    return (
                        <div key={day} className={getColor(day)}>
                            {day}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20 hidden md:block shadow-lg">
                                {getTooltip(day)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function QuickLinksWidget() {
    const [links, setLinks] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newLink, setNewLink] = useState({ title: '', url: '' });

    useEffect(() => {
        // Quick links still in localStorage for now, or migrate?
        // Let's keep in localStorage to avoid modifying everything at once, 
        // or just move to chrome.storage.local for consistency.
        // User didn't strictly ask for Quick Links persistence in background, but safer in storage.
        // I will use localStorage for now to minimize changes as this wasn't the core request.
        const stored = localStorage.getItem('cb_quick_links');
        if (stored) setLinks(JSON.parse(stored));
    }, []);

    const saveLinks = (updatedLinks) => {
        setLinks(updatedLinks);
        localStorage.setItem('cb_quick_links', JSON.stringify(updatedLinks));
    };

    const addLink = () => {
        if (!newLink.title || !newLink.url) return;
        let url = newLink.url;
        if (!url.startsWith('http')) url = 'https://' + url;

        const updated = [...links, { id: Date.now(), title: newLink.title, url }];
        saveLinks(updated);
        setNewLink({ title: '', url: '' });
        setAdding(false);
    };

    const removeLink = (id) => {
        saveLinks(links.filter(l => l.id !== id));
    };

    return (
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-gray-500 font-medium text-xs uppercase tracking-wider">Quick Links</h3>
                <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`p-1 rounded transition-colors ${isEditing ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
            </div>

            <div className="space-y-2">
                {links.map(link => (
                    <div key={link.id} className="group flex items-center gap-2 relative">
                        <a
                            href={isEditing ? undefined : link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex-1 p-2.5 bg-gray-50 ${!isEditing && 'hover:bg-indigo-50 hover:text-indigo-700'} text-gray-700 rounded-lg transition-colors flex items-center gap-3 font-medium text-sm truncate ${isEditing ? 'cursor-default opacity-80' : ''}`}
                            onClick={(e) => isEditing && e.preventDefault()}
                        >
                            <img src={`https://www.google.com/s2/favicons?domain=${link.url}&sz=32`} alt="" className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{link.title}</span>
                        </a>

                        {isEditing && (
                            <button
                                onClick={() => removeLink(link.id)}
                                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:bg-red-600 transition-colors z-10"
                            >
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        )}
                    </div>
                ))}

                {links.length < 3 && !adding && (
                    <button onClick={() => setAdding(true)} className="w-full p-2.5 border-2 border-dashed border-gray-100 rounded-lg text-gray-400 hover:border-indigo-200 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2 text-xs font-medium">
                        <span>+ Add Link</span>
                    </button>
                )}

                {adding && (
                    <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 space-y-2 animate-in fade-in zoom-in-95 duration-200">
                        <input type="text" placeholder="Title..." className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none" value={newLink.title} onChange={(e) => setNewLink({ ...newLink, title: e.target.value })} />
                        <input type="text" placeholder="URL..." className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
                        <div className="flex gap-2 justify-end pt-1">
                            <button onClick={() => setAdding(false)} className="px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-200 rounded">Cancel</button>
                            <button onClick={addLink} className="px-2 py-0.5 text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded">Add</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default HomeView;
