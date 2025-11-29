import { Elysia } from 'elysia'
import sharp from 'sharp'

export async function renderTimePng () {
  // Use local time (no API)
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const timeText = `${hh}:${mm}`
  
  // Fetch current temperature and weather code from Open-Meteo API (Bordeaux, France coordinates)
  let temperature = 'ERR'
  let weatherCode = null
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // Increased timeout to 10 seconds
    
    const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=44.8378&longitude=-0.5792&current_weather=true&timezone=Europe%2FParis', { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'koreader-dashboard/1.0'
      }
    })
    const data = await response.json()
    if (data.current_weather) {
      const temp = Math.round(data.current_weather.temperature)
      temperature = `${temp}°C`
      weatherCode = data.current_weather.weathercode
    }
    clearTimeout(timeoutId)
  } catch (error) {
    console.error('Weather API error:', error)
  }

  // Select weather icon based on weather code and fetch as data URL
  let weatherIconDataUrl = ''
  if (weatherCode !== null) {
    let iconUrl = 'https://api.iconify.design/ph:sun-bold.svg'
    if (weatherCode === 0) {
      iconUrl = 'https://api.iconify.design/ph:sun-bold.svg'
    } else if ([1, 2, 3].includes(weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-sun-bold.svg'
    } else if ([45, 48].includes(weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-fog-bold.svg'
    } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-rain-bold.svg'
    } else if ([56, 57, 66, 67].includes(weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-drizzle-bold.svg'
    } else if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-snow-bold.svg'
    } else if ([95, 96, 99].includes(weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-lightning-bold.svg'
    }
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      
      const response = await fetch(iconUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'koreader-dashboard/1.0'
        }
      })
      const svgContent = await response.text()
      weatherIconDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`
      clearTimeout(timeoutId)
    } catch (error) {
      console.error('Icon API error:', error)
    }
  }

  // 160:115 ratio multiplied by 4 for good resolution
  const width = 640
  const height = 460
  const col1Width = Math.floor(width * 0.45)
  const col2Width = width - col1Width
  const col1Height = Math.floor(height / 3)
  const col2Height = height - col1Height

  // Fetch fonts for Vercel server rendering - embed as base64 data
  let robotoMonoDataUrl = ''
  let interDataUrl = ''
  try {
    // Fetch Roboto Mono font directly from Google Fonts
    const robotoResponse = await fetch('https://fonts.gstatic.com/s/robotomono/v22/LRIjDQ7iM2JL0W_79Q8aFXeJQw.woff2', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sharp/FontLoader)' }
    })
    const robotoBuffer = await robotoResponse.arrayBuffer()
    const robotoBase64 = Buffer.from(robotoBuffer).toString('base64')
    robotoMonoDataUrl = `data:font/woff2;base64,${robotoBase64}`
    
    // Fetch Inter font directly from Google Fonts
    const interResponse = await fetch('https://fonts.gstatic.com/s/inter/v14/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sharp/FontLoader)' }
    })
    const interBuffer = await interResponse.arrayBuffer()
    const interBase64 = Buffer.from(interBuffer).toString('base64')
    interDataUrl = `data:font/woff2;base64,${interBase64}`
  } catch (error) {
    console.error('Font fetch error:', error)
    // Fallback to system fonts if font fetching fails
  }

  // Grayscale colors for e-ink display
  const bg = '#ffffff' // White background
  const fg = '#000000' // Black text
  const accent = '#808080' // Gray accent

  const svg = `
    <svg width="${height}" height="${width}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .time-text { font-family: ${robotoMonoDataUrl ? `'Roboto Mono', ` : ''}monospace; font-weight: 700; }
        .weather-text { font-family: ${interDataUrl ? `'Inter', ` : ''}sans-serif; font-weight: 600; }
        .location-text { font-family: ${interDataUrl ? `'Inter', ` : ''}sans-serif; font-weight: 700; }
      </style>
      
      <!-- Background -->
      <rect width="100%" height="100%" fill="${bg}"/>
      
      <!-- Rotate entire content 90 degrees counter-clockwise -->
      <g transform="translate(0, ${width}) rotate(-90)">
        <!-- Column 1: Time and Weather (top 1/3) -->
        <g>
          <!-- Col1 background -->
          <rect x="0" y="0" width="${col1Width}" height="${col1Height}" fill="#f0f0f0"/>
          
          <!-- Time -->
          <text x="40" y="60" class="time-text" font-size="48" fill="${fg}">${timeText}</text>
          
          <!-- Weather section -->
          <image href="${weatherIconDataUrl}" x="${col1Width - 80}" y="0" width="60" height="60" />
          
          <!-- Temperature and Location -->
          <text x="40" y="110" class="weather-text" font-size="24" fill="${fg}">${temperature} • Bordeaux, France</text>
          
          <!-- Accent line -->
          <rect x="0" y="${col1Height - 4}" width="${col1Width}" height="4" fill="${accent}"/>
        </g>
        
        <!-- Column 2: Empty black square (bottom 2/3) -->
        <g>
          <!-- Col2 background -->
          <rect x="${col1Width}" y="0" width="${col2Width}" height="${height}" fill="#000000"/>
          
          <!-- Centered empty square indication -->
          <text x="${col1Width + col2Width / 2}" y="${height / 2}" class="weather-text" font-size="20" fill="#ffffff" text-anchor="middle" dominant-baseline="central">
            Empty section
          </text>
        </g>
        
        <!-- Column separator -->
        <line x1="${col1Width}" y1="0" x2="${col1Width}" y2="${height}" stroke="#000000" stroke-width="2"/>
      </g>
    </svg>`

  return await sharp(Buffer.from(svg)).png().toBuffer()
}

const app = new Elysia()

app.get('/dashboard.png', async () => {
  const buffer = await renderTimePng()
  return new Response(buffer, { headers: { 'Content-Type': 'image/png' } })
})

export default app
