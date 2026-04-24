import { AgentClient } from "../shared/agent-client.js";
import type { ElementSelection, StyleChange } from "../shared/types.js";

let agentClient: AgentClient | null = null;
let designModeOn = false;
let currentSelection: ElementSelection | null = null;

// ---- DOM refs ----
const agentUrlInput = document.getElementById("agentUrl") as HTMLInputElement;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const statusRow = document.getElementById("statusRow") as HTMLDivElement;
const statusDot = document.getElementById("statusDot") as HTMLSpanElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const toggleBtn = document.getElementById("toggleBtn") as HTMLButtonElement;
const tipSection = document.getElementById("tipSection") as HTMLDivElement;
const selectionSection = document.getElementById("selectionSection") as HTMLDivElement;
const elTag = document.getElementById("elTag") as HTMLDivElement;
const elComponent = document.getElementById("elComponent") as HTMLDivElement;
const elSource = document.getElementById("elSource") as HTMLDivElement;
const changesSection = document.getElementById("changesSection") as HTMLDivElement;
const changeCount = document.getElementById("changeCount") as HTMLSpanElement;
const changesList = document.getElementById("changesList") as HTMLDivElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const rollbackBtn = document.getElementById("rollbackBtn") as HTMLButtonElement;
const chatSection = document.getElementById("chatSection") as HTMLDivElement;
const chatInput = document.getElementById("chatInput") as HTMLTextAreaElement;
const loading = document.getElementById("loading") as HTMLDivElement;
const loadingText = document.getElementById("loadingText") as HTMLSpanElement;
const messageArea = document.getElementById("messageArea") as HTMLDivElement;

// ---- Restore saved URL ----
chrome.storage.local.get("agentUrl", (data) => {
  if (data.agentUrl) agentUrlInput.value = data.agentUrl;
});

// ---- Connect ----
connectBtn.addEventListener("click", async () => {
  const url = agentUrlInput.value.trim().replace(/\/$/, "");
  if (!url) return;

  statusRow.style.display = "flex";
  statusDot.className = "status-dot";
  statusText.textContent = "连接中...";

  try {
    agentClient = new AgentClient(url);
    const status = await agentClient.getStatus();

    statusDot.className = "status-dot connected";
    statusText.textContent = `已连接 — ${(status.project as any).framework} 项目`;
    chrome.storage.local.set({ agentUrl: url });

    agentClient.connectWebSocket((type) => {
      if (type === "agent:start") showLoading("AI 正在修改代码...");
      else if (type === "agent:done") {
        hideLoading();
        showMessage("修改已同步到代码，页面即将自动更新", "success");
        // Clear changes after successful save
        sendToContent("CLEAR_CHANGES");
        renderChanges([]);
      }
      else if (type === "agent:error") { hideLoading(); showMessage("修改失败", "error"); }
      else if (type === "agent:rollback") showMessage("已回退", "success");
    });
  } catch {
    statusDot.className = "status-dot disconnected";
    statusText.textContent = "连接失败，请检查地址";
  }
});

// ---- Toggle design mode ----
toggleBtn.addEventListener("click", async () => {
  designModeOn = !designModeOn;
  sendToContent(designModeOn ? "DESIGN_MODE_ON" : "DESIGN_MODE_OFF");

  toggleBtn.textContent = designModeOn ? "关闭设计模式" : "开启设计模式";
  toggleBtn.className = `toggle-btn ${designModeOn ? "on" : "off"}`;

  tipSection.style.display = designModeOn ? "block" : "none";
  chatSection.style.display = designModeOn ? "block" : "none";

  if (!designModeOn) {
    selectionSection.style.display = "none";
    changesSection.style.display = "none";
    currentSelection = null;
  }
});

// ---- Receive element selection from content script ----
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "ELEMENT_SELECTED") {
    currentSelection = message.payload as ElementSelection;
    renderSelection(currentSelection);
    // Poll changes periodically while in design mode
    refreshChanges();
  }
});

function renderSelection(sel: ElementSelection) {
  selectionSection.style.display = "block";
  changesSection.style.display = "block";

  elTag.textContent = `<${sel.tagName}>${sel.className ? " ." + sel.className.split(" ").filter(c => !c.startsWith("prism-design-"))[0] : ""}`;

  if (sel.component) {
    elComponent.textContent = sel.component.name;
    elComponent.style.display = "block";
    elSource.textContent = sel.component.sourceFile
      ? `${sel.component.sourceFile}:${sel.component.sourceLine || ""}`
      : "";
    elSource.style.display = sel.component.sourceFile ? "block" : "none";
  } else {
    elComponent.style.display = "none";
    elSource.style.display = "none";
  }
}

// ---- Changes tracking ----
function refreshChanges() {
  sendToContent("SAVE_CHANGES", (response) => {
    if (response?.changes) {
      renderChanges(response.changes);
    }
  });
}

// Poll for changes while design mode is on
setInterval(() => {
  if (designModeOn) refreshChanges();
}, 2000);

function renderChanges(changes: StyleChange[]) {
  changeCount.textContent = String(changes.length);
  changesSection.style.display = changes.length > 0 ? "block" : "none";

  changesList.innerHTML = "";
  for (const c of changes) {
    const item = document.createElement("div");
    item.className = "change-item";
    item.innerHTML = `
      <span class="prop">${c.property}</span>
      <span class="old">${truncate(c.oldValue, 20)}</span> →
      <span class="new">${truncate(c.newValue, 20)}</span>
    `;
    changesList.appendChild(item);
  }
}

// ---- Save: send changes to Agent ----
saveBtn.addEventListener("click", async () => {
  if (!agentClient) {
    showMessage("请先连接 Agent 服务", "error");
    return;
  }

  // Collect changes from content script
  sendToContent("SAVE_CHANGES", async (response) => {
    const { changes, moves, component } = response || {};
    if ((!changes || changes.length === 0) && (!moves || moves.length === 0)) {
      showMessage("没有待保存的修改", "error");
      return;
    }

    showLoading("AI 正在将修改同步到代码...");

    // Build change descriptions including drag moves
    const allChanges = [...(changes || [])];
    if (moves?.length) {
      for (const m of moves) {
        allChanges.push({
          selector: m.element,
          property: "element-order",
          oldValue: `position ${m.from}`,
          newValue: `position ${m.to}`,
        });
      }
    }

    // Include supplementary AI instructions if any
    const supplement = chatInput.value.trim();

    try {
      const result = await agentClient!.applyChanges(
        allChanges,
        component,
        supplement
      );
      hideLoading();
      if (result.success) {
        showMessage(`已同步到代码：${result.filesModified?.join(", ") || ""}`, "success");
        sendToContent("CLEAR_CHANGES");
        renderChanges([]);
        chatInput.value = "";
      } else {
        showMessage(`失败：${result.message}`, "error");
      }
    } catch {
      hideLoading();
      showMessage("请求失败，请检查 Agent 连接", "error");
    }
  });
});

// ---- Rollback ----
rollbackBtn.addEventListener("click", () => {
  sendToContent("CLEAR_CHANGES");
  // Reload page to restore DOM
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
  });
  renderChanges([]);
  showMessage("已放弃所有修改", "success");
});

// ---- Helpers ----
function sendToContent(type: string, callback?: (response: any) => void) {
  // Send via background script relay
  chrome.runtime.sendMessage({ type }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("[PrismDesign] sendToContent error:", chrome.runtime.lastError.message);
      return;
    }
    if (callback) callback(response);
  });
}

function showLoading(text: string) {
  loadingText.textContent = text;
  loading.className = "loading active";
}

function hideLoading() {
  loading.className = "loading";
}

function showMessage(text: string, type: "success" | "error") {
  messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
  setTimeout(() => { messageArea.innerHTML = ""; }, 5000);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
