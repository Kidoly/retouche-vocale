// Stockage des morceaux audio (IndexedDB, partagé entre le service worker et le document offscreen)
const RV_DB = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('retouche-vocale', 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('chunks', { autoIncrement: true });
        store.createIndex('file', 'file');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async put(file, blob) {
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').add({ file, blob });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  async getFile(file) {
    const db = await this.open();
    const blobs = await new Promise((resolve, reject) => {
      const req = db.transaction('chunks').objectStore('chunks').index('file').getAll(file);
      req.onsuccess = () => resolve(req.result.map((r) => r.blob));
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blobs.length ? new Blob(blobs, { type: 'audio/webm' }) : null;
  },
  async clear() {
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};
