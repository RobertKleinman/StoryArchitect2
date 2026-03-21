import "dotenv/config";

async function main() {
  const key = process.env.ANTHROPIC_API_KEY!;
  console.log("key exists:", !!key);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      temperature: 0.3,
      system: "You are a test assistant.",
      messages: [{ role: "user", content: "Say hello in 5 words" }],
    }),
  });
  const data = await res.json() as any;
  console.log("status:", res.status);
  if (data.error) console.log("error:", JSON.stringify(data.error));
  else console.log("text:", data.content?.[0]?.text?.slice(0, 200));
}

main().catch(console.error);
