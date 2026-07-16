import { polishText, parseTextJson, buildImagePlan, jsonResponse, corsHeaders } from '../_shared.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// 入口B「帮我打磨」：给初稿 → 网感体检报告 + 三平台适配 + 配图方案
export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));
  const draft = (data.draft || '').trim();
  if (!draft) {
    return jsonResponse({ code: -1, message: '请粘贴你的初稿内容' });
  }
  if (draft.length < 15) {
    return jsonResponse({ code: -1, message: '初稿太短了，至少写 15 个字再打磨吧' });
  }

  let rawText;
  try {
    rawText = await polishText(env, draft);
  } catch (reason) {
    return jsonResponse({
      code: -1,
      message: (reason && reason.message) || '打磨失败，请重试'
    });
  }

  let parsed;
  try {
    parsed = parseTextJson(rawText);
  } catch (e) {
    return jsonResponse({ code: -2, message: '打磨结果解析失败，请重试' });
  }

  const imagePlan = buildImagePlan(parsed, draft.slice(0, 40));

  return jsonResponse({
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
}
