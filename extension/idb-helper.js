// IndexedDB Helper
const DB_NAME = "CBClipper";
const DB_VERSION = 2;
const STORE_NAME = "clips";

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("url", "metadata.url", { unique: false });
                store.createIndex("capturedAt", "metadata.capturedAt", { unique: false });
                store.createIndex("tags", "tags", { multiEntry: true });
            } else {
                // Handle upgrade if store exists but indices don't
                const store = event.target.transaction.objectStore(STORE_NAME);
                if (!store.indexNames.contains("tags")) {
                    store.createIndex("tags", "tags", { multiEntry: true });
                }
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("IndexedDB error:", event.target.error);
            reject(event.target.error);
        };
    });
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function addClip(clipData) {
    return openDB().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);

            const newClip = {
                id: generateUUID(),
                ...clipData,
                tags: clipData.tags || []
            };

            const request = store.add(newClip);

            request.onsuccess = () => {
                resolve({ success: true, id: newClip.id });
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    });
}

function getClip(id) {
    return openDB().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    });
}
function getAllClips() {
    return openDB().then((db) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    });
}

function markClipsDeleted(ids) {
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
                    if (processed === ids.length) resolve({ success: true }); // specific error ignored for bulk op
                };
            });
        });
    });
}

function restoreClips(ids) {
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

function deleteClipsPermanently(ids) {
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
