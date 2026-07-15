// 前后端同源部署（Express 同时托管静态页面和 API），直接用相对路径
const API_GENERATE = "/api/generate";
const API_POLISH = "/api/polish";
const API_IMAGE = "/api/image";

const topicEl = document.getElementById("topic");
const draftEl = document.getElementById("draft");
const generateBtn = document.getElementById("generateBtn");
const polishBtn = document.getElementById("polishBtn");
const loadingEl = document.getElementById("loading");
const loadingTextEl = document.getElementById("loadingText");
const errorBoxEl = document.getElementById("errorBox");
const resultSectionEl = document.getElementById("resultSection");
const reviewSectionEl = document.getElementById("reviewSection");
const charCountEl = document.getElementById("charCount");
const draftCountEl = document.getElementById("draftCount");

let currentData = null;
let loadingStepTimer = null;
let currentMode = "create";

topicEl.addEventListener("input", () => {
  charCountEl.textContent = `${topicEl.value.length} 字`;
});
draftEl.addEventListener("input", () => {
  draftCountEl.textContent = `${draftEl.value.length} 字`;
});

// 模式切换（从零创作 / 帮我打磨）
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".mode-panel").forEach((p) => {
      p.classList.toggle("hidden", p.dataset.mode !== currentMode);
    });
    // 切换模式时清空上一次的结果，避免混淆
    resultSectionEl.classList.add("hidden");
    reviewSectionEl.classList.add("hidden");
    clearError();
  });
});

function startLoadingSteps() {
  const steps = document.querySelectorAll(".loading-steps .step");
  let idx = 0;
  steps.forEach((s, i) => s.classList.toggle("active", i === 0));
  loadingStepTimer = setInterval(() => {
    idx = (idx + 1) % steps.length;
    steps.forEach((s, i) => s.classList.toggle("active", i === idx));
  }, 3000);
}

function stopLoadingSteps() {
  if (loadingStepTimer) {
    clearInterval(loadingStepTimer);
    loadingStepTimer = null;
  }
}

function showError(message) {
  errorBoxEl.textContent = message;
  errorBoxEl.classList.remove("hidden");
}

function clearError() {
  errorBoxEl.classList.add("hidden");
  errorBoxEl.textContent = "";
}

function setLoading(isLoading) {
  loadingEl.classList.toggle("hidden", !isLoading);

  const btn = currentMode === "polish" ? polishBtn : generateBtn;
  const idleText = currentMode === "polish" ? "体检 + 打磨成三平台" : "生成三平台内容";
  const idleIcon = currentMode === "polish" ? "🔧" : "✨";
  [generateBtn, polishBtn].forEach((b) => { if (b) b.disabled = isLoading; });
  btn.querySelector(".btn-text").textContent = isLoading ? "处理中..." : idleText;
  btn.querySelector(".btn-icon").textContent = isLoading ? "⏳" : idleIcon;

  if (loadingTextEl) {
    loadingTextEl.textContent = currentMode === "polish"
      ? "正在看你的初稿，大概 15-25 秒"
      : "马上好，通常 10-20 秒";
  }

  if (isLoading) {
    startLoadingSteps();
  } else {
    stopLoadingSteps();
  }
}

// 渲染网感体检报告（仅"帮我打磨"模式返回）
function renderReview(review) {
  if (!review) {
    reviewSectionEl.classList.add("hidden");
    return;
  }
  reviewSectionEl.classList.remove("hidden");

  const scoreEl = document.getElementById("reviewScore");
  const score = typeof review.ai_flavor_score === "number" ? review.ai_flavor_score : "--";
  scoreEl.textContent = score;
  scoreEl.className = "score-num";
  if (typeof score === "number") {
    if (score <= 35) scoreEl.classList.add("score-good");
    else if (score <= 65) scoreEl.classList.add("score-mid");
    else scoreEl.classList.add("score-bad");
  }

  const listEl = document.getElementById("reviewChecklist");
  listEl.innerHTML = "";
  (review.checklist || []).forEach((c) => {
    const li = document.createElement("li");
    li.className = c.pass ? "check-pass" : "check-fail";
    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.textContent = c.pass ? "✓" : "✕";
    const item = document.createElement("span");
    item.className = "check-item";
    item.textContent = c.item || "";
    const note = document.createElement("span");
    note.className = "check-note";
    note.textContent = c.note || "";
    li.appendChild(icon);
    li.appendChild(item);
    li.appendChild(note);
    listEl.appendChild(li);
  });

  const sugEl = document.getElementById("reviewSuggestions");
  sugEl.innerHTML = "";
  (review.suggestions || []).forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    sugEl.appendChild(li);
  });
}

// 带超时的 fetch，避免请求卡死没有反馈
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 单张图片请求，失败自动重试若干次（隧道偶发抖动/生图限流都靠这里兜底）
async function requestImage(prompt, size, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetchWithTimeout(
        API_IMAGE,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, size })
        },
        60000
      );
      const json = await resp.json();
      if (json.code === 0 && json.url) return json.url;
      lastErr = new Error(json.message || "图片生成失败");
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 2500 + attempt * 2000));
    }
  }
  throw lastErr || new Error("图片生成失败");
}

// 渲染一个平台的画廊占位（生成中状态），返回每个 tile 的 DOM 引用
function renderGalleryPlaceholders(containerId, count, filenamePrefix) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const item = document.createElement("div");
    item.className = "gallery-item gallery-item-loading";
    const spinner = document.createElement("div");
    spinner.className = "tile-spinner";
    const label = document.createElement("span");
    label.className = "tile-label";
    label.textContent = "配图生成中…";
    item.appendChild(spinner);
    item.appendChild(label);
    container.appendChild(item);
    tiles.push({ item, filenamePrefix, index: i });
  }
  return tiles;
}

function fillTileSuccess(tile, url) {
  const { item, filenamePrefix, index } = tile;
  item.className = "gallery-item";
  item.innerHTML = "";
  const imageEl = document.createElement("img");
  imageEl.src = url;
  imageEl.alt = `${filenamePrefix} 配图 ${index + 1}`;
  imageEl.loading = "lazy";
  const dl = document.createElement("a");
  dl.className = "gallery-download";
  dl.href = url;
  dl.download = `${filenamePrefix}-${index + 1}.jpg`;
  dl.textContent = "⬇";
  item.appendChild(imageEl);
  item.appendChild(dl);
}

function fillTileError(tile, message, onRetry) {
  const { item } = tile;
  item.className = "gallery-item gallery-item-error";
  item.innerHTML = "";
  const msg = document.createElement("span");
  msg.className = "tile-error-msg";
  msg.textContent = "配图失败";
  const retryBtn = document.createElement("button");
  retryBtn.className = "tile-retry-btn";
  retryBtn.textContent = "点击重试";
  retryBtn.addEventListener("click", () => {
    item.className = "gallery-item gallery-item-loading";
    item.innerHTML = "";
    const sp = document.createElement("div");
    sp.className = "tile-spinner";
    const lb = document.createElement("span");
    lb.className = "tile-label";
    lb.textContent = "重试中…";
    item.appendChild(sp);
    item.appendChild(lb);
    onRetry();
  });
  item.appendChild(msg);
  item.appendChild(retryBtn);
}

// 单个 tile 的拉图逻辑，失败时把重试按钮绑到同一个函数上（可反复重试）
async function loadOneTile(tile, prompt, size) {
  try {
    const url = await requestImage(prompt, size);
    fillTileSuccess(tile, url);
  } catch (err) {
    fillTileError(tile, "配图失败", () => loadOneTile(tile, prompt, size));
  }
}

// 逐张顺序拉取一个平台的所有配图（智谱免费额度并发上限约1，串行最稳）
async function loadPlatformImages(tiles, plans) {
  for (let i = 0; i < tiles.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await loadOneTile(tiles[i], plans[i].prompt, plans[i].size);
  }
}

function renderText(data) {
  currentData = data;
  resultSectionEl.classList.remove("hidden");

  const xhs = data.xiaohongshu || {};
  document.getElementById("xhsTitle").textContent = xhs.title || "";
  document.getElementById("xhsBody").textContent = xhs.body || "";
  const tagsEl = document.getElementById("xhsTags");
  tagsEl.innerHTML = "";
  (xhs.tags || []).forEach((tag) => {
    const span = document.createElement("span");
    span.textContent = tag.startsWith("#") ? tag : `#${tag}`;
    tagsEl.appendChild(span);
  });

  const gzh = data.gongzhonghao || {};
  document.getElementById("gzhTitle").textContent = gzh.title || "";
  document.getElementById("gzhBody").textContent = gzh.body || "";

  const dy = data.douyin || {};
  document.getElementById("dyHook").textContent = dy.hook || "";
  document.getElementById("dyScript").textContent = dy.script || "";
}

// 拿到文案和配图方案后：先渲染文字 + 占位，再并行（各平台之间）逐张拉图
async function loadAllImages(imagePlan) {
  const jobs = [];

  const xhsPlans = (imagePlan && imagePlan.xiaohongshu) || [];
  const xhsTiles = renderGalleryPlaceholders("xhsGallery", xhsPlans.length, "xhs");
  jobs.push(loadPlatformImages(xhsTiles, xhsPlans));

  const gzhPlans = (imagePlan && imagePlan.gongzhonghao) || [];
  const gzhTiles = renderGalleryPlaceholders("gzhGallery", gzhPlans.length, "gzh");
  jobs.push(loadPlatformImages(gzhTiles, gzhPlans));

  const dyPlans = (imagePlan && imagePlan.douyin) || [];
  const dyTiles = renderGalleryPlaceholders("dyGallery", dyPlans.length, "dy");
  jobs.push(loadPlatformImages(dyTiles, dyPlans));

  await Promise.all(jobs);
}

function getCopyText(tab) {
  if (!currentData) return "";
  if (tab === "xhs") {
    const xhs = currentData.xiaohongshu || {};
    const tags = (xhs.tags || []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
    return `${xhs.title || ""}\n\n${xhs.body || ""}\n\n${tags}`;
  }
  if (tab === "gzh") {
    const gzh = currentData.gongzhonghao || {};
    return `${gzh.title || ""}\n\n${gzh.body || ""}`;
  }
  if (tab === "dy") {
    const dy = currentData.douyin || {};
    return `${dy.hook || ""}\n\n${dy.script || ""}`;
  }
  return "";
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = "已复制 ✓";
    setTimeout(() => (btn.textContent = original), 1500);
  } catch (e) {
    alert("复制失败了，手动选中复制吧");
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.dataset.tab === tab));
  });
});

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const text = getCopyText(btn.dataset.copy);
    copyToClipboard(text, btn);
  });
});

// 通用的"提交→拿文案+方案→渲染→逐张拉图"流程，两个入口共用
async function runFlow({ endpoint, payload, showReview }) {
  clearError();
  resultSectionEl.classList.add("hidden");
  reviewSectionEl.classList.add("hidden");
  setLoading(true);

  try {
    const resp = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      },
      90000
    );
    const json = await resp.json();

    if (json.code !== 0) {
      showError(json.message || "没弄成，再试一次");
      return;
    }

    // 打磨模式：先渲染体检报告
    if (showReview) {
      renderReview(json.data.review);
    }

    // 文字立即渲染出来（用户不用等图片）
    renderText(json.data);
    setLoading(false);
    setTimeout(() => {
      const target = showReview && json.data.review ? reviewSectionEl : resultSectionEl;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    // 逐张异步拉图，填充到占位里（每张都是独立短请求，隧道扛得住）
    await loadAllImages(json.data.imagePlan);
  } catch (err) {
    const msg = err && err.name === "AbortError" ? "等太久了，再试一次" : `网络掉了：${(err && err.message) || err}`;
    showError(msg);
  } finally {
    setLoading(false);
  }
}

generateBtn.addEventListener("click", () => {
  const topic = topicEl.value.trim();
  if (!topic) {
    showError("先写点东西再点生成");
    return;
  }
  runFlow({ endpoint: API_GENERATE, payload: { topic }, showReview: false });
});

polishBtn.addEventListener("click", () => {
  const draft = draftEl.value.trim();
  if (!draft) {
    showError("先贴点内容进来再打磨");
    return;
  }
  if (draft.length < 15) {
    showError("初稿太短了，至少写 15 个字再打磨吧");
    return;
  }
  runFlow({ endpoint: API_POLISH, payload: { draft }, showReview: true });
});
