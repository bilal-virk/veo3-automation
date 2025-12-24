console.log('[CONTENT] Script loaded');

let veo3Automation = null;

function init() {
  if (!veo3Automation && typeof Veo3Automation !== 'undefined') {
    veo3Automation = new Veo3Automation();
    console.log('[CONTENT] Veo3Automation initialized');
  }
}

setTimeout(init, 1000);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[CONTENT] Message received:', request.action);
  
  if (request.action === 'ping') {
    console.log('[CONTENT] Ping received, responding...');
    sendResponse({ success: true, message: 'Content script loaded' });
    return true;
  }
  
  if (request.action === 'generateVideo') {
    console.log('[CONTENT] Starting video generation for row:', request.data.rowIndex);
    handleGenerateVideo(request.data).then(result => {
      console.log('[CONTENT] Video generation result:', result);
      sendResponse(result);
    }).catch(error => {
      console.error('[CONTENT] Video generation error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  sendResponse({ success: false, error: 'Unknown action' });
});

async function handleGenerateVideo(data) {
  const { rowData, rowIndex } = data;
  
  console.log('[CONTENT] Processing row', rowIndex, 'with data:', rowData);
  
  try {
    init();
    
    if (!veo3Automation) {
      throw new Error('Veo3Automation not initialized');
    }
    
    console.log('[CONTENT] Calling veo3Automation.generateVideo...');
    await veo3Automation.generateVideo(rowData, rowIndex);
    
    console.log('[CONTENT] ✅ Video generated successfully for row', rowIndex);
    return { success: true, rowIndex };
    
  } catch (error) {
    console.error('[CONTENT] ❌ Error for row', rowIndex, ':', error);
    return { success: false, error: error.message, rowIndex };
  }
}

console.log('[CONTENT] Ready and listening');