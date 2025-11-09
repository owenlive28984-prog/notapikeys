export default async function handler(req, res) {
  const response = await fetch("https://api.example.com/data", {
    headers: {
      Authorization: `Bearer ${process.env.API_KEY}`,
    },
  });

  const data = await response.json();
  res.status(200).json(data);
}
