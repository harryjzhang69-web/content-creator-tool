/**
 * zhipuImage.js
 * 智谱开放平台 CogView-3-Flash 文生图（官方长期免费，账号专属配额，非全平台共享抢名额）。
 * 复用已配置的 ZHIPU_API_KEY（跟文案生成用的是同一个 Key）。
 * 同步接口：提交后直接返回图片地址，不需要像 hy-image-v3 那样轮询任务状态。
 */

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/images/generations';
const MODEL = 'cogview-3-flash';

async function generateImage(prompt, { apiKey, size = '864x1152', maxRetries = 5 } = {}) {
  const key = apiKey || process.env.ZHIPU_API_KEY;
  if (!key) {
    throw new Error('ZHIPU_API_KEY 未配置');
  }

  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({ model: MODEL, prompt, size })
      });

      const json = await resp.json();
      if (!resp.ok) {
        const msg = (json && json.error && json.error.message) || `智谱生图请求失败 (${resp.status})`;
        throw new Error(msg);
      }

      const url = json.data && json.data[0] && json.data[0].url;
      if (!url) throw new Error('智谱生图未返回图片地址');
      return url;
    } catch (err) {
      lastErr = err;
      // 免费账号的生图并发上限较低（实测约1），命中"任务上限"这类限流错误时短等重试即可，
      // 因为这是同步接口，单张几秒就出图，很快就会释放名额
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

module.exports = { generateImage };
