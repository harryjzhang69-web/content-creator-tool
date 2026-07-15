/**
 * buddyCloudImage.js
 * 复用 CodeBuddy 内置多模态生成代理（腾讯混元生图）来生成封面图。
 * 不需要额外申请任何密钥，token 由平台会话预先提供并写入环境变量 BUDDY_CLOUD_TOKEN。
 */
const crypto = require('crypto');

const ENDPOINT = 'https://copilot.tencent.com/agenttool/v1/tcproxy';
const REGION = 'ap-guangzhou';
const SIGNING_KEY = 'codebuddy';

const IMAGE_PROVIDER = 'hy-image-v3';
const IMAGE_SERVICE = 'hunyuan';
const IMAGE_VERSION = '2023-09-01';
const SUBMIT_ACTION = 'SubmitHunyuanImageJob';
const QUERY_ACTION = 'QueryHunyuanImageJob';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function signRequest({ secretId, secretKey, service, action, version, region, host, payload }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const hashedPayload = sha256Hex(payload);

  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');

  const secretDate = hmacSha256('TC3' + secretKey, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Region': region,
    'X-TC-Timestamp': String(timestamp)
  };
}

async function callApi({ provider, service, version, action, body, token }) {
  const secretId = `${provider}.${token}`;
  const secretKey = SIGNING_KEY;
  const host = new URL(ENDPOINT).hostname;
  const payload = JSON.stringify(body);

  const headers = signRequest({ secretId, secretKey, service, action, version, region: REGION, host, payload });

  const resp = await fetch(ENDPOINT, { method: 'POST', headers, body: payload });
  const result = await resp.json();

  if (result && result.error) {
    // 代理层直接返回的错误（如并发限流），不走 Response 包裹格式
    throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
  }

  if (result && result.Response) {
    const inner = result.Response;
    if (inner.Error) {
      throw new Error(inner.Error.Message || '生成请求失败');
    }
    return inner;
  }
  return result;
}

function extractResultUrl(result) {
  const fields = ['ResultUrl', 'ResultVideoUrl', 'ResultImage', 'ResultImageUrl', 'ModelUrl', 'ResultModelUrl'];
  for (const f of fields) {
    if (result[f]) {
      const val = result[f];
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return null;
}

async function generateCoverImage(prompt, { token, maxPollTime = 90000, pollInterval = 4000, maxRetries = 6 } = {}) {
  const authToken = token || process.env.BUDDY_CLOUD_TOKEN;
  if (!authToken) {
    throw new Error('BUDDY_CLOUD_TOKEN 未配置');
  }

  // "concurrent slot limit" 是平台全局共享的并发上限（不止我方请求，其他用户同时生图也会占用名额），
  // 所以这里要更有耐心地重试：次数更多、间隔更长，而不是快速失败。
  let submitResp;
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      submitResp = await callApi({
        provider: IMAGE_PROVIDER,
        service: IMAGE_SERVICE,
        version: IMAGE_VERSION,
        action: SUBMIT_ACTION,
        body: { Prompt: prompt },
        token: authToken
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const isConcurrency = err && err.message && err.message.includes('concurrent slot limit');
      if (isConcurrency && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000 + attempt * 4000));
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;

  const jobId = submitResp.JobId;
  if (!jobId) {
    const url = extractResultUrl(submitResp);
    if (url) return url;
    throw new Error('未获取到生成任务ID');
  }

  const start = Date.now();
  while (Date.now() - start < maxPollTime) {
    const result = await callApi({
      provider: IMAGE_PROVIDER,
      service: IMAGE_SERVICE,
      version: IMAGE_VERSION,
      action: QUERY_ACTION,
      body: { JobId: jobId },
      token: authToken
    });

    const statusCode = result.JobStatusCode !== undefined ? Number(result.JobStatusCode) : null;
    const status = result.Status;

    if (status === 'DONE' || statusCode === 5) {
      const url = extractResultUrl(result);
      if (!url) throw new Error('生成完成但未返回图片地址');
      return url;
    }
    if (status === 'FAIL' || statusCode === 4) {
      throw new Error(result.ErrorMessage || result.JobErrorMsg || '图片生成失败');
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }
  throw new Error('图片生成超时');
}

/**
 * 批量生成图片，内部用简单的并发池控制（默认并发2，匹配平台侧限流上限）。
 * 单张失败不影响其他图片，逐张返回 {url, error}。
 */
async function generateImagesBatch(prompts, { concurrency = 2, ...restOpts } = {}) {
  const results = new Array(prompts.length);
  let cursor = 0;

  async function worker() {
    while (cursor < prompts.length) {
      const i = cursor++;
      try {
        const url = await generateCoverImage(prompts[i], restOpts);
        results[i] = { url, error: null };
      } catch (err) {
        results[i] = { url: null, error: (err && err.message) || String(err) };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, prompts.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = { generateCoverImage, generateImagesBatch };
