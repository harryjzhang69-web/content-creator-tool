import { generateText, parseTextJson, buildImagePlan, jsonResponse, corsHeaders } from '../_shared.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// 入口A「从零创作」：给话题/要点 → 三平台文案 + 配图方案（不生成图，图走 /api/image 逐张异步拉）
export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));
  const topic = (data.topic || '').trim();
  if (!topic) {
    return jsonResponse({ code: -1, message: '请输入话题或内容要点' });
  }

  let rawText;
  try {
    rawText = await generateText(env, topic);
  } catch (reason) {
    return jsonResponse({
      code: reason && reason.code === 'BUSY' ? -1 : -1,
      message: (reason && reason.message) || '文案生成失败，请重试'
    });
  }

  let parsed;
  try {
    parsed = parseTextJson(rawText);
  } catch (e) {
    return jsonResponse({ code: -2, message: '文案生成结果解析失败，请重试' });
  }

  const imagePlan = buildImagePlan(parsed, topic);

  return jsonResponse({
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
}
