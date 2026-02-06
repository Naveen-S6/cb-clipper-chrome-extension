// Dashboard IndexedDB Helper (Reuse logic or import)
// Since this is a React app, we might want a hook or utility class.
// For now, let's keep it simple and consistent with the extension.

export const DB_NAME = "CBClipper";
export const DB_VERSION = 2;
export const STORE_NAME = "clips";

export function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => reject(event.target.error);

        request.onsuccess = (event) => resolve(event.target.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("url", "metadata.url", { unique: false });
                store.createIndex("capturedAt", "metadata.capturedAt", { unique: false });
                store.createIndex("tags", "tags", { multiEntry: true });
            } else {
                const store = event.target.transaction.objectStore(STORE_NAME);
                if (!store.indexNames.contains("tags")) {
                    store.createIndex("tags", "tags", { multiEntry: true });
                }
            }
        };
    });
}

export function getAllClips() {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    });
}

export function markClipsDeleted(ids) {
    return openDB().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);

            let processed = 0;
            ids.forEach(id => {
                const req = store.get(id);
                req.onsuccess = () => {
                    const clip = req.result;
                    if (clip) {
                        clip.isDeleted = true;
                        clip.deletedAt = new Date().toISOString();
                        store.put(clip);
                    }
                    processed++;
                    if (processed === ids.length) resolve({ success: true });
                };
                req.onerror = () => {
                    processed++;
                    if (processed === ids.length) resolve({ success: true });
                };
            });
        });
    });
}

export function restoreClips(ids) {
    return openDB().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);

            let processed = 0;
            ids.forEach(id => {
                const req = store.get(id);
                req.onsuccess = () => {
                    const clip = req.result;
                    if (clip) {
                        delete clip.isDeleted;
                        delete clip.deletedAt;
                        store.put(clip);
                    }
                    processed++;
                    if (processed === ids.length) resolve({ success: true });
                };
            });
        });
    });
}

export function deleteClipsPermanently(ids) {
    return openDB().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);

            let processed = 0;
            ids.forEach(id => {
                const req = store.delete(id);
                req.onsuccess = () => {
                    processed++;
                    if (processed === ids.length) resolve({ success: true });
                };
            });
        });
    });
}
