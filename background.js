importScripts('service-account-credentials.js', 'google-auth.js');

const downloadTracking = new Map();
const pendingRenames = new Map();
let nextDownloadFilename = null;
let isAutomationRunning = false;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'automationCycle') {
    await runAutomationCycle();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreAlarm();
});

chrome.runtime.onInstalled.addListener(async () => {
  await restoreAlarm();
});

async function restoreAlarm() {
  try {
    const result = await chrome.storage.local.get(['flowState']);
    if (result.flowState && result.flowState.isRunning) {
      const intervalMinutes = (result.flowState.autoCheckInterval || 60) / 60;
      await chrome.alarms.create('automationCycle', {
        delayInMinutes: 0,
        periodInMinutes: intervalMinutes
      });
    }
  } catch (error) {}
}

async function runAutomationCycle() {
  if (isAutomationRunning) {
    console.log('[CYCLE] ⚠️ Automation already running, skipping this cycle');
    return;
  }

  isAutomationRunning = true;
  console.log('[CYCLE] ===== START =====');
  
  try {
    const result = await chrome.storage.local.get(['flowState']);
    const state = result.flowState;
    
    if (!state || !state.isRunning) {
      console.log('[CYCLE] Not running, clearing alarm');
      chrome.alarms.clear('automationCycle');
      return;
    }
    
    console.log('[CYCLE] Reading Google Sheet:', state.clientSheetId);
    const auth = new GoogleServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    const sheetsAPI = new GoogleSheetsAPI(auth);
    
    const sheetId = state.clientSheetId;
    const sheetName = state.sheetName || 'Sheet1';
    const range = `${sheetName}!A:Z`;
    
    const rows = await sheetsAPI.getValues(sheetId, range);
    
    if (!rows || rows.length <= 1) {
      console.log('[CYCLE] No data rows');
      return;
    }
    
    console.log('[CYCLE] Found', rows.length - 1, 'rows');
    const headers = rows[0];
    
    // Count unprocessed rows
    let unprocessedCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const status = (rows[i][0] || '').trim().toLowerCase();
      if (status !== 'done') {
        unprocessedCount++;
      }
    }
    
    console.log(`[CYCLE] Unprocessed rows: ${unprocessedCount}`);
    
    if (unprocessedCount === 0) {
      console.log('[CYCLE] ✅ All rows processed, nothing to do');
      return;
    }
    
    const tabs = await chrome.tabs.query({});
    const veo3Tab = tabs.find(tab => 
      tab.url && tab.url.includes('labs.google/fx/vi/tools/flow')
    );
    
    if (!veo3Tab) {
      console.log('[CYCLE] VEO3 tab not found');
      return;
    }
    
    console.log('[CYCLE] VEO3 tab found:', veo3Tab.id);
    
    console.log('[CYCLE] Checking if content script is loaded...');
    const pingResult = await sendMessageToTab(veo3Tab.id, { action: 'ping' });
    if (!pingResult || !pingResult.success) {
      console.log('[CYCLE] Content script not loaded, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: veo3Tab.id },
          files: ['veo3-automation.js', 'content.js']
        });
        console.log('[CYCLE] Content scripts injected successfully');
        await delay(1000);
        
        const pingRetry = await sendMessageToTab(veo3Tab.id, { action: 'ping' });
        if (!pingRetry || !pingRetry.success) {
          console.error('[CYCLE] Content script still not responding after injection');
          console.error('[CYCLE] SOLUTION: Please refresh the VEO3 tab (F5) and try again');
          return;
        }
      } catch (injectError) {
        console.error('[CYCLE] Failed to inject content scripts:', injectError);
        console.error('[CYCLE] SOLUTION: Please refresh the VEO3 tab (F5) and try again');
        return;
      }
    } else {
      console.log('[CYCLE] ✅ Content script is loaded and responding');
    }
    
    let processedCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const checkResult = await chrome.storage.local.get(['flowState']);
      if (!checkResult.flowState || !checkResult.flowState.isRunning) {
        console.log('[CYCLE] Stopped by user');
        break;
      }
      
      const rowData = rows[i];
      const status = rowData[0] || '';
      
      // Skip if status is exactly "Done"
      if (status.trim().toLowerCase() === 'done') {
        console.log(`[CYCLE] Row ${i + 1}: Already processed (status: ${status}), skipping`);
        continue;
      }
      
      console.log(`[CYCLE] Processing row ${i + 1}`);
      
      const rowObject = {};
      headers.forEach((header, index) => {
        rowObject[header] = rowData[index] || '';
      });
      
      function normalizeKeys(obj) {
        return Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k.trim().toLowerCase(), v])
        );
      }
      
      try {
        const range1 = `${sheetName}!A${i + 1}`;
        await sheetsAPI.updateValues(sheetId, range1, [['Processing...']]);
        console.log(`[CYCLE] Row ${i + 1}: Marked as processing`);
        
        console.log(`[CYCLE] Row ${i + 1}: Sending to content script...`, rowObject);
        const result = await sendMessageToTab(veo3Tab.id, {
          action: 'generateVideo',
          data: { rowData: normalizeKeys(rowObject), rowIndex: i + 1 }
        });
        console.log(result);
        
        if (result && result.success) {
          console.log(`[CYCLE] Row ${i + 1}: ✅ Video generated`);
          await sheetsAPI.updateValues(sheetId, range1, [['Done']]);
          console.log(`[CYCLE] Row ${i + 1}: Marked as Done`);
          processedCount++;
        } else {
          throw new Error(result?.error || 'Generation failed');
        }
        
      } catch (error) {
        console.error(`[CYCLE] Row ${i + 1} error:`, error.message);
        const range1 = `${sheetName}!A${i + 1}`;
        
        let errorMsg = error.message;
        
        if (error.message.includes('Could not establish connection')) {
          errorMsg = 'Content script not loaded';
        } else if (error.message.includes('message channel closed')) {
          errorMsg = 'Generation failed - page reloading';
          console.log(`[CYCLE] Row ${i + 1}: Page is reloading, waiting 70 seconds...`);
          await delay(70000);
          console.log(`[CYCLE] Row ${i + 1}: Continuing after reload...`);
        } else if (error.message.includes('disappeared within 10 seconds')) {
          errorMsg = 'Generation failed - quick failure detected';
          console.log(`[CYCLE] Row ${i + 1}: Page will reload, waiting 70 seconds...`);
          await delay(70000);
          console.log(`[CYCLE] Row ${i + 1}: Continuing after scheduled reload...`);
        }
        
        await sheetsAPI.updateValues(sheetId, range1, [[`Error - ${errorMsg}`]]);
      }
      
      await delay(2000);
    }
    
    console.log(`[CYCLE] Complete: ${processedCount} rows processed`);
    console.log('[CYCLE] ===== END =====');
    
  } catch (error) {
    console.error('[CYCLE] Fatal error:', error);
  } finally {
    isAutomationRunning = false;
    console.log('[CYCLE] Lock released');
  }
}

// NEW FUNCTION: Check for unprocessed rows
async function checkForUnprocessedRows() {
  try {
    const result = await chrome.storage.local.get(['flowState']);
    const state = result.flowState;
    
    if (!state || !state.isRunning) {
      return { hasUnprocessed: false, count: 0 };
    }
    
    const auth = new GoogleServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    const sheetsAPI = new GoogleSheetsAPI(auth);
    
    const sheetId = state.clientSheetId;
    const sheetName = state.sheetName || 'Sheet1';
    const range = `${sheetName}!A:A`; // Only get status column
    
    const rows = await sheetsAPI.getValues(sheetId, range);
    
    if (!rows || rows.length <= 1) {
      return { hasUnprocessed: false, count: 0 };
    }
    
    let unprocessedCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const status = (rows[i][0] || '').trim().toLowerCase();
      if (status !== 'done') {
        unprocessedCount++;
      }
    }
    
    return { hasUnprocessed: unprocessedCount > 0, count: unprocessedCount };
  } catch (error) {
    console.error('[CHECK] Error checking for unprocessed rows:', error);
    return { hasUnprocessed: false, count: 0 };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'startAutomation':
      handleStartAutomation(request.data, sendResponse);
      return true;
      
    case 'stopAutomation':
      handleStopAutomation(sendResponse);
      return true;
      
    case 'prepareDownload':
      handlePrepareDownload(request.data, sendResponse);
      return true;
      
    case 'checkDownloads':
      handleCheckDownloads(sendResponse);
      return true;
      
    case 'checkUnprocessed':
      handleCheckUnprocessed(sendResponse);
      return true;
      
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

async function handleStartAutomation(data, sendResponse) {
  try {
    await chrome.alarms.clear('automationCycle');
    const intervalMinutes = data.autoCheckInterval / 60;
    await chrome.alarms.create('automationCycle', {
      delayInMinutes: 0,
      periodInMinutes: intervalMinutes
    });
    sendResponse({ success: true, message: 'Automation started' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleStopAutomation(sendResponse) {
  try {
    const cleared = await chrome.alarms.clear('automationCycle');
    sendResponse({ success: true, message: 'Automation stopped' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function handlePrepareDownload(data, sendResponse) {
  const { filename } = data;
  console.log(`[BG] Preparing download rename: ${filename}`);
  nextDownloadFilename = filename;
  sendResponse({ success: true, message: `Ready to rename to ${filename}` });
}

async function handleCheckDownloads(sendResponse) {
  try {
    const downloads = await chrome.downloads.search({ 
      limit: 10,
      orderBy: ['-startTime']
    });
    
    const downloadInfo = downloads.map(d => ({
      id: d.id,
      filename: d.filename,
      state: d.state,
      startTime: new Date(d.startTime).toISOString()
    }));
    
    console.log('[BG] Recent downloads:', downloadInfo);
    sendResponse({ success: true, downloads: downloadInfo });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCheckUnprocessed(sendResponse) {
  try {
    const result = await checkForUnprocessedRows();
    console.log(`[CHECK] Unprocessed check: ${result.count} rows pending`);
    
    // If there are unprocessed rows and automation is supposedly running, trigger a cycle
    if (result.hasUnprocessed && !isAutomationRunning) {
      console.log('[CHECK] Found unprocessed rows, triggering automation cycle...');
      // Trigger cycle immediately (don't wait)
      runAutomationCycle().catch(err => console.error('[CHECK] Cycle error:', err));
    }
    
    sendResponse({ success: true, ...result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: true });
      }
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  console.log(`[BG] 🔽 Download started - ID: ${downloadItem.id}`);
  console.log(`[BG] Original filename: ${downloadItem.filename}`);
  console.log(`[BG] Next prepared filename: ${nextDownloadFilename}`);
  
  if (nextDownloadFilename) {
    console.log(`[BG] ✅ Renaming to: ${nextDownloadFilename}`);
    suggest({ 
      filename: nextDownloadFilename, 
      conflictAction: 'uniquify' 
    });
    nextDownloadFilename = null;
  } else {
    console.log(`[BG] ⚠️ No prepared filename, using default`);
    suggest();
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    console.log(`[BG] 📊 Download ${delta.id} state: ${delta.state.current}`);
  }
  if (delta.filename) {
    console.log(`[BG] 📝 Download ${delta.id} filename: ${delta.filename.current}`);
  }
});