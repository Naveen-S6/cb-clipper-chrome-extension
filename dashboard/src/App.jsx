import { useState, useEffect, useMemo } from 'react'
import HomeView, { TimerPage } from './components/HomeView'
import { getAllClips, markClipsDeleted, restoreClips, deleteClipsPermanently } from './db'
import JSZip from 'jszip'

function App() {
  // Hash-based routing to persist page on refresh
  const getPageFromHash = () => {
    const hash = window.location.hash.replace('#', '');
    return ['home', 'library', 'timer'].includes(hash) ? hash : 'home';
  };

  const [currentPage, setCurrentPage] = useState(getPageFromHash());

  // Sync Hash on State Change
  useEffect(() => {
    window.location.hash = currentPage;
  }, [currentPage]);

  // Handle Browser Back/Forward
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPage(getPageFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const [activityLog, setActivityLog] = useState({}); // New Source-of-Truth from chrome.storage
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState(null)
  const [selectedSource, setSelectedSource] = useState(null)
  const [selectedClip, setSelectedClip] = useState(null)

  // New States for trash/selection
  const [viewMode, setViewMode] = useState('active') // 'active' or 'trash'
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)

  // Initial Load from Chrome Storage
  useEffect(() => {
    chrome.storage.local.get(['cb_activity_log'], (result) => {
      if (result.cb_activity_log) {
        let data = result.cb_activity_log;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { }
        }
        setActivityLog(data || {});
      }
    });

    // Listen for updates (from Background or Popup)
    const listener = (changes, area) => {
      if (area === 'local' && changes.cb_activity_log) {
        let data = changes.cb_activity_log.newValue;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { }
        }
        setActivityLog(data || {});
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    document.title = "CB Clipper - Dashboard";
    loadClips()
  }, [])

  async function loadClips() {
    try {
      const data = await getAllClips()
      data.sort((a, b) => new Date(b.metadata.capturedAt) - new Date(a.metadata.capturedAt))
      setClips(data)
    } catch (error) {
      console.error("Failed to load clips", error)
    } finally {
      setLoading(false)
    }
  }

  // --- Selection Logic ---
  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
    if (newSet.size > 0 && !isSelectionMode) setIsSelectionMode(true)
    if (newSet.size === 0 && isSelectionMode) setIsSelectionMode(false)
  }

  const cancelSelection = () => {
    setSelectedIds(new Set())
    setIsSelectionMode(false)
  }

  const selectAll = () => {
    if (selectedIds.size === filteredClips.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredClips.map(c => c.id)))
    }
  }

  // --- Actions ---
  const handleDelete = async () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)

    // Optimistic UI update
    setClips(prev => prev.map(c => ids.includes(c.id) ? { ...c, isDeleted: true } : c))
    cancelSelection()

    await markClipsDeleted(ids)
    loadClips() // Reload to sync exact state
  }

  const handleRestore = async () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)

    setClips(prev => prev.map(c => ids.includes(c.id) ? { ...c, isDeleted: false } : c))
    cancelSelection()

    await restoreClips(ids)
    loadClips()
  }

  const handleDeleteForever = async () => {
    if (!confirm("Are you sure you want to permanently delete these clips? This cannot be undone.")) return
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)

    setClips(prev => prev.filter(c => !ids.includes(c.id)))
    cancelSelection()

    await deleteClipsPermanently(ids)
    loadClips()
  }


  const handleCardClick = (clip) => {
    if (isSelectionMode) {
      toggleSelection(clip.id)
    } else {
      setSelectedClip(clip)
    }
  }

  const handleLinkClick = (e, clip) => {
    e.stopPropagation()

    try {
      const url = new URL(clip.metadata.url);
      url.searchParams.delete('universal-clip-id');
      url.searchParams.set('universal-clip-id', clip.id);

      window.open(url.toString(), '_blank');
    } catch (err) {
      console.error("Invalid URL in clip metadata", err);
      const separator = clip.metadata.url.includes('?') ? '&' : '?';
      const targetUrl = `${clip.metadata.url}${separator}universal-clip-id=${clip.id}`;
      window.open(targetUrl, '_blank');
    }
  }

  const allTags = useMemo(() => {
    const tags = new Set()
    clips.forEach(clip => {
      if (!clip.isDeleted && clip.tags && Array.isArray(clip.tags)) {
        clip.tags.forEach(tag => tags.add(tag))
      }
    })
    return Array.from(tags).sort()
  }, [clips])

  const allSources = useMemo(() => {
    const sources = new Set()
    clips.forEach(clip => {
      if (!clip.isDeleted && clip.metadata.url) {
        try {
          const hostname = new URL(clip.metadata.url).hostname.replace('www.', '');
          sources.add(hostname)
        } catch (e) { }
      }
    })
    return Array.from(sources).sort()
  }, [clips])

  const filteredClips = useMemo(() => {
    let result = clips

    if (viewMode === 'active') {
      result = result.filter(clip => !clip.isDeleted)
    } else {
      result = result.filter(clip => clip.isDeleted)
    }

    if (selectedTag && viewMode === 'active') {
      result = result.filter(clip => clip.tags && clip.tags.includes(selectedTag))
    }

    if (selectedSource && viewMode === 'active') {
      result = result.filter(clip => {
        try {
          return new URL(clip.metadata.url).hostname.includes(selectedSource);
        } catch (e) { return false; }
      })
    }

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase()
      result = result.filter(clip =>
        (clip.metadata.title && clip.metadata.title.toLowerCase().includes(lowerQuery)) ||
        (clip.content && clip.content.toLowerCase().includes(lowerQuery)) ||
        (clip.note && clip.note.toLowerCase().includes(lowerQuery)) ||
        (clip.tags && clip.tags.some(tag => tag.toLowerCase().includes(lowerQuery)))
      )
    }
    return result
  }, [clips, searchQuery, selectedTag, selectedSource, viewMode])

  const handleImageZoom = (e, dataUrl) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.target = '_blank';
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
      })
      .catch(() => {
        const win = window.open();
        win.document.write(`<img src="${dataUrl}" style="max-width:100%; height:auto;" />`);
      });
  }

  const exportAllData = async () => {
    const clipsToExport = viewMode === 'active' ? clips.filter(c => !c.isDeleted) : clips.filter(c => c.isDeleted);

    if (clipsToExport.length === 0) return alert('No clips to export')

    const zip = new JSZip()
    const imgFolder = zip.folder("screenshots")
    const audioFolder = zip.folder("voice_notes")

    // --- 1. Export Clips CSV ---
    const headers = ['ID', 'Title', 'URL', 'Content', 'Note', 'Tags', 'Captured At', 'Screenshot Filename', 'Voice Note Filename']
    const csvRows = [headers.join(',')]

    for (const clip of clipsToExport) {
      const title = (clip.metadata.title || '').replace(/"/g, '""')
      const url = (clip.metadata.url || '')
      const content = (clip.content || '').replace(/"/g, '""')
      const note = (clip.note || '').replace(/"/g, '""')
      const tags = (clip.tags || []).join(';').replace(/"/g, '""')
      const date = new Date(clip.metadata.capturedAt).toISOString()

      let screenshotFilename = ""
      if (clip.screenshot) {
        screenshotFilename = `screenshot_${clip.id}.jpg`
        const base64Data = clip.screenshot.split(',')[1]
        imgFolder.file(screenshotFilename, base64Data, { base64: true })
      }

      let voiceNoteFilename = ""
      if (clip.voiceNote) {
        voiceNoteFilename = `voice_note_${clip.id}.webm`
        // Data URL format: data:audio/webm;base64,.....
        const base64Data = clip.voiceNote.split(',')[1]
        audioFolder.file(voiceNoteFilename, base64Data, { base64: true })
      }

      csvRows.push(`"${clip.id}","${title}","${url}","${content}","${note}","${tags}","${date}","${screenshotFilename}","${voiceNoteFilename}"`)
    }

    const csvContent = csvRows.join('\n')
    zip.file("clips.csv", csvContent)

    // --- 2. Export Streak & Activity Data (Async) ---
    const storageData = await new Promise(resolve => {
      chrome.storage.local.get(['cb_streak_data', 'cb_activity_log'], resolve);
    });

    const streakData = storageData.cb_streak_data;
    if (streakData) {
      try {
        let parsed = streakData;
        if (typeof streakData === 'string') parsed = JSON.parse(streakData);
        const streakCsv = `Current Streak,Last Visit Date\n${parsed.count},${parsed.lastVisit}`;
        zip.file("streak.csv", streakCsv);
      } catch (e) {
        console.error("Error exporting streak data", e);
      }
    }

    const activityLog = storageData.cb_activity_log;
    if (activityLog) {
      try {
        let parsed = activityLog;
        if (typeof activityLog === 'string') parsed = JSON.parse(activityLog);

        const activityHeaders = ['Date', 'Visits', 'Focus Seconds', 'Break Seconds'];
        const activityRows = [activityHeaders.join(',')];

        Object.entries(parsed).forEach(([date, data]) => {
          activityRows.push(`${date},${data.visits || 0},${data.focusSeconds || 0},${data.breakSeconds || 0}`);
        });

        zip.file("activity_log.csv", activityRows.join('\n'));

        // Sessions CSV
        const sessionHeaders = ['Date', 'Timestamp', 'Type', 'Duration (Seconds)', 'Name', 'Tag'];
        const sessionRows = [sessionHeaders.join(',')];

        Object.entries(parsed).forEach(([date, data]) => {
          if (data.sessions && Array.isArray(data.sessions)) {
            data.sessions.forEach(s => {
              const safeName = (s.name || '').replace(/"/g, '""');
              const safeTag = (s.tag || 'General').replace(/"/g, '""');
              sessionRows.push(`${date},${s.timestamp},${s.type},${s.duration},"${safeName}","${safeTag}"`);
            });
          }
        });

        if (sessionRows.length > 1) {
          zip.file("sessions.csv", sessionRows.join('\n'));
        }
      } catch (e) {
        console.error("Error exporting activity log", e);
      }
    }

    const content = await zip.generateAsync({ type: "blob" })
    const url = URL.createObjectURL(content)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `universal_clipper_export_${new Date().toISOString().slice(0, 10)}.zip`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Sidebar Helper
  const SidebarItem = ({ icon, label, active, onClick, badge }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-r-full mr-2
        ${active
          ? 'bg-indigo-50 text-indigo-700 border-l-4 border-indigo-600'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-transparent'
        }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge > 0 && (
        <span className="bg-indigo-100 text-indigo-600 py-0.5 px-2 rounded-full text-xs font-bold">
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex h-screen bg-[#F3F4F6] font-[Inter] overflow-hidden">
      <aside className="w-20 md:w-64 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col z-20 transition-all duration-300">
        <div className="px-6 py-6 flex items-center gap-3 mb-2 shrink-0">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-sm border border-gray-100 p-1.5 shadow-indigo-200/20">
            <img src="logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <span className="text-xl font-bold tracking-tight text-gray-800 hidden md:block">CB Clipper</span>
        </div>

        {currentPage === 'library' && (
          <div className="px-4 mb-6 shrink-0">
            <div className="relative group">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-9 pr-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5D5FEF]/20 focus:border-[#5D5FEF] transition-all"
              />
              <svg style={{ width: '16px', height: '16px' }} className="w-4 h-4 text-gray-400 absolute left-3 top-2.5 group-focus-within:text-[#5D5FEF] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        )}

        <div className="flex-1 px-3 space-y-1 w-full overflow-y-auto custom-scrollbar pt-2">

          <SidebarItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>}
            label="Home"
            active={currentPage === 'home'}
            onClick={() => { setCurrentPage('home'); }}
          />

          <SidebarItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            label="Pomodoro Timer"
            active={currentPage === 'timer'}
            onClick={() => { setCurrentPage('timer'); }}
          />

          <div className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4">My Library</div>

          <SidebarItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
            label="All Clips"
            active={currentPage === 'library' && viewMode === 'active'}
            onClick={() => {
              setCurrentPage('library');
              setViewMode('active');
              setSelectedTag(null);
            }}
            badge={clips.filter(c => !c.isDeleted).length}
          />

          <SidebarItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
            label="Recycle Bin"
            active={currentPage === 'library' && viewMode === 'trash'}
            onClick={() => { setCurrentPage('library'); setViewMode('trash'); setSelectedTag(null); cancelSelection(); }}
            badge={viewMode === 'active' ? 0 : filteredClips.length}
          />

          {currentPage === 'library' && (
            <>
              <div className="px-3 mt-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tags</div>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => { setViewMode('active'); setSelectedTag(tag === selectedTag ? null : tag); setSelectedSource(null); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedTag === tag ? 'bg-[#5D5FEF]/10 text-[#5D5FEF]' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <span className="w-4 h-4 text-gray-400 flex items-center justify-center">#</span>
                  <span className="hidden md:block truncate text-left">{tag}</span>
                </button>
              ))}

              <div className="px-3 mt-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Sources</div>
              {allSources.map(source => (
                <button
                  key={source}
                  onClick={() => { setViewMode('active'); setSelectedSource(source === selectedSource ? null : source); setSelectedTag(null); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedSource === source ? 'bg-[#5D5FEF]/10 text-[#5D5FEF]' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <span className="w-4 h-4 flex items-center justify-center">
                    <img src={`https://www.google.com/s2/favicons?domain=${source}&sz=16`} className="w-3 h-3 opacity-60" onError={(e) => e.target.style.display = 'none'} />
                  </span>
                  <span className="hidden md:block truncate text-left">{source}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 mt-auto">
          <button
            onClick={exportAllData}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors border border-gray-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            <span className="hidden md:block">Export Data</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F8F9FB]">
        {currentPage === 'home' && (
          <HomeView
            onNavigateToLibrary={() => { setCurrentPage('library'); setViewMode('active'); setSelectedTag(null); }}
            activityLog={activityLog}
          />
        )}

        {currentPage === 'timer' && (
          <TimerPage />
        )}

        {currentPage === 'library' && (
          <>
            <header className="h-16 px-8 flex items-center justify-between shrink-0 bg-transparent">
              <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold text-gray-800">
                  {viewMode === 'trash' ? 'Recycle Bin' : (selectedTag ? `#${selectedTag}` : 'All Clips')}
                </h1>
                {selectedIds.size > 0 && (
                  <span className="px-2 py-1 bg-[#5D5FEF] text-white text-xs font-bold rounded-md animate-in fade-in zoom-in-95">
                    {selectedIds.size} Selected
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {selectedIds.size > 0 ? (
                  <>
                    <button onClick={selectAll} className="text-sm text-gray-600 hover:text-gray-900 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                      {selectedIds.size === filteredClips.length ? 'Deselect All' : 'Select All'}
                    </button>

                    {viewMode === 'active' ? (
                      <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-bold transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Delete
                      </button>
                    ) : (
                      <>
                        <button onClick={handleRestore} className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-sm font-bold transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          Restore
                        </button>
                        <button onClick={handleDeleteForever} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg text-sm font-bold transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          Delete Forever
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-500 font-medium h-fit">
                      {filteredClips.length} items
                    </div>
                    {!isSelectionMode && filteredClips.length > 0 && (
                      <button
                        onClick={() => setIsSelectionMode(true)}
                        className="text-sm text-[#5D5FEF] font-bold hover:bg-[#5D5FEF]/10 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Select
                      </button>
                    )}
                    {isSelectionMode && (
                      <button
                        onClick={cancelSelection}
                        className="text-sm text-gray-500 font-medium hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
              {loading ? (
                <div className="flex items-center justify-center h-full text-gray-400">Loading clips...</div>
              ) : filteredClips.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 mt-20">
                  {viewMode === 'trash' ? (
                    <>
                      <p className="text-lg font-medium mb-1">Recycle Bin is empty</p>
                      <p className="text-sm">Great job keeping things clean!</p>
                    </>
                  ) : (
                    <p className="text-lg font-medium mb-1">No clips found</p>
                  )}
                </div>
              ) : (
                <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6 pb-20">
                  {filteredClips.map(clip => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      isSelected={selectedIds.has(clip.id)}
                      isSelectionMode={isSelectionMode || selectedIds.size > 0} // Show checkboxes if *any* is selected or mode active
                      onSelect={() => toggleSelection(clip.id)}
                      onClick={() => handleCardClick(clip)}
                      onLinkClick={(e) => handleLinkClick(e, clip)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {selectedClip && (
        <ClipDetailModal clip={selectedClip} onClose={() => setSelectedClip(null)} onLinkClick={(e) => handleLinkClick(e, selectedClip)} onZoom={(e) => handleImageZoom(e, selectedClip.screenshot)} />
      )}
    </div>
  )
}

function ClipCard({ clip, onClick, onLinkClick, isSelected, isSelectionMode, onSelect }) {
  const hostname = new URL(clip.metadata.url).hostname;
  return (
    <div
      onClick={onClick}
      className={`break-inside-avoid mb-6 bg-white p-5 rounded-2xl shadow-sm border transition-all duration-300 group relative flex flex-col gap-3
        ${isSelected ? 'border-[#5D5FEF] ring-2 ring-[#5D5FEF]/20' : 'border-gray-100 hover:shadow-md hover:border-[#5D5FEF]/30 cursor-pointer'}
      `}
    >
      {/* Checkbox Overlay for Selection */}
      <div
        className={`absolute top-3 right-3 z-10 transition-all duration-200 ${isSelectionMode || isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-[#5D5FEF] border-[#5D5FEF]' : 'bg-white border-gray-300 hover:border-[#5D5FEF]'}`}>
          {isSelected && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
        </div>
      </div>

      {/* Image Preview (New) */}
      {clip.screenshot && (
        <div className="w-full h-32 mb-1 rounded-xl overflow-hidden border border-gray-50 bg-gray-50 group-hover:border-[#5D5FEF]/10 transition-colors">
          <img src={clip.screenshot} alt="Preview" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2.5 max-w-[70%]">
          <div className="w-6 h-6 rounded-md bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100">
            <img
              src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
              alt={hostname}
              className="w-4 h-4 rounded-sm"
              onError={(e) => { e.target.style.display = 'none' }}
            />
          </div>
          <span className="text-[11px] font-semibold text-gray-500 truncate uppercase tracking-tight">
            {hostname.replace('www.', '')}
          </span>
        </div>
        {!isSelectionMode && (
          <button
            onClick={onLinkClick}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:bg-[#5D5FEF] hover:text-white transition-colors"
            title="Open Source"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </button>
        )}
      </div>
      <p className="text-[15px] font-bold text-gray-800 leading-snug line-clamp-2 group-hover:text-[#5D5FEF] transition-colors">
        {clip.metadata.title || "Untitled Clip"}
      </p>
      {clip.videoTimestamp && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-[#5D5FEF] text-[10px] font-bold rounded-md border border-indigo-100/50 w-fit">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {clip.videoTimestamp.formatted}
        </div>
      )}
      <p className="text-sm text-gray-500 line-clamp-4 leading-relaxed">
        "{clip.content}"
      </p>

      <div className="flex flex-wrap gap-1.5 mt-1">
        {clip.voiceNote && (
          <span className="px-2 py-1 bg-purple-50 text-[10px] text-purple-600 font-bold rounded-md border border-purple-100 flex items-center gap-1">
            <span>🎤</span> Voice Note
          </span>
        )}
        {clip.tags && clip.tags.slice(0, 3).map(tag => (
          <span key={tag} className="px-2 py-1 bg-gray-50 text-[10px] text-gray-500 font-medium rounded-md border border-gray-100">#{tag}</span>
        ))}
      </div>
      {clip.note && (
        <div className="mt-2 pt-3 border-t border-gray-50 flex items-start gap-2">
          <div className="min-w-[3px] h-full bg-amber-200/50 rounded-full"></div>
          <p className="text-xs text-amber-700/80 italic line-clamp-2 leading-relaxed">{clip.note}</p>
        </div>
      )}
    </div>
  )
}

function ClipDetailModal({ clip, onClose, onLinkClick, onZoom }) {
  const hostname = new URL(clip.metadata.url).hostname;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white border border-gray-100 flex items-center justify-center shadow-sm">
              <img
                src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                alt={hostname}
                className="w-4 h-4"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight">{hostname}</h3>
              <p className="text-[10px] text-gray-400">{new Date(clip.metadata.capturedAt).toLocaleString()}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar">
          <h2 className="text-xl font-bold text-gray-900 mb-4 leading-snug">{clip.metadata.title}</h2>

          {clip.screenshot && (
            <div className="mb-6 rounded-xl overflow-hidden border border-gray-100 shadow-sm group/img relative">
              <img
                src={clip.screenshot}
                alt="Capture Screenshot"
                className="w-full h-auto cursor-zoom-in hover:brightness-95 transition-all"
                onClick={onZoom}
                title="Click to view full screen"
              />
              <div className="absolute top-3 right-3 bg-black/50 text-white p-2 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
              </div>
            </div>
          )}

          {clip.tags && clip.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {clip.tags.map(tag => (
                <span key={tag} className="px-2.5 py-1 bg-gray-100 text-xs font-semibold text-gray-600 rounded-lg">#{tag}</span>
              ))}
            </div>
          )}

          {clip.videoTimestamp && (
            <div className="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-[#5D5FEF]">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#5D5FEF] uppercase tracking-wider">Video Timestamp</p>
                  <p className="text-lg font-bold text-indigo-900">{clip.videoTimestamp.formatted}</p>
                </div>
              </div>
              <button
                onClick={onLinkClick}
                className="px-3 py-1.5 bg-white border border-indigo-200 text-[#5D5FEF] text-xs font-bold rounded-lg hover:bg-indigo-50 transition-colors shadow-sm"
              >
                Jump to Video
              </button>
            </div>
          )}

          {clip.note && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-6">
              <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">{clip.note}</p>
            </div>
          )}

          {clip.voiceNote && (
            <div className="mb-6 p-4 bg-gray-50 border border-gray-100 rounded-xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Voice Note</p>
              <audio controls src={clip.voiceNote} className="w-full h-8" />
            </div>
          )}
          <div className="pl-4 border-l-4 border-[#5D5FEF]/20 py-1">
            <p className="text-base text-gray-600 leading-relaxed italic">"{clip.content}"</p>
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors">Close</button>
          <button onClick={onLinkClick} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#5D5FEF] hover:bg-[#4B4DDF] shadow-md transition-all flex items-center gap-2">
            <span>Visit Source</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
