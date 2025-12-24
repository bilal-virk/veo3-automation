//popup.js
class FlowAutomation {
  constructor() {
    this.state = {
      isRunning: false,
      clientSheetId: '',
      sheetName: 'n8n',
      autoCheckInterval: 60,
      processedRows: 0,
      totalRows: 0,
      processedRowKeys: new Set()
    };
    
    this.auth = new GoogleServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    this.sheetsAPI = new GoogleSheetsAPI(this.auth);
    this.syncInterval = null;
    
    this.init();
  }

  async init() {
    await this.loadState();
    this.setupEventListeners();
    
    await this.checkVeo3Tab();
    
    if (this.state.isRunning) {
      console.log('[INIT] Automation is running');
      this.showState('running');
      this.addLog('✅', 'Automation is running in background');
      this.startSyncStats();
    } else {
      this.showDashboard();
      console.log('[INIT] Reading Google Sheet...');
      await this.syncStatsFromSheet();
    }
  }

  async loadState() {
    try {
      const result = await chrome.storage.local.get(['flowState']);
      if (result.flowState) {
        const savedState = result.flowState;
        if (savedState.processedRowKeys) {
          savedState.processedRowKeys = new Set(savedState.processedRowKeys);
        }
        this.state = { ...this.state, ...savedState };
      }
    } catch (error) {
      console.error('[LOAD] Error loading state:', error);
    }
  }

  async saveState() {
    try {
      await chrome.storage.local.set({
        flowState: {
          ...this.state,
          processedRowKeys: Array.from(this.state.processedRowKeys)
        }
      });
    } catch (error) {
      console.error('[SAVE] Error saving state:', error);
    }
  }

  setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
        if (tab === 'automation') {
          this.checkVeo3Tab();
        }
      });
    });
    
    const executeBtn = document.getElementById('executeBtn');
    if (executeBtn) {
      executeBtn.addEventListener('click', () => this.handleExecute());
    }
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.handleStop());
    }
    
    const sheetUrlInput = document.getElementById('sheetUrlInput');
    if (sheetUrlInput) {
      sheetUrlInput.addEventListener('change', (e) => {
        const sheetId = this.extractSheetId(e.target.value);
        if (sheetId) {
          this.state.clientSheetId = sheetId;
          this.saveState();
          console.log('[SETTINGS] Sheet ID updated:', sheetId);
        }
      });
    }
    
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    if (testConnectionBtn) {
      testConnectionBtn.addEventListener('click', () => this.handleTestConnection());
    }
    
    const autoCheckInput = document.getElementById('autoCheckInterval');
    if (autoCheckInput) {
      autoCheckInput.addEventListener('change', (e) => {
        this.state.autoCheckInterval = parseInt(e.target.value) || 60;
        this.saveState();
      });
    }
    
    const downloadFolderBtn = document.getElementById('downloadFolderBtn');
    if (downloadFolderBtn) {
      downloadFolderBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://settings/downloads' });
      });
    }
    
    const clearLogBtn = document.getElementById('clearLogBtn');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', () => {
        const logContainer = document.getElementById('activityLog');
        if (logContainer) {
          logContainer.innerHTML = '<div class="log-item"><span class="log-icon">✓</span><span class="log-text">Log cleared</span></div>';
        }
      });
    }
    
    const goToVeo3Btn = document.getElementById('goToVeo3Btn');
    if (goToVeo3Btn) {
      goToVeo3Btn.addEventListener('click', () => this.handleGoToVeo3());
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
      if (content.id === tabName + 'Tab') {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }

  extractSheetId(url) {
    if (!url) return null;
    if (!url.includes('/') && !url.includes('http')) {
      return url.trim();
    }
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  showDashboard() {
    this.showState('ready');
    
    document.getElementById('autoCheckInterval').value = this.state.autoCheckInterval;
    
    const sheetUrlInput = document.getElementById('sheetUrlInput');
    if (sheetUrlInput && this.state.clientSheetId) {
      sheetUrlInput.value = this.state.clientSheetId;
    }
    
    this.updateStats();
  }

  async handleExecute() {
    console.log('[EXECUTE] Starting automation...');
    
    if (!this.state.clientSheetId) {
      this.addLog('❌', 'Please configure Google Sheet first');
      this.switchTab('settings');
      return;
    }
    
    this.state.processedRowKeys.clear();
    this.state.processedRows = 0;
    console.log('[EXECUTE] Cleared processed rows cache');
    
    this.state.isRunning = true;
    await this.saveState();
    console.log('[EXECUTE] State saved, isRunning = true');
    
    this.showState('running');
    console.log('[EXECUTE] UI set to running state');
    
    this.addLog('🚀', 'Starting automation...');
    
    console.log('[EXECUTE] Sending startAutomation to background...');
    chrome.runtime.sendMessage({
      action: 'startAutomation',
      data: {
        isRunning: true,
        clientSheetId: this.state.clientSheetId,
        sheetName: 'n8n',
        autoCheckInterval: this.state.autoCheckInterval
      }
    }, (response) => {
      console.log('[EXECUTE] Background response:', response);
      if (response && response.success) {
        this.addLog('✅', 'Automation running - you can close this popup!');
        console.log('[EXECUTE] Starting stats sync...');
        this.startSyncStats();
      } else {
        console.error('[EXECUTE] Failed to start:', response);
        this.addLog('❌', 'Failed to start automation');
      }
    });
  }

  async handleStop() {
    console.log('[STOP] Stopping automation...');
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
      stopBtn.innerHTML = `
        <span class="btn-icon">⏳</span>
        <span class="btn-text">Stopping...</span>
      `;
      stopBtn.disabled = true;
      stopBtn.style.opacity = '0.6';
    }
    
    this.state.isRunning = false;
    await this.saveState();
    console.log('[STOP] State saved, isRunning = false');
    
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[STOP] Sync interval cleared');
    }
    
    chrome.runtime.sendMessage({
      action: 'stopAutomation'
    }, (response) => {
      console.log('[STOP] Background response:', response);
    });
    
    this.addLog('⏸️', 'Automation stopped');
    
    setTimeout(() => {
      console.log('[STOP] Showing dashboard');
      this.showDashboard();
      
      const stopBtnReset = document.getElementById('stopBtn');
      if (stopBtnReset) {
        stopBtnReset.innerHTML = `
          <span class="btn-icon">⏹</span>
          <span class="btn-text">Stop Automation</span>
        `;
        stopBtnReset.disabled = false;
        stopBtnReset.style.opacity = '1';
      }
    }, 500);
  }

  startSyncStats() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    this.syncStatsFromSheet();
    
    this.syncInterval = setInterval(() => {
      this.syncStatsFromSheet();
    }, 5000);
  }

  async syncStatsFromSheet() {
    console.log('[SYNC] Syncing stats from sheet...');
    
    const loadingEl = document.getElementById('statsLoading');
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
    }
    
    if (!this.state.clientSheetId) {
      console.log('[SYNC] No sheet ID configured');
      if (loadingEl) loadingEl.classList.add('hidden');
      return;
    }
    
    try {
      const range = `n8n!A:G`;
      const rows = await this.sheetsAPI.getValues(this.state.clientSheetId, range);
      
      if (!rows || rows.length <= 1) {
        console.log('[SYNC] No data rows found');
        this.state.totalRows = 0;
        this.state.processedRows = 0;
        this.updateStats();
        this.updateProgress();
        if (loadingEl) loadingEl.classList.add('hidden');
        return;
      }
      
      this.state.totalRows = rows.length - 1;
      console.log('[SYNC] Total rows:', this.state.totalRows);
      
      let processed = 0;
      let unprocessed = 0;
      
      for (let i = 1; i < rows.length; i++) {
        const status = (rows[i][0] || '').trim().toLowerCase();
        if (status === 'done') {
          processed++;
        } else {
          unprocessed++;
        }
      }
      
      this.state.processedRows = processed;
      console.log('[SYNC] Processed rows:', this.state.processedRows);
      console.log('[SYNC] Unprocessed rows:', unprocessed);
      
      this.updateStats();
      this.updateProgress();
      
      // If there are unprocessed rows and automation is running, notify background
      if (unprocessed > 0 && this.state.isRunning) {
        console.log('[SYNC] 🔔 Notifying background about', unprocessed, 'unprocessed rows...');
        chrome.runtime.sendMessage(
          { action: 'checkUnprocessed' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[SYNC] Error notifying background:', chrome.runtime.lastError.message);
            } else if (response && response.success) {
              console.log(`[SYNC] ✅ Background notified: ${response.count} unprocessed rows`);
              if (response.hasUnprocessed) {
                console.log('[SYNC] 🚀 Automation cycle will be triggered automatically');
              }
            }
          }
        );
      } else if (unprocessed > 0 && !this.state.isRunning) {
        console.log('[SYNC] ℹ️ Found', unprocessed, 'unprocessed rows but automation is stopped');
      } else if (unprocessed === 0) {
        console.log('[SYNC] ✅ All rows processed');
      }
      
    } catch (error) {
      console.error('[SYNC] Error accessing sheet:', error);
      this.state.totalRows = 0;
      this.state.processedRows = 0;
      this.updateStats();
      this.updateProgress();
    } finally {
      if (loadingEl) {
        loadingEl.classList.add('hidden');
      }
    }
  }

  async handleTestConnection() {
    console.log('[TEST] Testing sheet connection...');
    
    const testBtn = document.getElementById('testConnectionBtn');
    const statusEl = document.getElementById('connectionStatus');
    const sheetUrlInput = document.getElementById('sheetUrlInput');
    
    const newSheetUrl = sheetUrlInput.value.trim();
    const newSheetId = this.extractSheetId(newSheetUrl);
    const newSheetName = 'n8n';
    
    if (!newSheetId) {
      statusEl.textContent = '❌ Please enter a valid Google Sheet URL or ID';
      statusEl.className = 'connection-status error';
      statusEl.classList.remove('hidden');
      return;
    }
    
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Testing Connection...</span>';
    statusEl.classList.add('hidden');
    
    try {
      console.log('[TEST] Testing sheet ID:', newSheetId);
      console.log('[TEST] Testing sheet name:', newSheetName);
      
      const testRange = `${newSheetName}!A1:G100`;
      const testData = await this.sheetsAPI.getValues(newSheetId, testRange);
      
      if (!testData || testData.length === 0) {
        throw new Error('Sheet is empty or not accessible');
      }
      
      console.log('[TEST] ✅ Sheet accessible, rows:', testData.length);
      
      this.state.clientSheetId = newSheetId;
      this.state.sheetName = newSheetName;
      await this.saveState();
      
      testBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Updating Stats...</span>';
      
      const totalRows = testData.length - 1;
      let processedRows = 0;
      
      for (let i = 1; i < testData.length; i++) {
        const status = (testData[i][0] || '').trim().toLowerCase();
        if (status === 'done') {
          processedRows++;
        }
      }
      
      this.state.totalRows = totalRows;
      this.state.processedRows = processedRows;
      this.updateStats();
      this.updateProgress();
      
      console.log('[TEST] ✅ Stats updated - Total:', totalRows, 'Processed:', processedRows);
      
      statusEl.textContent = `✅ Connection successful! Sheet is accessible and saved. Found ${totalRows} rows (${processedRows} done).`;
      statusEl.className = 'connection-status success';
      statusEl.classList.remove('hidden');
      
    } catch (error) {
      console.error('[TEST] ❌ Connection failed:', error);
      console.error('[TEST] Error details:', error.message);
      statusEl.textContent = `❌ Cannot access sheet: ${error.message}. Make sure it's shared with: python-apie@mb-matrix.iam.gserviceaccount.com`;
      statusEl.className = 'connection-status error';
      statusEl.classList.remove('hidden');
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '<span class="btn-icon">🔌</span><span class="btn-text">Test Connection</span>';
    }
  }

  async checkVeo3Tab() {
    console.log('[CHECK] Checking VEO3 tab...');
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const veo3Warning = document.getElementById('veo3Warning');
    
    if (veo3Warning) {
      if (currentTab && currentTab.url && currentTab.url.includes('labs.google/fx/vi/tools/flow')) {
        console.log('[CHECK] ✅ VEO3 tab active');
        veo3Warning.classList.add('hidden');
      } else {
        console.log('[CHECK] ⚠️ Not on VEO3 tab, showing warning');
        veo3Warning.classList.remove('hidden');
      }
    }
  }

  async handleGoToVeo3() {
    console.log('[GO] Navigating to VEO3...');
    const tabs = await chrome.tabs.query({});
    const veo3Tab = tabs.find(tab => 
      tab.url && tab.url.includes('labs.google/fx/vi/tools/flow')
    );
    
    if (veo3Tab) {
      console.log('[GO] Found existing VEO3 tab, switching to it');
      await chrome.tabs.update(veo3Tab.id, { active: true });
      await chrome.windows.update(veo3Tab.windowId, { focused: true });
    } else {
      console.log('[GO] No VEO3 tab found, opening new one');
      await chrome.tabs.create({ url: 'https://labs.google/fx/vi/tools/flow' });
    }
    
    window.close();
  }

  showState(state) {
    const states = ['readyState', 'runningState'];
    
    states.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.add('hidden');
    });
    
    const activeState = document.getElementById(state + 'State');
    if (activeState) activeState.classList.remove('hidden');
  }

  updateStats() {
    const totalRowsStat = document.getElementById('totalRowsStat');
    const processedRowsStat = document.getElementById('processedRowsStat');
    
    if (totalRowsStat) totalRowsStat.textContent = this.state.totalRows;
    if (processedRowsStat) processedRowsStat.textContent = this.state.processedRows;
    
    const rowsProcessed = document.getElementById('rowsProcessed');
    const totalRows = document.getElementById('totalRows');
    
    if (rowsProcessed) rowsProcessed.textContent = this.state.processedRows;
    if (totalRows) totalRows.textContent = this.state.totalRows;
  }

  updateProgress() {
    const percentage = this.state.totalRows > 0 
      ? Math.round((this.state.processedRows / this.state.totalRows) * 100)
      : 0;
    
    const progressPercentage = document.getElementById('progressPercentage');
    const progressFill = document.getElementById('progressFill');
    
    if (progressPercentage) progressPercentage.textContent = percentage + '%';
    if (progressFill) progressFill.style.width = percentage + '%';
  }

  addLog(icon, text) {
    const logContainer = document.getElementById('activityLog');
    if (!logContainer) return;
    
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerHTML = `
      <span class="log-icon">${icon}</span>
      <span class="log-text">${text}</span>
    `;
    
    logContainer.insertBefore(logItem, logContainer.firstChild);
    
    while (logContainer.children.length > 50) {
      logContainer.removeChild(logContainer.lastChild);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.flowAutomation = new FlowAutomation();
});