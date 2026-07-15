const tcb = require('@cloudbase/node-sdk');

const app = tcb.init({ env: 'docker-test-2gda2zrj6d81ed9e' });

const SYSTEM_PROMPT = `你是一个服务于"AI/科技/产品经理"垂类内容创作者的专业新媒体编辑。你的任务是把用户输入的一个话题或几个要点，改写成三个平台的专属版本。

写作风格铁律（去AI味）：
- 禁止使用"总的来说""不难发现""值得注意的是""在当今这个XX的时代"这类AI腔总结句/开头
- 开头要有真实细节、具体场景或反常识观点，不要泛泛而谈
- 允许适度口语化插入词，比如"说实话""谁懂啊""踩过坑才知道""说个真事"
- 内容要具体、有个人经验感和信息密度，不要空洞的正确废话
- 风格是"干货复盘/踩坑分享/工具测评"体，不是"种草体"，不要用"闭眼冲""绝绝子"这类小红书种草黑话

请严格按以下JSON格式输出，不要有任何多余文字、不要用markdown代码块包裹、不要输出注释：
{
  "xiaohongshu": {
    "title": "小红书标题，20字以内，带emoji，干货/踩坑体",
    "body": "小红书正文，300-500字，emoji分段，口语化，段落之间空一行",
    "tags": ["话题标签1", "话题标签2", "话题标签3", "话题标签4"]
  },
  "gongzhonghao": {
    "title": "公众号标题，SEO友好，20字以内",
    "body": "公众号正文，800-1200字，用##作为二级小标题分段，结尾引导关注互动"
  },
  "douyin": {
    "hook": "3秒强钩子开头，一句话，要有冲突感或反常识",
    "script": "口播脚本，分段标注时间点，例如[0-5s]...[5-15s]...，全长约60秒对应150-200字"
  }
}`;

function buildImagePrompt(topic) {
  return `杂志摄影质感封面图，真实办公或生活场景，暖白光线，专业摄影构图，主题相关内容：${topic}。可以是人物专注工作的侧影搭配电脑屏幕上的代码或数据图表，画面简洁不杂乱，避免过多文字元素，竖版构图，无文字`;
}

exports.main = async (event, context) => {
  try {
    const topic = (event && event.topic) || '';
    if (!topic.trim()) {
      return { code: -1, message: '请输入话题或内容要点' };
    }

    const ai = app.ai();

    // 文案生成（三平台）
    const textModel = ai.createModel('deepseek');
    const textPromise = textModel.generateText({
      model: 'deepseek-v3.2',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `话题/要点：\n${topic}` }
      ],
      temperature: 0.8
    });

    // 配图生成（杂志摄影风封面）
    const imageModel = ai.createImageModel('hunyuan-image');
    const imagePromise = imageModel
      .generateImage({
        model: 'hunyuan-image',
        prompt: buildImagePrompt(topic),
        version: 'v1.9'
      })
      .catch((err) => ({ __error: err.message || String(err) }));

    const [textResult, imageResult] = await Promise.all([textPromise, imagePromise]);

    let parsed;
    try {
      let raw = (textResult.text || '').trim();
      raw = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '');
      parsed = JSON.parse(raw);
    } catch (e) {
      return {
        code: -2,
        message: '文案生成结果解析失败，请重试',
        raw: textResult && textResult.text
      };
    }

    let imageUrl = null;
    let imageError = null;
    if (imageResult && imageResult.__error) {
      imageError = imageResult.__error;
    } else if (imageResult && imageResult.data && imageResult.data[0]) {
      imageUrl = imageResult.data[0].url;
    }

    return {
      code: 0,
      data: {
        xiaohongshu: parsed.xiaohongshu,
        gongzhonghao: parsed.gongzhonghao,
        douyin: parsed.douyin,
        image: { url: imageUrl, error: imageError }
      }
    };
  } catch (error) {
    return { code: -1, message: (error && error.message) || '生成失败，请重试' };
  }
};
