import { Elysia } from 'elysia'
import sharp from 'sharp'
import path from 'path';
import { readFile } from 'fs/promises'

path.resolve(process.cwd(), 'fonts', 'fonts.conf');
path.resolve(process.cwd(), 'fonts', 'Sen.ttf');

const CALENDAR_URLS = (process.env.CALENDARS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)
const eventTimeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })
const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()

const normalizeTitle = (title) => {
  const safe = title || 'Event'
  const replaced = safe.replace(/Conf\. De\. Méth\./gi, 'TD')
  return replaced.length > 25 ? replaced.slice(0, 25) : replaced
}

const formatTimeLabel = (date) => eventTimeFormatter.format(date).replace(':', 'h')
const formatWeekdayLong = (date) => cap(date.toLocaleDateString('fr-FR', { weekday: 'long' }))
const formatWeekdayShort = (date) => cap(date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''))
const formatMonthShort = (date) => cap(date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''))

const loadArtImage = async (baseName) => {
  const exts = ['png', 'jpg', 'jpeg', 'webp']
  for (const ext of exts) {
    try {
      const data = await readFile(path.join(process.cwd(), 'images', `${baseName}.${ext}`))
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${data.toString('base64')}`
    } catch (_) {
      // try next extension
    }
  }
  return ''
}

const unfoldIcsLines = (icsText) => {
  const lines = icsText.replace(/\r\n/g, '\n').split('\n')
  const unfolded = []
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith(' ') || line.startsWith('\t')) {
      unfolded[unfolded.length - 1] += line.slice(1)
    } else {
      unfolded.push(line)
    }
  }
  return unfolded
}

const parseIcsDate = (value) => {
  if (!value) return null

  // All-day date (YYYYMMDD)
  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4)
    const month = value.slice(4, 6)
    const day = value.slice(6, 8)
    const date = new Date(`${year}-${month}-${day}T00:00:00`)
    return { date, allDay: true }
  }

  // Date-time (YYYYMMDDTHHmm[ss], optional Z)
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (match) {
    const [, y, m, d, hh, mm, ss = '00', z] = match
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${z ? 'Z' : ''}`
    const date = new Date(iso)
    return { date, allDay: false }
  }

  return null
}

const parseIcsEvents = (icsText) => {
  const lines = unfoldIcsLines(icsText)
  const events = []
  let current = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (current?.start) events.push(current)
      current = null
      continue
    }
    if (!current) continue

    const [rawKey, ...valueParts] = line.split(':')
    const value = valueParts.join(':')
    const key = rawKey.split(';')[0]

    if (key === 'SUMMARY') current.summary = value?.trim() || 'Event'
    if (key === 'DTSTART') {
      const parsed = parseIcsDate(value)
      if (parsed) {
        current.start = parsed.date
        current.allDay = parsed.allDay
      }
    }
    if (key === 'DTEND') {
      const parsed = parseIcsDate(value)
      if (parsed) current.end = parsed.date
    }
  }

  return events
}

const fetchUpcomingCalendarEvents = async () => {
  if (CALENDAR_URLS.length === 0) return []

  const now = new Date()

  const eventsByCalendar = await Promise.all(CALENDAR_URLS.map(async (calendarUrl) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(calendarUrl, { 
        signal: controller.signal,
        headers: { 'User-Agent': 'koreader-dashboard/1.0' }
      })
      const icsText = await response.text()
      const events = parseIcsEvents(icsText)
      return events
    } catch (error) {
      console.error('ICS fetch error:', error)
      return []
    } finally {
      clearTimeout(timeoutId)
    }
  }))

  const combined = eventsByCalendar.flat()
    .map((event) => {
      const eventEndRaw = event.end || event.start
      const eventEnd = event.allDay && event.end
        ? new Date(eventEndRaw.getTime() - 1) // DTEND is exclusive for all-day events
        : eventEndRaw
      return { ...event, eventEnd }
    })
    .filter((event) => event.eventEnd >= now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  return combined.slice(0, 3).map((event) => {
    const timeLabel = event.allDay
      ? `${formatWeekdayLong(event.start)} (All day)`
      : `${formatWeekdayLong(event.start)} ${formatTimeLabel(event.start)}`
    return {
      title: normalizeTitle(event.summary),
      timeLabel
    }
  })
}

export async function renderTimePng () {
  const now = new Date()
  const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  console.log('Paris time:', parisTime.toString())
  const hh = String(parisTime.getHours()).padStart(2, '0')
  const mm = String(parisTime.getMinutes()).padStart(2, '0')
  const dateBelowClock = `${formatWeekdayShort(parisTime)} ${String(parisTime.getDate()).padStart(2, '0')} ${formatMonthShort(parisTime)}`
  const timeText = `${hh}:${mm}`
  
  // Fetch current temperature and weather code from Open-Meteo API (Bordeaux, France coordinates)
  let weatherData = {
    temperature: 'ERR',
    weatherCode: null,
    precipitationSum: null,
    precipitationProbability: null
  }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // Increased timeout to 10 seconds
    
    const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=44.8404&longitude=-0.5805&daily=weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_mean&timezone=Europe%2FBerlin&forecast_days=1', { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'koreader-dashboard/1.0'
      }
    })
    const data = await response.json()
    if (data.daily) {
      weatherData.temperature = `${Math.round(data.daily.temperature_2m_mean[0])}°C`
      weatherData.weatherCode = data.daily.weather_code[0]
      weatherData.precipitationSum = data.daily.precipitation_sum[0]
      weatherData.precipitationProbability = data.daily.precipitation_probability_max[0]
    }
    clearTimeout(timeoutId)
  } catch (error) {
    console.error('Weather API error:', error)
  }

  // Load art images
  const art1DataUrl = await loadArtImage('art1')
  const art2DataUrl = await loadArtImage('art2')

  // Select weather icon based on weather code and fetch as data URL
  let weatherIconDataUrl = ''
  if (weatherData.weatherCode !== null) {
    let iconUrl = 'https://api.iconify.design/ph:sun-bold.svg'
    if (weatherData.weatherCode === 0) {
      iconUrl = 'https://api.iconify.design/ph:sun-bold.svg'
    } else if ([1, 2, 3].includes(weatherData.weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-sun-bold.svg'
    } else if ([45, 48].includes(weatherData.weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-fog-bold.svg'
    } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherData.weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-rain-bold.svg'
    } else if ([56, 57, 66, 67].includes(weatherData.weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-drizzle-bold.svg'
    } else if ([71, 73, 75, 77, 85, 86].includes(weatherData.weatherCode)) {
      iconUrl = 'https://api.iconify.design/ph:cloud-snow-bold.svg'
    } else if ([95, 96, 99].includes(weatherData.weatherCode)) {
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

  // Calendar icon
  let calendarIconDataUrl = ''
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const response = await fetch('https://api.iconify.design/ph:calendar-blank-bold.svg', { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'koreader-dashboard/1.0'
      }
    })
    const svgContent = await response.text()
    calendarIconDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`
    clearTimeout(timeoutId)
  } catch (error) {
    console.error('Calendar icon error:', error)
  }

  // 160:115 ratio multiplied by 4 for good resolution
  const width = 640
  const height = 460

  // Agenda from ICS calendars
  const agendaItems = await fetchUpcomingCalendarEvents()
  const agendaDisplayItems = agendaItems.length
    ? agendaItems
    : [{ title: 'NO UPCOMING EVENTS', timeLabel: '—' }]

  const busItems = [
    { route: '9', eta: '3 MIN', iconKey: 'bus' },
    { route: 'B', eta: '8 MIN', iconKey: 'tram' }
  ]

  // Bus/tram icons
  const busIconUrls = {
    bus: 'https://api.iconify.design/ph:bus-bold.svg',
    tram: 'https://api.iconify.design/ph:tram-bold.svg'
  }
  const busIconData = {}
  const busIconKeys = [...new Set(busItems.map((item) => item.iconKey))]
  await Promise.all(busIconKeys.map(async (key) => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(busIconUrls[key], { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'koreader-dashboard/1.0'
        }
      })
      const svgContent = await response.text()
      busIconData[key] = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`
      clearTimeout(timeoutId)
    } catch (error) {
      console.error('Bus icon error:', error)
      busIconData[key] = ''
    }
  }))

  // Grayscale palette for e-ink style
  const bg = '#ffffff'
  const fg = '#111111'
  const stroke = '#c9c9c9'
  const cardFill = '#f2f2f2'
  const radius = 18

  // Layout constants (bento spacing)
  const margin = 14
  const gutter = 14
  const padding = 16
  const leftWidth = 280
  const leftX = margin
  const leftY = margin
  const leftHeight = height - margin * 2
  const rightX = leftX + leftWidth + gutter
  const rightWidth = width - margin - rightX
  const rightHeight = leftHeight

  // Left column card sizes
  const timeCardHeight = 170
  const weatherCardHeight = 80
  const leftArtCardHeight = leftHeight - timeCardHeight - weatherCardHeight - gutter * 2

  // Right column card sizes
  const agendaCardHeight = 170
  const busCardHeight = 70
  const rightArtCardHeight = rightHeight - agendaCardHeight - busCardHeight - gutter * 2

  const agendaHeaderHeight = 5
  const agendaHeaderGap = 0
  const agendaEntrySpacing = 50
  const agendaLineHeight = 48
  const agendaLineOffsetTop = 10
  const agendaContentHeight = agendaDisplayItems.length
    ? agendaLineHeight + (agendaEntrySpacing * (agendaDisplayItems.length - 1))
    : 0
  const agendaContentStartY = leftY + (agendaCardHeight - agendaContentHeight) / 2 + agendaLineOffsetTop

  const busLineSpacing = 26
  const busIconOffsetTop = 11
  const busContentHeight = busItems.length
    ? 20 + (busLineSpacing * (busItems.length - 1))
    : 0
  const artCardY = leftY + agendaCardHeight + gutter
  const busCardY = artCardY + rightArtCardHeight + gutter
  const busContentStartY = busCardY + (busCardHeight - busContentHeight) / 2 + busIconOffsetTop

  // Text positions
  const timeX = leftX + leftWidth / 2
  const timeY = leftY + timeCardHeight / 2
  const weatherIconSize = 30
  const weatherGap = 12

  const svg = `
    <svg width="${height}" height="${width}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .pixel { font-family: "Pixelify Sans", "Press Start 2P", "Courier New", monospace; font-weight: 700; letter-spacing: 0.5px; }
        .pixel-small { font-family: "Pixelify Sans", "Press Start 2P", "Courier New", monospace; font-weight: 600; letter-spacing: 0.4px; }
      </style>
      <defs>
        <clipPath id="clip-art1" clipPathUnits="objectBoundingBox">
          <rect x="0" y="0" width="1" height="1" rx="${radius / leftWidth}" ry="${radius / leftArtCardHeight}" />
        </clipPath>
        <clipPath id="clip-art2" clipPathUnits="objectBoundingBox">
          <rect x="0" y="0" width="1" height="1" rx="${radius / rightWidth}" ry="${radius / rightArtCardHeight}" />
        </clipPath>
      </defs>
      
      <!-- Background -->
      <rect width="100%" height="100%" fill="${bg}"/>
      
      <!-- Rotate entire content 90 degrees counter-clockwise -->
      <g transform="translate(0, ${width}) rotate(-90)">
        <!-- Left column cards -->
        <g>
          <!-- Time card -->
          <rect x="${leftX}" y="${leftY}" width="${leftWidth}" height="${timeCardHeight}" rx="${radius}" ry="${radius}" fill="${cardFill}" stroke="${stroke}" stroke-width="1.5" shape-rendering="crispEdges"/>
          <text x="${timeX}" y="${leftY + timeCardHeight / 2 - 10}" class="pixel" font-size="72" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${timeText}</text>
          <text x="${timeX}" y="${leftY + timeCardHeight / 2 + 40}" class="pixel-small" font-size="24" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${dateBelowClock}</text>
          
          <!-- Weather card -->
          <g transform="translate(${leftX}, ${leftY + timeCardHeight + gutter})">
            <rect x="0" y="0" width="${leftWidth}" height="${weatherCardHeight}" rx="${radius}" ry="${radius}" fill="${cardFill}" stroke="${stroke}" stroke-width="1.5" shape-rendering="crispEdges"/>
            <g transform="translate(${padding}, ${weatherCardHeight / 2})">
              <image href="${weatherIconDataUrl}" x="0" y="-${weatherIconSize / 2}" width="${weatherIconSize}" height="${weatherIconSize}" />
              <text x="${weatherIconSize + weatherGap}" y="-6" class="pixel-small" font-size="19" fill="${fg}" dominant-baseline="middle">TEMP // ${weatherData.temperature}</text>
              <text x="${weatherIconSize + weatherGap}" y="16" class="pixel-small" font-size="17" fill="${fg}">PRECIP // ${weatherData.precipitationProbability}% / ${weatherData.precipitationSum}mm</text>
            </g>
          </g>

          <!-- Art filler left -->
          <g transform="translate(${leftX}, ${leftY + timeCardHeight + weatherCardHeight + gutter * 2})">
            <rect x="0" y="0" width="${leftWidth}" height="${leftArtCardHeight}" rx="${radius}" ry="${radius}" fill="${cardFill}" stroke="${stroke}" stroke-width="1.5" shape-rendering="crispEdges"/>
            ${art1DataUrl ? `<g clip-path="url(#clip-art1)"><image href="${art1DataUrl}" x="0" y="0" width="${leftWidth}" height="${leftArtCardHeight}" preserveAspectRatio="xMidYMid slice" /></g>` : `<text x="${padding}" y="${leftArtCardHeight / 2}" class="pixel-small" font-size="16" fill="${fg}" dominant-baseline="middle">ART 01 //</text>`}
          </g>
        </g>

        <!-- Right column cards -->
        <g>
          <!-- Agenda card -->
          <rect x="${rightX}" y="${leftY}" width="${rightWidth}" height="${agendaCardHeight}" rx="${radius}" ry="${radius}" fill="${cardFill}" stroke="${stroke}" stroke-width="1.5" shape-rendering="crispEdges"/>
          ${agendaDisplayItems.map((item, idx) => {
            const groupY = agendaContentStartY + agendaHeaderHeight + agendaHeaderGap + idx * agendaEntrySpacing
            return `<g transform="translate(${rightX + padding}, ${groupY})">
              <image href="${calendarIconDataUrl}" x="0" y="-10" width="18" height="18" />
              <text x="24" y="0" class="pixel-small" font-size="19" fill="${fg}" dominant-baseline="middle">${item.timeLabel}</text>
              <text x="0" y="26" class="pixel-small" font-size="17" fill="${fg}">${item.title}</text>
            </g>`
          }).join('')}

          <!-- Art filler right -->
          <g transform="translate(${rightX}, ${artCardY})">
            <rect x="0" y="0" width="${rightWidth}" height="${rightArtCardHeight}" rx="${radius}" ry="${radius}" fill="${cardFill}" stroke="${stroke}" stroke-width="1.5" shape-rendering="crispEdges"/>
            ${art2DataUrl ? `<g clip-path="url(#clip-art2)"><image href="${art2DataUrl}" x="0" y="0" width="${rightWidth}" height="${rightArtCardHeight}" preserveAspectRatio="xMidYMid slice" /></g>` : `<text x="${padding}" y="${rightArtCardHeight / 2}" class="pixel-small" font-size="16" fill="${fg}" dominant-baseline="middle">ART 02 //</text>`}
          </g>

          <!-- Bus card -->
          <g transform="translate(${rightX}, ${busCardY})">
            <rect x="0" y="0" width="${rightWidth}" height="${busCardHeight}" rx="${radius}" ry="${radius}" fill="${cardFill}" stroke="${stroke}" stroke-width="1.5" shape-rendering="crispEdges"/>
            ${busItems.map((item, idx) => {
              const lineY = (busContentStartY - busCardY) + idx * busLineSpacing
              const icon = busIconData[item.iconKey] || ''
              return `<g transform="translate(${padding}, ${lineY})">
                <image href="${icon}" x="0" y="-11" width="20" height="20" />
                <text x="26" y="0" class="pixel-small" font-size="18" fill="${fg}" dominant-baseline="middle">${item.route} // ${item.eta}</text>
              </g>`
            }).join('')}
          </g>
        </g>
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
