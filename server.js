const express = require('express');
const path = require('path');
const { generateImage: generateZhipuImage } = require('./zhipuImage');
const { generateCoverImage: generateBuddyCloudImage } = require('./buddyCloudImage');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'web')));

// 配图 Provider 优先级：
// 1. 智谱 CogView-3-Flash（官方长期免费，账号专属配额，同步接口不用轮询，速度快且不受全平台抢名额影响）
// 2. CodeBuddy 内置生图代理（hy-image-v3，全平台共享并发上限，高峰期容易排队/失败，仅作兜底）
const IMAGE_PROVIDERS = [
  {
    name: 'zhipu',
    keyEnv: 'ZHIPU_API_KEY',
    call: (prompt, size) => generateZhipuImage(prompt, { size })
  },
  {
    name: 'buddycloud',
    keyEnv: 'BUDDY_CLOUD_TOKEN',
    call: (prompt) => generateBuddyCloudImage(prompt)
  }
];

async function generateOneImage(prompt, size) {
  const available = IMAGE_PROVIDERS.filter((p) => process.env[p.keyEnv]);
  if (!available.length) {
    throw new Error('未配置任何生图 API Key（ZHIPU_API_KEY 或 BUDDY_CLOUD_TOKEN）');
  }
  let lastErr;
  for (const provider of available) {
    try {
      return await provider.call(prompt, size);
    } catch (err) {
      lastErr = err;
      // 当前 provider 失败（如限流/配额问题），自动尝试下一个兜底通道
    }
  }
  throw lastErr;
}

const SYSTEM_PROMPT = `你是一个服务于"AI/科技/产品经理"垂类内容创作者的专业新媒体编辑，同时要为每篇内容规划配图方案。你的任务是把用户输入的一个话题或几个要点，改写成三个平台的专属版本。

写作风格铁律（去AI味）：
- 禁止使用"总的来说""不难发现""值得注意的是""在当今这个XX的时代"这类AI腔总结句/开头
- 开头要有真实细节、具体场景或反常识观点，不要泛泛而谈
- 允许适度口语化插入词，比如"说实话""谁懂啊""踩过坑才知道""说个真事"
- 内容要具体、有个人经验感和信息密度，不要空洞的正确废话
- 风格是"干货复盘/踩坑分享/工具测评"体，不是"种草体"，不要用"闭眼冲""绝绝子"这类小红书种草黑话

配图规划规则（重要，三个平台形态不同，不要一套图打天下）：
- 小红书是"图集"平台，多图笔记才是主流。根据正文的分论点/场景数量，规划 3-5 张图（不要固定数字，按内容信息量自行判断），营造真实的多图笔记感，不要都是同一张图的变体
- 公众号只需要 1 张头图（横版banner构图，用于文章顶部展示，不需要竖版）
- 抖音本质是视频平台，本工具不生成真实视频。只规划 2 张"分镜参考图/封面候选图"（第1张作为视频封面候选，第2张对应脚本中间的关键画面），供创作者拍摄或剪辑时参考，不代表完整视频内容
- 每张图的 prompt 必须是完整、具体的中文视觉描述（场景、主体、光线、构图），不要写"同上""类似第一张"这类省略表达
- 同一平台内的多张图要保持统一的摄影风格/色调（比如统一暖光摄影质感），只切换场景或主体，避免风格跳跃

请严格按以下JSON格式输出，不要有任何多余文字、不要用markdown代码块包裹、不要输出注释：
{
  "xiaohongshu": {
    "title": "小红书标题，20字以内，带emoji，干货/踩坑体",
    "body": "小红书正文，300-500字，emoji分段，口语化，段落之间空一行",
    "tags": ["话题标签1", "话题标签2", "话题标签3", "话题标签4"],
    "image_prompts": ["图1完整视觉描述", "图2完整视觉描述", "图3完整视觉描述"]
  },
  "gongzhonghao": {
    "title": "公众号标题，SEO友好，20字以内",
    "body": "公众号正文，800-1200字，用##作为二级小标题分段，结尾引导关注互动",
    "image_prompt": "头图完整视觉描述（横版banner构图）"
  },
  "douyin": {
    "hook": "3秒强钩子开头，一句话，要有冲突感或反常识",
    "script": "口播脚本，分段标注时间点，例如[0-5s]...[5-15s]...，全长约60秒对应150-200字",
    "image_prompts": ["封面候选图完整视觉描述", "关键分镜图完整视觉描述"]
  }
}`;

function fallbackPrompt(topic, hint) {
  return `杂志摄影质感${hint || '封面图'}，真实办公或生活场景，暖白光线，专业摄影构图，主题相关内容：${topic}。避免过多文字元素，无文字`;
}

// 入口B「帮我打磨」的系统提示：用户已经有初稿，任务是①诊断原稿②在保留用户核心信息/个人经历/观点的前提下，适配成三平台版本
const POLISH_SYSTEM_PROMPT = `你是一个服务于"AI/科技/产品经理"垂类内容创作者的资深新媒体主编。用户会给你一段他自己写的初稿（可能是随手写的、口语化的、或某一个平台的版本）。你要做两件事：

【第一件事：网感体检】
先客观诊断这篇初稿，给出一份"体检报告"：
- ai_flavor_score：AI味评分（0-100 的整数，越低越自然/越像真人写的；如果读起来很像ChatGPT生成的、充满正确的废话和总结腔，就打高分）
- checklist：爆款要素自检清单，逐项判断初稿是否具备，每项给 pass(true/false) 和一句话 note。固定检查这5项，item 字段严格用这几个名字："开头有钩子"、"有具体细节/个人经验"、"情绪浓度足够"、"有互动引导"、"标题/主题够吸引人"
- suggestions：3条最关键的、具体的改进建议（针对这篇初稿本身，不要泛泛而谈）

【第二件事：三平台适配改写】
在**保留用户初稿的核心信息、个人经历、真实观点**的前提下（不要编造用户没提到的事实），把它改写成三个平台的专属版本，并规划配图。

写作风格铁律（去AI味）：
- 禁止"总的来说""不难发现""值得注意的是""在当今这个XX的时代"这类AI腔
- 保留用户原稿里的真实细节和个人化表达，只做平台化的结构/语气调整
- 风格是"干货复盘/踩坑分享/工具测评"体，不是"种草体"

配图规划规则（同 A 入口）：小红书 3-5 张图集图；公众号 1 张横版头图；抖音 2 张分镜/封面参考图。每张 prompt 是完整具体的中文视觉描述，同平台内风格统一。

请严格按以下JSON格式输出，不要有任何多余文字、不要用markdown代码块包裹、不要输出注释：
{
  "review": {
    "ai_flavor_score": 30,
    "checklist": [
      {"item": "开头有钩子", "pass": true, "note": "简短说明"},
      {"item": "有具体细节/个人经验", "pass": false, "note": "简短说明"},
      {"item": "情绪浓度足够", "pass": true, "note": "简短说明"},
      {"item": "有互动引导", "pass": false, "note": "简短说明"},
      {"item": "标题/主题够吸引人", "pass": true, "note": "简短说明"}
    ],
    "suggestions": ["改进建议1", "改进建议2", "改进建议3"]
  },
  "xiaohongshu": {
    "title": "小红书标题，20字以内，带emoji，干货/踩坑体",
    "body": "小红书正文，300-500字，emoji分段，口语化，段落之间空一行",
    "tags": ["话题标签1", "话题标签2", "话题标签3", "话题标签4"],
    "image_prompts": ["图1完整视觉描述", "图2完整视觉描述", "图3完整视觉描述"]
  },
  "gongzhonghao": {
    "title": "公众号标题，SEO友好，20字以内",
    "body": "公众号正文，800-1200字，用##作为二级小标题分段，结尾引导关注互动",
    "image_prompt": "头图完整视觉描述（横版banner构图）"
  },
  "douyin": {
    "hook": "3秒强钩子开头，一句话，要有冲突感或反常识",
    "script": "口播脚本，分段标注时间点，例如[0-5s]...[5-15s]...，全长约60秒对应150-200字",
    "image_prompts": ["封面候选图完整视觉描述", "关键分镜图完整视觉描述"]
  }
}`;

// 各平台配图的尺寸档位（智谱 CogView-3-Flash 支持的枚举尺寸，选贴近各平台实际展示比例的档位）
const PLATFORM_IMAGE_SIZE = {
  xiaohongshu: '864x1152', // 3:4 竖版，小红书图集主流比例
  gongzhonghao: '1344x768', // 16:9 横版banner，公众号头图
  douyin: '768x1344' // 约9:16 竖版，贴近视频封面比例
};

// 把 LLM 规划的图片方案整理成 { xiaohongshu:[{prompt,size}], gongzhonghao:[...], douyin:[...] }
// 并做数量兜底/裁剪，避免 LLM 输出异常（缺失/超量）导致生成过慢或报错
function buildImagePlan(parsed, topic) {
  const xhsPrompts = Array.isArray(parsed.xiaohongshu && parsed.xiaohongshu.image_prompts)
    ? parsed.xiaohongshu.image_prompts.filter(Boolean)
    : [];
  const dyPrompts = Array.isArray(parsed.douyin && parsed.douyin.image_prompts)
    ? parsed.douyin.image_prompts.filter(Boolean)
    : [];
  const gzhPrompt = (parsed.gongzhonghao && parsed.gongzhonghao.image_prompt) || fallbackPrompt(topic, '公众号头图（横版）');

  const wrap = (prompt, platform) => ({ prompt, size: PLATFORM_IMAGE_SIZE[platform] });

  return {
    xiaohongshu: (xhsPrompts.length ? xhsPrompts : [fallbackPrompt(topic, '小红书图集封面')]).slice(0, 5).map((p) => wrap(p, 'xiaohongshu')),
    gongzhonghao: [wrap(gzhPrompt, 'gongzhonghao')],
    douyin: (dyPrompts.length ? dyPrompts : [fallbackPrompt(topic, '抖音封面')]).slice(0, 2).map((p) => wrap(p, 'douyin'))
  };
}

// 文案生成 Provider 优先级：智谱GLM-4.7-Flash（永久免费，官方长期免费开放，无需充值）
// 兜底：DeepSeek官方API（如果配置了余额，效果略更细腻，可作为备选/对比）
const TEXT_PROVIDERS = [
  {
    name: 'zhipu',
    keyEnv: 'ZHIPU_API_KEY',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4.7-flash',
    // GLM-4.7-Flash 是混合思考模型，默认会花大量时间推理；这个"改写+配图规划"任务不需要深度思考，
    // 关掉思考模式可显著提速（约从30s降到10s级），输出质量对本任务影响很小
    extraBody: { thinking: { type: 'disabled' } }
  },
  {
    name: 'deepseek',
    keyEnv: 'DEEPSEEK_API_KEY',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat'
  }
];

async function callTextProvider(provider, systemPrompt, userContent) {
  const apiKey = process.env[provider.keyEnv];
  const resp = await fetch(provider.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.8,
      ...(provider.extraBody || {}),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = (json && json.error && json.error.message) || `${provider.name} 请求失败 (${resp.status})`;
    const err = new Error(msg);
    err.provider = provider.name;
    throw err;
  }
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error(`${provider.name} 未返回有效内容`);
  return content;
}

// 通用文案生成：按 provider 优先级依次尝试，任一成功即返回。
// 免费模型（GLM-4.7-Flash）高峰期常返回 1305「访问量过大」的临时限流，对这类错误做几次短重试再兜底到下一个 provider。
function isTransientTextError(err) {
  const m = (err && err.message) || '';
  return /访问量过大|1305|rate.?limit|too many|请稍后|稍后再试|忙|overload/i.test(m);
}

async function runTextGeneration(systemPrompt, userContent) {
  const available = TEXT_PROVIDERS.filter((p) => process.env[p.keyEnv]);
  if (available.length === 0) {
    const err = new Error('服务端尚未配置文案生成 API Key（ZHIPU_API_KEY 或 DEEPSEEK_API_KEY），请联系管理员配置后重试');
    err.code = 'NO_TEXT_KEY';
    throw err;
  }

  let lastErr;
  let sawTransient = false;
  for (const provider of available) {
    const maxRetries = 4;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await callTextProvider(provider, systemPrompt, userContent);
      } catch (err) {
        lastErr = err;
        // 临时限流：短等后重试同一个 provider（免费模型高峰期常见）
        if (isTransientTextError(err) && attempt < maxRetries - 1) {
          sawTransient = true;
          await new Promise((r) => setTimeout(r, 2500 + attempt * 2500));
          continue;
        }
        if (isTransientTextError(err)) sawTransient = true;
        // 非临时错误（如余额不足）或已重试用尽：换下一个 provider
        break;
      }
    }
  }
  // 如果过程中遇到过限流，给用户可行动的友好提示（而不是暴露兜底 provider 的"余额不足"等误导信息）
  if (sawTransient) {
    const e = new Error('AI 文案服务当前访问量过大，请过 10 秒左右再点一次');
    e.code = 'BUSY';
    throw e;
  }
  throw lastErr;
}

// 入口A：0→1 从零创作（给话题/要点，从零生成）
const generateText = (topic) => runTextGeneration(SYSTEM_PROMPT, `话题/要点：\n${topic}`);
// 入口B：0.5→1 帮我打磨（给已有初稿，适配三平台 + 网感体检）
const polishText = (draft) => runTextGeneration(POLISH_SYSTEM_PROMPT, `我的初稿：\n${draft}`);

function parseTextJson(rawText) {
  let raw = (rawText || '').trim();
  raw = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// 第一步接口：只生成文案 + 配图方案（image prompts），不生成图片。
// 这样这个请求很快（只有一次 LLM 调用，约10-20秒），公网隧道不会因长请求断开。
// ---------------------------------------------------------------------------
app.post('/api/generate', async (req, res) => {
  try {
    const topic = (req.body && req.body.topic) || '';
    if (!topic.trim()) {
      return res.json({ code: -1, message: '请输入话题或内容要点' });
    }

    let rawText;
    try {
      rawText = await generateText(topic);
    } catch (reason) {
      return res.json({
        code: reason && reason.code === 'NO_TEXT_KEY' ? -3 : -1,
        message: (reason && reason.message) || '文案生成失败，请重试'
      });
    }

    let parsed;
    try {
      parsed = parseTextJson(rawText);
    } catch (e) {
      return res.json({ code: -2, message: '文案生成结果解析失败，请重试', raw: rawText });
    }

    const imagePlan = buildImagePlan(parsed, topic);

    return res.json({
      code: 0,
      data: {
        xiaohongshu: {
          title: parsed.xiaohongshu && parsed.xiaohongshu.title,
          body: parsed.xiaohongshu && parsed.xiaohongshu.body,
          tags: parsed.xiaohongshu && parsed.xiaohongshu.tags
        },
        gongzhonghao: {
          title: parsed.gongzhonghao && parsed.gongzhonghao.title,
          body: parsed.gongzhonghao && parsed.gongzhonghao.body
        },
        douyin: {
          hook: parsed.douyin && parsed.douyin.hook,
          script: parsed.douyin && parsed.douyin.script
        },
        imagePlan
      }
    });
  } catch (error) {
    return res.json({ code: -1, message: (error && error.message) || '生成失败，请重试' });
  }
});

// ---------------------------------------------------------------------------
// 第二步接口：生成单张图片。前端拿到 imagePlan 后逐张调用。
// 每个请求只做一张图（几秒），公网隧道完全扛得住，单张失败也能单独重试。
// ---------------------------------------------------------------------------
app.post('/api/image', async (req, res) => {
  try {
    const prompt = (req.body && req.body.prompt) || '';
    const size = (req.body && req.body.size) || '864x1152';
    if (!prompt.trim()) {
      return res.json({ code: -1, message: '缺少图片描述' });
    }
    const url = await generateOneImage(prompt, size);
    return res.json({ code: 0, url });
  } catch (error) {
    return res.json({ code: -1, message: (error && error.message) || '图片生成失败' });
  }
});

// ---------------------------------------------------------------------------
// 入口B「帮我打磨」：用户给初稿 → 网感体检报告 + 三平台适配 + 配图方案。
// 同样只做文案+方案（不生成图），图片仍走 /api/image 逐张异步拉。
// ---------------------------------------------------------------------------
app.post('/api/polish', async (req, res) => {
  try {
    const draft = (req.body && req.body.draft) || '';
    if (!draft.trim()) {
      return res.json({ code: -1, message: '请粘贴你的初稿内容' });
    }
    if (draft.trim().length < 15) {
      return res.json({ code: -1, message: '初稿太短了，至少写 15 个字再打磨吧' });
    }

    let rawText;
    try {
      rawText = await polishText(draft);
    } catch (reason) {
      return res.json({
        code: reason && reason.code === 'NO_TEXT_KEY' ? -3 : -1,
        message: (reason && reason.message) || '打磨失败，请重试'
      });
    }

    let parsed;
    try {
      parsed = parseTextJson(rawText);
    } catch (e) {
      return res.json({ code: -2, message: '打磨结果解析失败，请重试', raw: rawText });
    }

    const imagePlan = buildImagePlan(parsed, draft.slice(0, 40));

    return res.json({
      code: 0,
      data: {
        review: parsed.review || null,
        xiaohongshu: {
          title: parsed.xiaohongshu && parsed.xiaohongshu.title,
          body: parsed.xiaohongshu && parsed.xiaohongshu.body,
          tags: parsed.xiaohongshu && parsed.xiaohongshu.tags
        },
        gongzhonghao: {
          title: parsed.gongzhonghao && parsed.gongzhonghao.title,
          body: parsed.gongzhonghao && parsed.gongzhonghao.body
        },
        douyin: {
          hook: parsed.douyin && parsed.douyin.hook,
          script: parsed.douyin && parsed.douyin.script
        },
        imagePlan
      }
    });
  } catch (error) {
    return res.json({ code: -1, message: (error && error.message) || '打磨失败，请重试' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`content-creator-tool server running on port ${PORT}`);
});
// 文案接口约10-20秒，单张图接口约5-15秒，都不算长请求；留一定余量应对网络波动
server.timeout = 90000;
server.keepAliveTimeout = 95000;
server.headersTimeout = 96000;
