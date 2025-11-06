export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()
  const { prompt } = req.body
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt || "hi" }]
    })
  })
  const data = await response.json()
  res.status(200).json(data)
}
