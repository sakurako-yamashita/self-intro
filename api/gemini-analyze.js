/**
 * Vercel Serverless: POST { "text": "..." } → Gemini で構造化JSONを返す
 * 環境変数: GEMINI_API_KEY（Google AI Studio で発行）
 */
const MODEL = "gemini-2.0-flash";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "GEMINI_API_KEY がサーバーに設定されていません。Vercel の Environment Variables を確認してください。",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const text = body?.text;
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "text が空です" });
  }

  const instruction = `あなたはYouTube動画の競合分析の専門家です。ユーザーが入力した動画情報（URL・タイトル・概要欄・メモなど）から、次の4項目を日本語で簡潔に分析してください。

必ず次の4キーだけを持つJSONオブジェクト1つだけを返してください。マークダウンのコードブロックや前後の説明文は付けないでください。
{
  "targetAudience": "ターゲット層（年齢・悩み）",
  "tempoNarration": "動画のテンポ・ナレーションの特徴",
  "visualCraft": "視覚的工夫（テロップ・図解など）",
  "messageEssence": "メッセージの本質"
}

各値は200文字程度以内を目安に。情報が著しく不足している場合のみ「情報不足」と書いてください。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  let geminiRes;
  try {
    geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${instruction}\n\n--- 入力 ---\n\n${String(text).slice(0, 32000)}` }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: "Gemini への接続に失敗しました", detail: String(e.message) });
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return res.status(502).json({
      error: "Gemini API エラー",
      detail: errText.slice(0, 800),
    });
  }

  const data = await geminiRes.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!part) {
    return res.status(502).json({
      error: "Gemini から空の応答です",
      raw: JSON.stringify(data).slice(0, 400),
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(part.trim());
  } catch {
    const m = part.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        return res.status(502).json({ error: "JSON の解析に失敗しました", raw: part.slice(0, 500) });
      }
    } else {
      return res.status(502).json({ error: "JSON の解析に失敗しました", raw: part.slice(0, 500) });
    }
  }

  return res.status(200).json({
    targetAudience: parsed.targetAudience ?? "情報不足",
    tempoNarration: parsed.tempoNarration ?? "情報不足",
    visualCraft: parsed.visualCraft ?? "情報不足",
    messageEssence: parsed.messageEssence ?? "情報不足",
  });
};
