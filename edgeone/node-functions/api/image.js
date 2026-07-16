import { generateImage, jsonResponse, corsHeaders } from '../_shared.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// 单张生图：前端拿到 imagePlan 后逐张调用（每张几秒），单张失败可单独重试
export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));
  const prompt = (data.prompt || '').trim();
  const size = (data.size || '864x1152').trim();
  if (!prompt) {
    return jsonResponse({ code: -1, message: '缺少图片描述' });
  }
  try {
    const url = await generateImage(env, prompt, size);
    return jsonResponse({ code: 0, url });
  } catch (error) {
    return jsonResponse({ code: -1, message: (error && error.message) || '图片生成失败' });
  }
}
