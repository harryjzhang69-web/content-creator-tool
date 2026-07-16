// 共享模块：prompts + 智谱文案/生图调用逻辑（从原 Express server.js 逐字段迁移到 EdgeOne Node Functions）
// - 文案：智谱 GLM-4.7-Flash（关思考提速）
// - 配图：智谱 CogView-3-Flash（账号专属配额，同步接口，无需轮询）
// EdgeOne Node Functions 是 Node 运行时，支持 fetch / 标准 Web API。

// ---- API Key 从 EdgeOne 控制台「环境变量」读取（不硬编码，避免公开仓库泄露 Key）----
// 部署前必须在 EdgeOne Pages 项目设置 → 环境变量里添加：ZHIPU_API_KEY = 你的智谱Key
const TEXT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const TEXT_MODEL = 'glm-4.7-flash';
const IMAGE_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/images/generations';
const IMAGE_MODEL = 'cogview-3-flash';

function getZhipuKey(env) {
  const key = env && env.ZHIPU_API_KEY;
  if (!key) {
    throw new Error('服务端未配置 ZHIPU_API_KEY（请在 EdgeOne Pages 项目的环境变量里添加）');
  }
  return key;
}

// ============================ 文案 Prompt ============================
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

// 各平台配图尺寸（CogView-3-Flash 支持的枚举尺寸）
const PLATFORM_IMAGE_SIZE = {
  xiaohongshu: '864x1152',
  gongzhonghao: '1344x768',
  douyin: '768x1344'
};

// ============================ 工具函数 ============================
function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

function parseTextJson(rawText) {
  let raw = (rawText || '').trim();
  raw = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  return JSON.parse(raw);
}

function fallbackPrompt(topic, hint) {
  return `杂志摄影质感${hint || '封面图'}，真实办公或生活场景，暖白光线，专业摄影构图，主题相关内容：${topic}。避免过多文字元素，无文字`;
}

// 把 LLM 规划的图片方案整理成 { xiaohongshu:[{prompt,size}], gongzhonghao:[...], douyin:[...] }
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

// ============================ 文案生成 ============================
function isTransientTextError(err) {
  const m = (err && err.message) || '';
  return /访问量过大|1305|rate.?limit|too many|请稍后|稍后再试|忙|overload/i.test(m);
}

async function callZhipuText(env, systemPrompt, userContent) {
  const key = getZhipuKey(env);
  const resp = await fetch(TEXT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      temperature: 0.8,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error((json && json.error && json.error.message) || `智谱文案请求失败 (${resp.status})`);
  }
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('智谱未返回有效内容');
  return content;
}

// 免费模型高峰期会返回 1305「访问量过大」，命中时短等重试
async function runTextGeneration(env, systemPrompt, userContent) {
  const maxRetries = 4;
  let lastErr;
  let sawTransient = false;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callZhipuText(env, systemPrompt, userContent);
    } catch (err) {
      lastErr = err;
      if (isTransientTextError(err) && attempt < maxRetries - 1) {
        sawTransient = true;
        await new Promise((r) => setTimeout(r, 2500 + attempt * 2500));
        continue;
      }
      break;
    }
  }
  if (sawTransient) {
    const e = new Error('AI 文案服务当前访问量过大，请过 10 秒左右再点一次');
    e.code = 'BUSY';
    throw e;
  }
  throw lastErr;
}

const generateText = (env, topic) => runTextGeneration(env, SYSTEM_PROMPT, `话题/要点：\n${topic}`);
const polishText = (env, draft) => runTextGeneration(env, POLISH_SYSTEM_PROMPT, `我的初稿：\n${draft}`);

// ============================ 生图 ============================
async function generateImage(env, prompt, size = '864x1152') {
  const key = getZhipuKey(env);
  const maxRetries = 5;
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(IMAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, size })
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error((json && json.error && json.error.message) || `智谱生图请求失败 (${resp.status})`);
      }
      const url = json.data && json.data[0] && json.data[0].url;
      if (!url) throw new Error('智谱生图未返回图片地址');
      return url;
    } catch (err) {
      lastErr = err;
      const isRateLimited = err && err.message && /上限|concurrent|rate limit/i.test(err.message);
      if (isRateLimited && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2500 + attempt * 1500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export {
  corsHeaders,
  jsonResponse,
  parseTextJson,
  buildImagePlan,
  generateText,
  polishText,
  generateImage
};
