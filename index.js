import { Elysia } from 'elysia'
import sharp from 'sharp'

async function renderTimePng () {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const text = `${hh}:${mm}:${ss}`

  const width = 400
  const height = 120
  const fontSize = 64
  const bg = '#141414'
  const fg = '#eeeeee'

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${bg}"/>
      <text x="50%" y="50%" font-family="monospace" font-size="${fontSize}" fill="${fg}"
            dominant-baseline="central" text-anchor="middle">${text}</text>
    </svg>`

  return await sharp(Buffer.from(svg)).png().toBuffer()
}

const app = new Elysia()

app.get('/dashboard.png', async () => {
  const buffer = await renderTimePng()
  return new Response(buffer, { headers: { 'Content-Type': 'image/png' } })
})

console.log('Listening on http://localhost:1312/dashboard.png (PNG with HH:SS)')

export default app
