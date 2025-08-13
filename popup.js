// popup.js - All popup logic for watchTimes extension

// Tab switching
function setActiveTab(tabId) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('[id^="tab-content-"]').forEach(content => content.style.display = 'none');
  document.getElementById(tabId).classList.add('active');
  document.getElementById('tab-content-' + tabId.split('-')[1]).style.display = '';
  if (tabId === 'tab-cookies') loadCookies();
  if (tabId === 'tab-global') loadGlobalArtifacts();
}
// Load detected artifacts for global tab
function loadGlobalArtifacts() {
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    const tabId = tabs[0].id;
    chrome.runtime.sendMessage({type: 'getTabArtifacts', tabId}, res => {
      const lsBox = document.getElementById('global-localstorage');
      const swBox = document.getElementById('global-serviceworkers');
      const blobBox = document.getElementById('global-blobs');
      const copyBtn = document.getElementById('global-copyall');
      if (!res) {
        lsBox.value = '';
        swBox.value = '';
        blobBox.value = '';
        copyBtn.disabled = true;
        return;
      }
      lsBox.value = (res.localStorage && res.localStorage.length) ? res.localStorage.join('\n') : '';
      swBox.value = (res.serviceWorkers && res.serviceWorkers.length) ? res.serviceWorkers.join('\n') : '';
      blobBox.value = (res.blobs && res.blobs.length) ? res.blobs.join('\n') : '';
      copyBtn.disabled = !(lsBox.value || swBox.value || blobBox.value);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('global-copyall');
  if (copyBtn) {
    copyBtn.onclick = function() {
      const ls = document.getElementById('global-localstorage').value;
      const sw = document.getElementById('global-serviceworkers').value;
      const blob = document.getElementById('global-blobs').value;
      const all = [ls, sw, blob].filter(Boolean).join('\n\n');
      navigator.clipboard.writeText(all);
    };
  }
});
['tab-page','tab-global','tab-strings','tab-cookies'].forEach(tabId => {
  document.getElementById(tabId).onclick = function() {
    setActiveTab(tabId);
  };
});
setActiveTab('tab-page');

// Get current tab URL
function getCurrentTab(callback) {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    callback(tabs[0]);
  });
}
// Extract hostname and subdomain
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
// Load per-page interval and checkboxes
getCurrentTab(tab => {
  const {host, base} = parseHost(tab.url);
  document.getElementById('host-label').textContent = base;
  chrome.storage.sync.get({["interval:"+host]: 3, ["interval:"+base]: 3, interval: 3}, (data) => {
    document.getElementById('interval-page').value = data["interval:"+host] || data["interval:"+base] || data.interval;
    document.getElementById('interval-global').value = data.interval;
    document.getElementById('apply-subdomains').checked = !!data["interval:"+base];
    document.getElementById('apply-host').checked = !!data["interval:"+host];
  });
});
document.getElementById('apply-subdomains').onchange = function() {
  if (this.checked) document.getElementById('apply-host').checked = false;
};
document.getElementById('apply-host').onchange = function() {
  if (this.checked) document.getElementById('apply-subdomains').checked = false;
};
document.getElementById('save-page').onclick = function() {
  getCurrentTab(tab => {
    const {host, base} = parseHost(tab.url);
    const val = parseInt(document.getElementById('interval-page').value, 10);
    const applySub = document.getElementById('apply-subdomains').checked;
    const applyHost = document.getElementById('apply-host').checked;
    let key, blurb;
    if (applySub) {
      key = "interval:"+base;
      blurb = `Interval set for all subdomains`;
    } else if (applyHost) {
      key = "interval:"+host;
      blurb = `Interval set`;
    } else {
      key = "interval:"+host;
      blurb = `Interval set`;
    }
    const removeKey = applySub ? "interval:"+host : "interval:"+base;
    chrome.storage.sync.remove(removeKey, () => {
      chrome.storage.sync.set({[key]: val}, () => {
        document.getElementById('status-page').textContent = 'Saved!';
        setTimeout(() => document.getElementById('status-page').textContent = '', 1000);
        document.getElementById('change-blurb').textContent = blurb;
        setTimeout(() => document.getElementById('change-blurb').textContent = '', 3000);
        chrome.runtime.sendMessage({type: 'updateInterval'});
      });
    });
  });
};
document.getElementById('save-global').onclick = function() {
  const val = parseInt(document.getElementById('interval-global').value, 10);
  chrome.storage.sync.set({interval: val}, () => {
    document.getElementById('status-global').textContent = 'Saved!';
    setTimeout(() => document.getElementById('status-global').textContent = '', 1000);
    chrome.runtime.sendMessage({type: 'updateInterval'});
  });
};
chrome.storage.sync.get({watchStrings: ''}, (data) => {
  document.getElementById('strings-list').value = data.watchStrings;
});
document.getElementById('save-strings').onclick = function() {
  const val = document.getElementById('strings-list').value;
  chrome.storage.sync.set({watchStrings: val}, () => {
    document.getElementById('status-strings').textContent = 'Strings saved!';
    setTimeout(() => document.getElementById('status-strings').textContent = '', 1500);
    // Send message to content script to check for matches
    const strings = val.split('\n').map(s => s.trim()).filter(Boolean);
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, {type: 'checkStrings', strings});
    });
  });
};
// Listen for matches from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'stringsMatched') {
    // Only update if the strings tab is active
    const tabContent = document.getElementById('tab-content-strings');
    const isActive = tabContent && tabContent.style.display !== 'none';
    const statusElem = document.getElementById('status-strings');
    if (isActive && statusElem) {
      const status = msg.matches && msg.matches.length
        ? `Matched: ${msg.matches.join(', ')}`
        : 'No matches found.';
      statusElem.textContent = status;
      setTimeout(() => {
        // Re-check element and tab activity before clearing
        const statusElem2 = document.getElementById('status-strings');
        const tabContent2 = document.getElementById('tab-content-strings');
        if (tabContent2 && tabContent2.style.display !== 'none' && statusElem2) {
          statusElem2.textContent = '';
        }
      }, 3000);
    }
  }
  if (msg.type === 'tabArtifacts') {
    // For future use: could update UI if needed
  }
});
function updateNextRefresh() {
  chrome.alarms.get('autorefresh', (alarm) => {
    if (alarm) {
      const next = new Date(alarm.scheduledTime);
      document.getElementById('nextRefresh').textContent = 'Next refresh: ' + next.toLocaleTimeString();
    } else {
      document.getElementById('nextRefresh').textContent = '';
    }
  });
}
updateNextRefresh();
setInterval(updateNextRefresh, 1000);
let keepCookies = [];
function loadCookies() {
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    const tab = tabs[0];
    chrome.cookies.getAll({url: tab.url}, cookies => {
      keepCookies = cookies.map(c => c.name);
      renderCookieList();
    });
  });
}
function renderCookieList() {
  const listDiv = document.getElementById('cookie-list');
  listDiv.innerHTML = '';
  keepCookies.forEach(name => {
    const span = document.createElement('span');
    span.textContent = name;
    span.style = "display:inline-block;background:#3949ab;color:#fff;padding:0.3em 0.7em;border-radius:4px;margin:0.2em 0.3em;font-size:0.98em;";
    listDiv.appendChild(span);
  });
}
document.getElementById('add-cookie').onclick = function() {
  const val = document.getElementById('manual-cookie').value.trim();
  if (val && !keepCookies.includes(val)) {
    keepCookies.push(val);
    renderCookieList();
    document.getElementById('manual-cookie').value = '';
  }
};
document.getElementById('shuffle-cookies').onclick = function() {
  document.getElementById('status-cookies').textContent = "Shuffling cookies... (functionality coming soon!)";
  setTimeout(() => document.getElementById('status-cookies').textContent = '', 2000);
};
