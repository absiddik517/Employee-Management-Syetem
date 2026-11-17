import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, OperationType, handleFirestoreError } from '../firebase/config.js';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const urlCacheRef = useRef({});

  const resolveStorageUrl = useCallback(async (path) => {
    if (!path || path.startsWith('storage-unavailable/')) return '';
    if (urlCacheRef.current[path]) return urlCacheRef.current[path];
    try {
      const url = await getDownloadURL(storageRef(storage, path));
      urlCacheRef.current[path] = url;
      return url;
    } catch {
      return '';
    }
  }, []);

  const deleteStoragePathSafe = useCallback(async (path) => {
    if (!path || path.startsWith('storage-unavailable/')) return;
    try {
      await deleteObject(storageRef(storage, path));
      delete urlCacheRef.current[path];
    } catch (err) {
      if (err && err.code === 'storage/object-not-found') {
        return;
      }
      console.warn('Storage delete warning:', path, err?.code || err?.message);
    }
  }, []);

  const logAudit = useCallback(async ({
    actor,
    action,
    targetCollection,
    targetId,
    oldValue = '',
    newValue = '',
    reason = '',
    officeId = '',
    districtOfficeId = ''
  }) => {
    const rawOld = typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue ?? '');
    const rawNew = typeof newValue === 'string' ? newValue : JSON.stringify(newValue ?? '');
    const payload = {
      actorUid: actor?.uid || actor?.id || '',
      actorName: String(actor?.name || actor?.email || 'Admin').slice(0, 120),
      actorRole: String(actor?.role || 'super_admin').slice(0, 40),
      officeId: String(officeId || actor?.officeId || '').slice(0, 128),
      districtOfficeId: String(districtOfficeId || actor?.districtOfficeId || '').slice(0, 128),
      action: String(action || '').slice(0, 80),
      targetCollection: String(targetCollection || '').slice(0, 60),
      targetId: String(targetId || '').slice(0, 180),
      oldValue: rawOld.slice(0, 500),
      newValue: rawNew.slice(0, 500),
      reason: String(reason || '').slice(0, 500),
      timestamp: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'auditLogs'), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'auditLogs');
    }
  }, []);

  const value = useMemo(() => ({
    resolveStorageUrl,
    deleteStoragePathSafe,
    logAudit
  }), [resolveStorageUrl, deleteStoragePathSafe, logAudit]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used within a DataProvider');
  }
  return ctx;
}
