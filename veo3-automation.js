class Veo3Automation {
  constructor() {
    this.baseUrl = 'https://labs.google/fx/vi/tools/flow';
    this.selectors = {
      start_project: '//button//i[contains(text(), "add")]',
      prompt_input: '//textarea',
      settings_dialog: '//button[not(@aria-haspopup)]//*[text()="volume_up"]/..',
      aspect_ratio_dropdown: '//*[text()="crop_landscape" or text()="crop_portrait"]/..',
      aspect_ratio_option: (ratio) => `//span[contains(text(), "${ratio}")]`,
      button_to_select_videos_count: '(//button[../..//*[text()="crop_landscape" or text()="crop_portrait"]])[2]',
      videos_count: (count) => `//span[contains(text(), "${count}")]`,
      model_dropdown: '(//button[../..//*[text()="crop_landscape" or text()="crop_portrait"]])[3]',
      model_selector: (model) => `//span[text()="${model}"]`,
      submit_button: '(//*[text()="arrow_forward"]/ancestor::button)[1]',
      loading_indicator: '//*[text()="%"]',
      download_button_dropdown: '(//button[@id]//i[text()="download"]/..)',
      download_button: '(//*[@role="menuitem"])[2]'
    };
    this.downloadedCount = 0;
    this.currentRowIndex = null;
  }

  async clickElement(xpath, timeout = 10000) {
    const element = await this.waitForElement(xpath, timeout);
    element.click();
    await this.delay(500);
  }

  async writeText(xpath, text, timeout = 10000) {
    const element = await this.waitForElement(xpath, timeout);
    element.value = '';
    element.textContent = '';
    element.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    element.value = text;
    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await this.delay(300);
  }

  async waitForElement(xpath, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (element && element.offsetParent !== null) {
        return element;
      }
      await this.delay(100);
    }
    throw new Error(`Element not found: ${xpath}`);
  }

  async waitForElementGone(xpath, timeout = 520000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!element || element.offsetParent === null) {
        return;
      }
      await this.delay(500);
    }
    throw new Error(`Timeout waiting for element to disappear: ${xpath}`);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async generateVideo(promptData, rowIndex) {
    this.currentRowIndex = rowIndex;
    this.downloadedCount = 0;
    console.log('[VEO3] Prompt Data:', promptData);
    
    try {
      try {
        await this.clickElement(this.selectors.start_project, 2000);
        await this.delay(1000);
      } catch (e) {
        console.log('[VEO3] Start button not found, continuing...');
      }
      
      const prompt = promptData['prompt'] || '';
      if (!prompt) {
        throw new Error('Prompt is empty');
      }
      
      console.log('[VEO3] Writing prompt:', prompt);
      await this.writeText(this.selectors.prompt_input, prompt);
      await this.delay(1000);

      console.log('[VEO3] Opening settings dialog...');
      await this.clickElement(this.selectors.settings_dialog);
      await this.delay(1000);

      const aspectRatio = promptData['format'] || promptData['aspect_ratio'];
      if (aspectRatio) {
        console.log('[VEO3] Setting aspect ratio:', aspectRatio);
        await this.clickElement(this.selectors.aspect_ratio_dropdown);
        await this.delay(500);
        await this.clickElement(this.selectors.aspect_ratio_option(aspectRatio));
        await this.delay(500);
      }

      const videoCount = parseInt(promptData['videos to generate'] || promptData['video_count'] || '2');
      console.log('[VEO3] Target video count:', videoCount);
      
      if (videoCount !== 2) {
        console.log('[VEO3] Setting video count:', videoCount);
        await this.clickElement(this.selectors.button_to_select_videos_count);
        await this.delay(500);
        await this.clickElement(this.selectors.videos_count(videoCount.toString()));
        await this.delay(500);
      }

      console.log('[VEO3] Submitting generation...');
      await this.clickElement(this.selectors.submit_button);

      console.log('[VEO3] Waiting for generation to complete...');
      await this.delay(5000);
      
      // Track when loading indicator disappears
      const loadingStartTime = Date.now();
      
      try {
        await this.waitForElementGone(this.selectors.loading_indicator);
        
        const loadingDuration = (Date.now() - loadingStartTime) / 1000; // in seconds
        console.log(`[VEO3] Loading indicator disappeared after ${loadingDuration.toFixed(1)} seconds`);
        
        // If loading indicator disappeared within 10 seconds, generation likely failed
        if (loadingDuration < 10) {
          console.error('[VEO3] ⚠️ Generation failed - loading indicator disappeared too quickly');
          
          // Throw error immediately - DON'T reload here
          throw new Error('Generation failed - loading indicator disappeared within 10 seconds. Page will reload.');
        }
        
        console.log('[VEO3] ✅ Generation appears successful');
        
      } catch (error) {
        if (error.message.includes('Timeout waiting for element to disappear')) {
          // Loading indicator never disappeared - this is actually bad too
          console.error('[VEO3] ⚠️ Loading indicator stuck - generation might have hung');
          throw new Error('Generation timeout - loading indicator never disappeared');
        }
        throw error;
      }
      
      console.log('[VEO3] Generation complete, starting downloads...');
      await this.delay(2000);
      
      // Pass videoCount to download function
      await this.downloadNewVideos(rowIndex, videoCount);
      
      console.log('[VEO3] ✅ All downloads complete for row', rowIndex);
      return { success: true, rowIndex };
      
    } catch (error) {
      console.error('[VEO3] ❌ Generation failed:', error.message);
      
      // If it's the quick-failure error, schedule a reload
      if (error.message.includes('disappeared within 10 seconds')) {
        console.log('[VEO3] Scheduling page reload in 60 seconds...');
        setTimeout(() => {
          console.log('[VEO3] Reloading page now...');
          location.reload();
        }, 60000);
      }
      
      throw error;
    }
  }

  async downloadNewVideos(rowIndex, targetCount) {
    try {
      const downloadButtons = document.evaluate(
        this.selectors.download_button_dropdown,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      
      const totalButtonCount = downloadButtons.snapshotLength;
      console.log(`[VEO3] Found ${totalButtonCount} total download buttons`);
      console.log(`[VEO3] Will download first ${targetCount} videos`);
      
      // Only download up to targetCount videos
      const downloadCount = Math.min(targetCount, totalButtonCount);
      
      for (let i = 0; i < downloadCount; i++) {
        const button = downloadButtons.snapshotItem(i);
        
        if (i >= this.downloadedCount) {
          console.log(`[VEO3] Downloading video ${i + 1}/${downloadCount}...`);
          
          // Prepare the filename BEFORE clicking download
          const timestamp = Date.now();
          const filename = `row${rowIndex}_video${i + 1}_${timestamp}.mp4`;
          
          try {
            // Tell background to prepare for this download
            await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                action: 'prepareDownload',
                data: { filename: filename }
              }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              });
            });
            
            console.log(`[VEO3] ✅ Prepared filename: ${filename}`);
          } catch (error) {
            console.warn(`[VEO3] ⚠️ Failed to prepare filename:`, error.message);
          }
          
          // Small delay to ensure background is ready
          await this.delay(200);
          
          // Now click download
          button.click();
          await this.delay(500);
          
          await this.clickElement(this.selectors.download_button, 5000);
          await this.delay(1500); // Wait for download to start
          
          this.downloadedCount++;
        }
      }
      
      console.log(`[VEO3] ✅ Downloaded ${this.downloadedCount} videos (target was ${targetCount})`);
      
    } catch (error) {
      console.error('[VEO3] ❌ Download error:', error.message);
      throw error;
    }
  }
}

// Make sure to instantiate the class
if (typeof window.veo3Automation === 'undefined') {
  window.veo3Automation = new Veo3Automation();
  console.log('[VEO3] Automation class initialized');
}

// TEST FUNCTIONS - Available in console
window.testPrepareDownload = async function() {
  console.log('=== TESTING PREPARE DOWNLOAD ===');
  
  const testFilename = 'test_prepare_' + Date.now() + '.mp4';
  console.log('Preparing filename:', testFilename);
  console.log('Now click a download button immediately...');
  
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
      }, 5000);
      
      chrome.runtime.sendMessage({
        action: 'prepareDownload',
        data: { filename: testFilename }
      }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('✅ Prepare Response:', response);
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

window.checkDownloads = async function() {
  console.log('=== CHECKING RECENT DOWNLOADS ===');
  
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
      }, 5000);
      
      chrome.runtime.sendMessage({
        action: 'checkDownloads'
      }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('✅ Downloads:', response);
    if (response && response.downloads) {
      console.table(response.downloads);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

window.testFullFlow = async function() {
  console.log('=== TESTING FULL DOWNLOAD FLOW ===');
  console.log('This will prepare 3 filenames.');
  console.log('Click the download buttons as instructed.\n');
  
  for (let i = 1; i <= 3; i++) {
    const filename = `test_flow_video${i}_${Date.now()}.mp4`;
    console.log(`\n--- [${i}/3] Preparing: ${filename} ---`);
    
    try {
      // Prepare filename
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout'));
        }, 5000);
        
        chrome.runtime.sendMessage({
          action: 'prepareDownload',
          data: { filename: filename }
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      console.log('✅ Prepared:', response.message);
      console.log(`👆 NOW CLICK DOWNLOAD BUTTON #${i} IMMEDIATELY!`);
      console.log('Waiting 5 seconds for next preparation...\n');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error('❌ Error preparing:', error);
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
  console.log('Check your downloads folder for files named: test_flow_video1_*.mp4, test_flow_video2_*.mp4, test_flow_video3_*.mp4');
};

window.testSingleDownload = async function() {
  console.log('=== TESTING SINGLE DOWNLOAD ===');
  
  const filename = `test_single_${Date.now()}.mp4`;
  console.log('Preparing filename:', filename);
  
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'prepareDownload',
        data: { filename: filename }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('✅ Response:', response);
    console.log('👆 NOW CLICK A DOWNLOAD BUTTON!');
    console.log('The file should be named:', filename);
  } catch (error) {
    console.error('❌ Error:', error);
  }
};