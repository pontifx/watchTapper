// content.js - watchTimes minimal version

// Listen for postMessage events
window.addEventListener('message', (event) => {
  // You can send a message to the background script if needed
  // chrome.runtime.sendMessage({ type: 'postMessage', data: event.data });
});

// Monitor localStorage changes (polling, as there is no event for this)
let lastStorage = JSON.stringify(localStorage);
setInterval(() => {
  const current = JSON.stringify(localStorage);
  if (current !== lastStorage) {
    lastStorage = current;
    // chrome.runtime.sendMessage({ type: 'localStorageChanged', data: localStorage });
  }
}, 1000);

// Detect localStorage, service workers, blobs, and send info to background
function detectPageArtifacts() {
  // LocalStorage
  const localStorageKeys = Object.keys(localStorage);
  const localStorageData = localStorageKeys.map(k => `${k}: ${localStorage.getItem(k)}`);

  // Service Workers (exclude extension)
  let serviceWorkers = [];
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      serviceWorkers = regs
        .filter(r => !r.scope.includes('chrome-extension'))
        .map(r => r.scope);
      sendArtifacts();
    });
  } else {
    sendArtifacts();
  }

  // Blobs
  const blobs = (window.performance && window.performance.getEntriesByType)
    ? window.performance.getEntriesByType('resource').filter(e => e.initiatorType === 'blob').map(e => e.name)
    : [];

  function sendArtifacts() {
    const hasArtifacts = localStorageKeys.length || serviceWorkers.length || blobs.length;
    chrome.runtime.sendMessage({
      type: 'pageArtifacts',
      localStorage: localStorageData,
      serviceWorkers,
      blobs,
      hasArtifacts
    });
  }
}

// Run on load and every 5 seconds
detectPageArtifacts();
setInterval(detectPageArtifacts, 5000);

// content.js - watchStrings matching logic

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'checkStrings' && Array.isArray(msg.strings)) {
    // Highlight logic
    function injectHighlightCSS() {
      if (!document.getElementById('watchtapper-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'watchtapper-highlight-style';
        style.textContent = `.watchtapper-highlight { background: #ffd54f; color: #222; border-radius: 3px; padding: 0.1em 0.2em; box-shadow: 0 0 2px #333; font-weight: bold; }`;
        document.head.appendChild(style);
      }
    }
    function removeHighlights() {
      document.querySelectorAll('.watchtapper-highlight').forEach(span => {
        const parent = span.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(span.textContent), span);
          parent.normalize();
        }
      });
    }
    function highlightMatches(strings) {
      if (!Array.isArray(strings) || !strings.length) return;
      injectHighlightCSS();
      removeHighlights();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      const regexes = strings.map(str => new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
      let node;
      while ((node = walker.nextNode())) {
        let text = node.nodeValue;
        let replaced = false;
        regexes.forEach((re, i) => {
          if (re.test(text)) {
            replaced = true;
            text = text.replace(re, match => `<span class="watchtapper-highlight">${match}</span>`);
          }
        });
        if (replaced) {
          const span = document.createElement('span');
          span.innerHTML = text;
          node.parentNode.replaceChild(span, node);
        }
      }
    }
    highlightMatches(msg.strings);
    // Also send matches back for popup display
    const matches = [];
    msg.strings.forEach(str => {
      if (str && document.body.innerText.toLowerCase().includes(str.toLowerCase())) {
        matches.push(str);
      }
    });
    chrome.runtime.sendMessage({type: 'stringsMatched', matches});
  }
});
