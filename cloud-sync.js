/**
 * May Harvest Corporation - Employee Training & Competency Management System
 * Cloud Live Sync & Offline-First Engine (v2.0)
 * 
 * Features:
 * - Intelligent real-time 2-way cloud sync with Render backend
 * - Automatic persistence hook on all localStorage modifications
 * - Conflict resolution and non-destructive merging
 * - Background periodic polling for multi-user collaboration
 * - One-click JSON backup download & restore
 * - Official PDF generation integration
 */

(function () {
  'use strict';

  const SYNC_ENDPOINT = '/api/sync';
  const HEALTH_ENDPOINT = '/api/health';
  const BACKUP_ENDPOINT = '/api/backup';
  const RESTORE_ENDPOINT = '/api/backup/restore';
  const SYNC_INTERVAL_MS = 25000; // 25 seconds background polling
  const DEBOUNCE_MS = 600; // 600ms debounce for rapid changes

  const SYNC_KEYS = {
    records: 'training_records_v2',
    positions: 'training_positions_v1',
    calendar: 'training_calendar_v1',
    cqs: 'training_cq_v1',
    tests: 'training_tests_v1',
    teams: 'training_teams_v1',
    teamSettings: 'training_teams_settings_v1',
    ncs: 'training_nc_v1',
    docControl: 'training_docctl_v1',
    accounts: 'training_accounts_v1',
    customTypes: 'training_custom_types_v1'
  };

  let isSyncing = false;
  let syncTimeout = null;
  let isServerOnline = false;
  let lastSyncTime = null;
  let hasPendingLocalChanges = false;

  // Preserve native storage methods
  const origSetItem = localStorage.setItem.bind(localStorage);
  const origRemoveItem = localStorage.removeItem.bind(localStorage);
  const origClear = localStorage.clear.bind(localStorage);

  // Read all tracked collections from localStorage
  function collectLocalData() {
    const payload = {};
    for (const [keyName, storageKey] of Object.entries(SYNC_KEYS)) {
      try {
        const val = localStorage.getItem(storageKey);
        payload[keyName] = val ? JSON.parse(val) : (keyName.includes('Settings') || keyName === 'docControl' ? {} : []);
      } catch (err) {
        console.warn('[CloudSync] Error reading key ' + storageKey, err);
      }
    }
    return payload;
  }

  // Update UI badge
  function updateBadge(status, message) {
    const badge = document.getElementById('mhcSyncBadge');
    const text = document.getElementById('mhcSyncText');
    const dot = document.getElementById('mhcSyncDot');
    if (!badge || !text || !dot) return;

    badge.className = 'mhc-sync-badge ' + status;
    text.textContent = message || (status === 'online' ? 'Cloud Connected' : status === 'syncing' ? 'Syncing...' : 'Local Only');

    if (status === 'online') {
      badge.style.background = '#ecfdf5';
      badge.style.borderColor = '#10b981';
      badge.style.color = '#065f46';
      dot.style.background = '#10b981';
      dot.style.animation = 'none';
    } else if (status === 'syncing') {
      badge.style.background = '#eff6ff';
      badge.style.borderColor = '#3b82f6';
      badge.style.color = '#1e40af';
      dot.style.background = '#3b82f6';
      dot.style.animation = 'mhc-pulse 1s infinite';
    } else if (status === 'offline') {
      badge.style.background = '#fffbeb';
      badge.style.borderColor = '#f59e0b';
      badge.style.color = '#92400e';
      dot.style.background = '#f59e0b';
      dot.style.animation = 'none';
    } else if (status === 'error') {
      badge.style.background = '#fef2f2';
      badge.style.borderColor = '#ef4444';
      badge.style.color = '#991b1b';
      dot.style.background = '#ef4444';
      dot.style.animation = 'none';
    }
  }

  // Main Push & Merge Sync
  async function performSync(isSilent = false) {
    if (isSyncing) return;
    isSyncing = true;
    if (!isSilent) updateBadge('syncing', 'Syncing with cloud...');

    const localData = collectLocalData();

    try {
      // 1. Send local data to server for merging
      const response = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localData)
      });

      if (!response.ok) {
        throw new Error('Server returned HTTP ' + response.status);
      }

      const result = await response.json();
      isServerOnline = true;
      lastSyncTime = new Date();
      hasPendingLocalChanges = false;

      // 2. Fetch the latest consolidated database from server
      const getRes = await fetch(SYNC_ENDPOINT, { method: 'GET' });
      if (getRes.ok) {
        const getResult = await getRes.json();
        if (getResult && getResult.data) {
          applyServerState(getResult.data);
        }
      }

      const timeStr = lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      updateBadge('online', 'Cloud Live (' + timeStr + ')');
    } catch (err) {
      console.warn('[CloudSync] Sync network notice:', err.message);
      isServerOnline = false;
      updateBadge('offline', 'Saved Locally (Offline)');
    } finally {
      isSyncing = false;
    }
  }

  // Apply server state back to browser without triggering sync loop
  function applyServerState(serverData) {
    if (!serverData) return;
    let modified = false;

    for (const [keyName, storageKey] of Object.entries(SYNC_KEYS)) {
      if (serverData[keyName] !== undefined) {
        const currentLocal = localStorage.getItem(storageKey);
        const incomingStr = JSON.stringify(serverData[keyName]);

        if (currentLocal !== incomingStr) {
          origSetItem(storageKey, incomingStr);
          modified = true;
        }
      }
    }

    // If server had new data, refresh the UI
    if (modified && typeof window.mhcReloadAll === 'function') {
      window.mhcReloadAll(true);
    }
  }

  // Debounced push when user makes edits
  function triggerAutoSync() {
    hasPendingLocalChanges = true;
    updateBadge('syncing', 'Saving changes...');
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      performSync(true);
    }, DEBOUNCE_MS);
  }

  // Intercept localStorage.setItem
  localStorage.setItem = function (key, value) {
    origSetItem(key, value);
    if (typeof key === 'string' && key.startsWith('training_')) {
      triggerAutoSync();
    }
  };

  // Intercept localStorage.removeItem
  localStorage.removeItem = function (key) {
    origRemoveItem(key);
    if (typeof key === 'string' && key.startsWith('training_')) {
      triggerAutoSync();
    }
  };

  // Mount UI controls into header
  function injectSyncHeaderUI() {
    const wrap = document.querySelector('.wrap');
    if (!wrap) return;

    // Check if already injected
    if (document.getElementById('mhcHeaderSyncBar')) return;

    const bar = document.createElement('div');
    bar.id = 'mhcHeaderSyncBar';
    bar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding:10px 14px; background:var(--card); border:1px solid var(--line); border-radius:10px;';

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span style="font-weight:700; font-size:.9rem; color:var(--text); display:inline-flex; align-items:center; gap:6px;">
          🏢 <span style="color:var(--accent);">MHC Cloud Sync</span>
        </span>
        <div id="mhcSyncBadge" class="mhc-sync-badge syncing" style="display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:99px; border:1px solid #3b82f6; font-size:.78rem; font-weight:600; background:#eff6ff; color:#1e40af;">
          <span id="mhcSyncDot" style="width:7px; height:7px; border-radius:50%; background:#3b82f6;"></span>
          <span id="mhcSyncText">Connecting...</span>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
        <button type="button" class="btn sec" id="mhcBtnSyncNow" style="padding:6px 12px; font-size:.8rem; border-radius:7px; display:inline-flex; align-items:center; gap:5px;" title="Manually sync current data with cloud">
          🔄 <span>Sync Now</span>
        </button>
        <button type="button" class="btn sec" id="mhcBtnDownloadBackup" style="padding:6px 12px; font-size:.8rem; border-radius:7px; display:inline-flex; align-items:center; gap:5px;" title="Download full JSON backup">
          💾 <span>Backup</span>
        </button>
        <label class="btn sec" style="padding:6px 12px; font-size:.8rem; border-radius:7px; display:inline-flex; align-items:center; gap:5px; cursor:pointer; margin:0;" title="Restore data from backup file">
          📥 <span>Restore</span>
          <input type="file" id="mhcFileRestore" accept=".json" style="display:none;">
        </label>
      </div>
    `;

    // Insert at top of wrap before title
    wrap.insertBefore(bar, wrap.firstChild);

    // Event listeners
    document.getElementById('mhcBtnSyncNow').onclick = () => performSync(false);

    document.getElementById('mhcBtnDownloadBackup').onclick = () => {
      window.open(BACKUP_ENDPOINT, '_blank');
    };

    const restoreInput = document.getElementById('mhcFileRestore');
    restoreInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Warning: Restoring from a backup will merge or overwrite current records with the backup data. Do you wish to continue?')) {
        restoreInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const json = JSON.parse(evt.target.result);
          updateBadge('syncing', 'Restoring backup...');
          const res = await fetch(RESTORE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(json)
          });
          if (res.ok) {
            applyServerState(json);
            alert('Backup successfully restored and synchronized with cloud!');
            performSync(false);
          } else {
            alert('Failed to restore backup to server.');
          }
        } catch (err) {
          alert('Invalid backup JSON file: ' + err.message);
        } finally {
          restoreInput.value = '';
        }
      };
      reader.readAsText(file);
    };
  }

  // Periodic background sync & visibility change handling
  function startSyncLoop() {
    setInterval(() => {
      if (!isSyncing) {
        performSync(true);
      }
    }, SYNC_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !isSyncing) {
        performSync(true);
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    injectSyncHeaderUI();
    // Run initial sync
    performSync(false);
    startSyncLoop();
  }

})();
