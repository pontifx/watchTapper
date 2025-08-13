// background.js - watchTimes with per-tab/host/subdomain refresh intervals

function parseHost(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const parts = host.split('.');
    if (parts.length > 2) {
      return {host, base: parts.slice(-2).join('.')};
    } else {
      return {host, base: host};
    }
  } catch { return {host: '', base: ''}; }
}

// Store per-tab next refresh times
let tabNextRefresh = {};

function getIntervalForTab(tab, callback) {
  const {host, base} = parseHost(tab.url);
  chrome.storage.sync.get({["interval:"+host]: null, ["interval:"+base]: null, interval: 3}, (data) => {
    let interval = data["interval:"+host] || data["interval:"+base] || data.interval;
    callback(interval);
  });
}

function scheduleTabRefresh(tab) {
  getIntervalForTab(tab, (interval) => {
    const now = Date.now();
    const intervalMs = interval * 60 * 1000;
    tabNextRefresh[tab.id] = now + intervalMs;
    chrome.alarms.create('autorefresh-' + tab.id, { when: now + intervalMs });
    updateBadgeCountdown(tab.id, intervalMs / 1000);
  });
}

function updateBadgeCountdown(tabId, secondsLeft) {
  globalThis.tabArtifacts = globalThis.tabArtifacts || {};
  if (globalThis.tabArtifacts[tabId] && globalThis.tabArtifacts[tabId].hasArtifacts) {
    chrome.action.setBadgeText({ text: '🔴', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#d32f2f', tabId });
    return;
  }
  let min = Math.floor(secondsLeft / 60);
  let sec = Math.round(secondsLeft % 60);
  let text = min > 0 ? `${min}m` : `${sec}s`;
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#1976d2', tabId });
  if (secondsLeft > 0) {
    setTimeout(() => updateBadgeCountdown(tabId, secondsLeft - 1), 1000);
  }
}

function rescheduleAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.alarms.clear('autorefresh-' + tab.id, () => {
        scheduleTabRefresh(tab);
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  rescheduleAllTabs();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'updateInterval') {
    rescheduleAllTabs();
  }
  if (msg.type === 'pageArtifacts' && sender.tab) {
    // Store artifacts per tab
    const tabId = sender.tab.id;
    globalThis.tabArtifacts = globalThis.tabArtifacts || {};
    globalThis.tabArtifacts[tabId] = {
      localStorage: msg.localStorage,
      serviceWorkers: msg.serviceWorkers,
      blobs: msg.blobs,
      hasArtifacts: msg.hasArtifacts
    };
    // Set icon to red if artifacts detected, else default
    if (msg.hasArtifacts) {
      chrome.action.setIcon({
        tabId,
        path: {
          "16": "icons/icon-red-16.png",
          "32": "icons/icon-red-32.png",
          "48": "icons/icon-red-48.png",
          "128": "icons/icon-red-128.png"
        }
      });
    } else {
      chrome.action.setIcon({
        tabId,
        path: {
          "16": "icons/iconv2.svg",
          "32": "icons/iconv2.svg",
          "48": "icons/iconv2.svg",
          "128": "icons/iconv2.svg"
        }
      });
    }
  }
  if (msg.type === 'getTabArtifacts' && msg.tabId !== undefined) {
    globalThis.tabArtifacts = globalThis.tabArtifacts || {};
    sendResponse(globalThis.tabArtifacts[msg.tabId] || null);
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('autorefresh-')) {
    const tabId = parseInt(alarm.name.replace('autorefresh-', ''), 10);
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.url && tab.status === 'complete') {
        chrome.tabs.reload(tabId);
        scheduleTabRefresh(tab);
      }
    });
  }
});
