import { Elysia } from 'elysia'
import sharp from 'sharp'
import path from 'path';
import { readFile } from 'fs/promises'

path.resolve(process.cwd(), 'fonts', 'fonts.conf');
path.resolve(process.cwd(), 'fonts', 'Sen.ttf');

const PARIS_TIMEZONE = 'Europe/Paris'
const CALENDAR_URLS = (process.env.CALENDARS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)
const eventTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: PARIS_TIMEZONE
})
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
const toParisDate = (value) => new Date(new Date(value).toLocaleString('en-US', { timeZone: PARIS_TIMEZONE }))
const getParisTime = () => toParisDate(new Date())

// Fetch sunrise/sunset times from sunrise-sunset.org API for Bordeaux
const fetchSunriseSunsetData = async () => {
  const defaultData = {
    sunrise: '07:30',
    sunset: '17:30',
    nauticalTwilightBegin: '06:30',
    nauticalTwilightEnd: '18:30',
    sunriseTime: getParisTime(),
    sunsetTime: getParisTime()
  }
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    
    const response = await fetch(
      'https://api.sunrise-sunset.org/json?lat=44.8404&lng=-0.5805&formatted=0',
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'koreader-dashboard/1.0' }
      }
    )
    const data = await response.json()
    clearTimeout(timeoutId)
    
    if (data.status === 'OK' && data.results) {
      const sunriseISO = data.results.sunrise
      const sunsetISO = data.results.sunset
      const nauticalTwilightBeginISO = data.results.nautical_twilight_begin
      const nauticalTwilightEndISO = data.results.nautical_twilight_end
      
      const sunriseTime = toParisDate(sunriseISO)
      const sunsetTime = toParisDate(sunsetISO)
      const nauticalTwilightBeginTime = toParisDate(nauticalTwilightBeginISO)
      const nauticalTwilightEndTime = toParisDate(nauticalTwilightEndISO)
      
      const formatTime = (date) => {
        return eventTimeFormatter.format(date)
      }
      
      return {
        sunrise: formatTime(sunriseTime),
        sunset: formatTime(sunsetTime),
        nauticalTwilightBegin: formatTime(nauticalTwilightBeginTime),
        nauticalTwilightEnd: formatTime(nauticalTwilightEndTime),
        sunriseTime,
        sunsetTime
      }
    }
    return defaultData
  } catch (error) {
    console.error('Sunrise/Sunset API error:', error)
    return defaultData
  }
}

// Generate the sunset-sunrise oblong SVG visualization
const generateSunriseSunsetSvg = (width, height, sunData, currentTime, icons, radius = 18) => {
  const padding = 12
  const iconSize = 24
  const fontSize = 18
  const labelY = iconSize / 2
    
  // Calculate the position of the moving dot based on current time
  const currentHours = currentTime.getHours()
  const currentMinutes = currentTime.getMinutes()
  const currentTotalMinutes = currentHours * 60 + currentMinutes
  
  // Parse sunrise and sunset times
  const [sunriseHour, sunriseMin] = sunData.sunrise.split(':').map(Number)
  const [sunsetHour, sunsetMin] = sunData.sunset.split(':').map(Number)
  const sunriseMinutes = sunriseHour * 60 + sunriseMin
  const sunsetMinutes = sunsetHour * 60 + sunsetMin
  
  // Define key points in minutes from midnight
  const noonMinutes = 12 * 60 // 720
  const dayEnd = 24 * 60 // 1440
  
  // Calculate progress around the perimeter (0 to 1)
  // Layout: sunrise (bottom-left) -> noon (top-left) -> sunset (top-right) -> midnight (bottom-right) -> back to sunrise
  let progress = 0
  
  if (currentTotalMinutes >= sunriseMinutes && currentTotalMinutes < noonMinutes) {
    // Morning: sunrise to noon (bottom-left to top-left)
    const duration = noonMinutes - sunriseMinutes
    const elapsed = currentTotalMinutes - sunriseMinutes
    progress = duration > 0 ? (elapsed / duration) * 0.25 : 0
  } else if (currentTotalMinutes >= noonMinutes && currentTotalMinutes < sunsetMinutes) {
    // Afternoon: noon to sunset (top-left to top-right)
    const duration = sunsetMinutes - noonMinutes
    const elapsed = currentTotalMinutes - noonMinutes
    progress = duration > 0 ? 0.25 + (elapsed / duration) * 0.25 : 0.25
  } else if (currentTotalMinutes >= sunsetMinutes) {
    // Evening: sunset to midnight (top-right to bottom-right)
    const duration = dayEnd - sunsetMinutes
    const elapsed = currentTotalMinutes - sunsetMinutes
    progress = duration > 0 ? 0.5 + (elapsed / duration) * 0.25 : 0.5
  } else {
    // Night: midnight to sunrise (bottom-right to bottom-left)
    const duration = sunriseMinutes
    const elapsed = currentTotalMinutes
    progress = duration > 0 ? 0.75 + (elapsed / duration) * 0.25 : 0.75
  }
  
  // Define the oblong track path (inset from the card edges)
  const trackInset = 50 // Distance from card edge to the track
  const trackRadius = 12 // Corner radius of the track
  const trackLeft = trackInset
  const trackTop = trackInset
  const trackRight = width - trackInset
  const trackBottom = height - trackInset
  const trackWidth = trackRight - trackLeft
  const trackHeight = trackBottom - trackTop
  
  // Calculate dot position on the rounded rectangle track
  // 0.0 = bottom-left corner (sunrise)
  // 0.25 = top-left corner (noon)
  // 0.5 = top-right corner (sunset)
  // 0.75 = bottom-right corner (midnight)
  
  let dotX, dotY
  
  // Calculate perimeter segments
  const straightH = trackWidth - 2 * trackRadius // horizontal straight sections
  const straightV = trackHeight - 2 * trackRadius // vertical straight sections
  const cornerArc = (Math.PI * trackRadius) / 2 // quarter circle arc length
  const totalPerimeter = 2 * straightH + 2 * straightV + 4 * cornerArc
  
  // Map progress to distance along perimeter, starting from bottom-left
  const distance = progress * totalPerimeter
  
  // Define segment lengths in order: bottom-left corner, left edge, top-left corner, top edge, top-right corner, right edge, bottom-right corner, bottom edge
  const segments = [
    { type: 'corner', length: cornerArc, cx: trackLeft + trackRadius, cy: trackBottom - trackRadius, startAngle: Math.PI / 2, dir: 1 }, // bottom-left going up
    { type: 'line', length: straightV, x1: trackLeft, y1: trackBottom - trackRadius, x2: trackLeft, y2: trackTop + trackRadius }, // left edge
    { type: 'corner', length: cornerArc, cx: trackLeft + trackRadius, cy: trackTop + trackRadius, startAngle: Math.PI, dir: 1 }, // top-left
    { type: 'line', length: straightH, x1: trackLeft + trackRadius, y1: trackTop, x2: trackRight - trackRadius, y2: trackTop }, // top edge
    { type: 'corner', length: cornerArc, cx: trackRight - trackRadius, cy: trackTop + trackRadius, startAngle: -Math.PI / 2, dir: 1 }, // top-right
    { type: 'line', length: straightV, x1: trackRight, y1: trackTop + trackRadius, x2: trackRight, y2: trackBottom - trackRadius }, // right edge
    { type: 'corner', length: cornerArc, cx: trackRight - trackRadius, cy: trackBottom - trackRadius, startAngle: 0, dir: 1 }, // bottom-right
    { type: 'line', length: straightH, x1: trackRight - trackRadius, y1: trackBottom, x2: trackLeft + trackRadius, y2: trackBottom } // bottom edge
  ]
  
  let accumulated = 0
  for (const seg of segments) {
    if (accumulated + seg.length >= distance) {
      const segProgress = (distance - accumulated) / seg.length
      if (seg.type === 'corner') {
        const angle = seg.startAngle + segProgress * (Math.PI / 2) * seg.dir
        dotX = seg.cx + trackRadius * Math.cos(angle)
        dotY = seg.cy + trackRadius * Math.sin(angle)
      } else {
        dotX = seg.x1 + segProgress * (seg.x2 - seg.x1)
        dotY = seg.y1 + segProgress * (seg.y2 - seg.y1)
      }
      break
    }
    accumulated += seg.length
  }
  
  // Fallback if calculation fails - use bottom-left corner start position on the track
  if (dotX === undefined) {
    dotX = trackLeft + trackRadius
    dotY = trackBottom
  }
  
  // Corner positions for icons and times
  const topLeftX = padding
  const topLeftY = padding
  const topRightX = width - padding - iconSize
  const topRightY = padding
  const bottomRightX = width - padding - iconSize
  const bottomRightY = height - padding - iconSize
  const bottomLeftX = padding
  const bottomLeftY = height - padding - iconSize
  
  // Create the oblong track path
  const trackPath = `M ${trackLeft + trackRadius} ${trackBottom}
    A ${trackRadius} ${trackRadius} 0 0 1 ${trackLeft} ${trackBottom - trackRadius}
    L ${trackLeft} ${trackTop + trackRadius}
    A ${trackRadius} ${trackRadius} 0 0 1 ${trackLeft + trackRadius} ${trackTop}
    L ${trackRight - trackRadius} ${trackTop}
    A ${trackRadius} ${trackRadius} 0 0 1 ${trackRight} ${trackTop + trackRadius}
    L ${trackRight} ${trackBottom - trackRadius}
    A ${trackRadius} ${trackRadius} 0 0 1 ${trackRight - trackRadius} ${trackBottom}
    Z`
  
  return `
    <!-- Monochrome background -->
    <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#f2f2f2" stroke="#c9c9c9" stroke-width="1.5"/>
    
    <!-- Oblong track path for the dot to travel on (black, thick) -->
    <path d="${trackPath}" fill="none" stroke="#111111" stroke-width="3"/>
    
    <!-- Top Left: Sun (sunrise) - label on right side -->
    <g transform="translate(${topLeftX}, ${topLeftY})">
      <image href="${icons.sun}" x="0" y="0" width="${iconSize}" height="${iconSize}" />
      <text x="${iconSize + 8}" y="${labelY}" font-family="monospace" font-size="${fontSize}" fill="#111111" text-anchor="start" dominant-baseline="middle" font-weight="700">${sunData.sunrise}</text>
    </g>
    
    <!-- Top Right: Sunset - label on left side -->
    <g transform="translate(${topRightX}, ${topRightY})">
      <image href="${icons.sunset}" x="0" y="0" width="${iconSize}" height="${iconSize}" />
      <text x="-8" y="${labelY}" font-family="monospace" font-size="${fontSize}" fill="#111111" text-anchor="end" dominant-baseline="middle" font-weight="700">${sunData.sunset}</text>
    </g>
    
    <!-- Bottom Right: Moon (nautical twilight end) - label on left side -->
    <g transform="translate(${bottomRightX}, ${bottomRightY})">
      <image href="${icons.moon}" x="0" y="0" width="${iconSize}" height="${iconSize}" />
      <text x="-8" y="${labelY}" font-family="monospace" font-size="${fontSize}" fill="#111111" text-anchor="end" dominant-baseline="middle" font-weight="700">${sunData.nauticalTwilightEnd}</text>
    </g>
    
    <!-- Bottom Left: Nautical Twilight (nautical twilight begin) - label on right side -->
    <g transform="translate(${bottomLeftX}, ${bottomLeftY})">
      <image href="${icons.sunrise}" x="0" y="0" width="${iconSize}" height="${iconSize}" />
      <text x="${iconSize + 8}" y="${labelY}" font-family="monospace" font-size="${fontSize}" fill="#111111" text-anchor="start" dominant-baseline="middle" font-weight="700">${sunData.nauticalTwilightBegin}</text>
    </g>
    
    <!-- Moving dot indicator (current time position) on the oblong track -->
    <circle cx="${dotX}" cy="${dotY}" r="8" fill="#111111" stroke="#f2f2f2" stroke-width="2"/>
  `
}

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
    if (z) {
      // UTC time (ends with Z)
      const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`
      const date = new Date(iso)
      return { date, allDay: false }
    } else {
      const year = parseInt(y, 10)
      const month = parseInt(m, 10) - 1 // JS months are 0-indexed
      const day = parseInt(d, 10)
      const hour = parseInt(hh, 10)
      const minute = parseInt(mm, 10)
      const second = parseInt(ss, 10)
      
      const date = new Date(year, month, day, hour, minute, second)
      return { date, allDay: false }
    }
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

const BUS_API_BASE_URL = 'https://data.bordeaux-metropole.fr/geojson/features/sv_horai_a?crs=epsg%3A4326&filter=%7B%0A%20%20%22rs_sv_arret_p%22%3A%20405%2C%0A%20%20%22etat%22%3A%20%22NON_REALISE%22%20%20%20%20%0A%7D&maxfeatures=3&orderby=%5B%22hor_theo%22%5D'
let busApiKeyMissingLogged = false
let bikeApiKeyMissingLogged = false

const fetchBusDepartures = async () => {
  const apiKey = process.env.BORDEAUX_API_KEY
  if (!apiKey) {
    if (!busApiKeyMissingLogged) {
      console.warn('Missing BORDEAUX_API_KEY; showing placeholder bus data.')
      busApiKeyMissingLogged = true
    }
    return []
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(`${BUS_API_BASE_URL}&key=${encodeURIComponent(apiKey)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'koreader-dashboard/1.0' }
    })
    const data = await response.json()
    const now = Date.now()

    const departures = (data?.features || [])
      .map((feature) => {
        const horTheo = feature?.properties?.hor_theo
        if (!horTheo) return null

        const horDate = new Date(horTheo)
        if (Number.isNaN(horDate.getTime())) return null

        const flooredMillis = Math.floor(horDate.getTime() / 60000) * 60000
        const minutesUntil = Math.max(0, Math.floor((flooredMillis - now) / 60000))

        return {
          minutesUntil,
          timestamp: flooredMillis
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp)

    return departures.slice(0, 3)
  } catch (error) {
    console.error('Bus API error:', error)
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

const fetchBikeAvailability = async () => {
  const parisNow = getParisTime()
  const after6pm = parisNow.getHours() >= 18
  const primaryName = after6pm ? 'Lycee Bremontier' : 'Nansouty'
  const secondaryName = after6pm ? 'Victoire' : 'Doyen Brus'
  const baseResult = {
    primary: { name: primaryName, value: null },
    secondary: { name: secondaryName, value: null }
  }

  const apiKey = process.env.BORDEAUX_API_KEY
  if (!apiKey) {
    if (!bikeApiKeyMissingLogged) {
      console.warn('Missing BORDEAUX_API_KEY; showing placeholder bike data.')
      bikeApiKeyMissingLogged = true
    }
    return baseResult
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const params = new URLSearchParams({
      crs: 'epsg:4326',
      filter: JSON.stringify({ $or: [{ Nom: primaryName }, { Nom: secondaryName }] }),
      attributes: JSON.stringify(['NBPLACES', 'NBVELOS', 'NOM']),
      maxfeatures: '2',
      key: apiKey
    })
    const url = `https://data.bordeaux-metropole.fr/geojson/features/ci_vcub_p?${params.toString()}`

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'koreader-dashboard/1.0' }
    })
    const data = await response.json()

    const toIntOrNull = (val) => {
      if (val === null || val === undefined) return null
      const num = Number.parseInt(val, 10)
      return Number.isFinite(num) ? num : null
    }

    const stations = (data?.features || []).map((feature) => {
      const props = feature?.properties || {}
      const name = (props.nom || props.NOM || props.Nom || '').trim()
      const nbplacesRaw = props.nbplaces ?? props.NBPLACES
      const nbvelosRaw = props.nbvelos ?? props.NBVELOS
      const nbplaces = toIntOrNull(nbplacesRaw)
      const nbvelos = toIntOrNull(nbvelosRaw)
      return { name, nbplaces, nbvelos }
    })

    const findStation = (targetName) => {
      const wanted = targetName.toLowerCase()
      return stations.find((s) => s.name.toLowerCase() === wanted)
    }

    const primaryStation = findStation(primaryName)
    const secondaryStation = findStation(secondaryName)

    return {
      primary: { name: primaryName, value: primaryStation?.nbvelos ?? null },
      secondary: { name: secondaryName, value: secondaryStation?.nbplaces ?? null }
    }
  } catch (error) {
    console.error('Bike API error:', error)
    return baseResult
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function renderTimePng () {
  const parisTime = getParisTime()
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

  // Fetch sunrise/sunset data for the sun position visualization
  const sunData = await fetchSunriseSunsetData()
  
  // Fetch sun cycle icons from Iconify
  const sunCycleIconUrls = {
    sun: 'https://api.iconify.design/ph:sun-bold.svg',
    sunset: 'https://api.iconify.design/ph:sun-horizon-bold.svg',
    moon: 'https://api.iconify.design/ph:moon-bold.svg',
    sunrise: 'https://api.iconify.design/ph:sun-horizon-bold.svg',
  }
  const sunCycleIcons = { sun: '', sunset: '', moon: '', sunrise: '', nauticalTwilight: '' }
  await Promise.all(Object.entries(sunCycleIconUrls).map(async ([key, url]) => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'koreader-dashboard/1.0' }
      })
      const svgContent = await response.text()
      sunCycleIcons[key] = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`
      clearTimeout(timeoutId)
    } catch (error) {
      console.error(`Sun cycle icon error (${key}):`, error)
    }
  }))
  
  // Load art2 image (art1 is replaced by sunrise/sunset visualization)
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

  const fetchedBusItems = await fetchBusDepartures()
  const busMinutes = fetchedBusItems.length
    ? fetchedBusItems.slice(0, 3).map((item) => item.minutesUntil)
    : []
  const busLineLabel = busMinutes.length ? `${busMinutes.join(' · ')}` : '—'

  const bikeAvailability = await fetchBikeAvailability()
  const initials = (name) => name.split(/\s+/).filter(Boolean).map((part) => part[0].toUpperCase()).join('').slice(0, 2)
  const bikeLineLabel = `${initials(bikeAvailability.primary.name)} ${bikeAvailability.primary.value ?? '—'} · ${initials(bikeAvailability.secondary.name)} ${bikeAvailability.secondary.value ?? '—'}`

  const busItems = [
    { label: busLineLabel, iconKey: 'bus' },
    { label: bikeLineLabel, iconKey: 'bike' }
  ]

  // Bus/bike icons
  const busIconUrls = {
    bus: 'https://api.iconify.design/ph:bus-bold.svg',
    bike: 'https://api.iconify.design/ph:bicycle-bold.svg'
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

          <!-- Sunrise/Sunset visualization (replaces art1) -->
          <g transform="translate(${leftX}, ${leftY + timeCardHeight + weatherCardHeight + gutter * 2})">
            ${generateSunriseSunsetSvg(leftWidth, leftArtCardHeight, sunData, parisTime, sunCycleIcons, radius)}
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
                <text x="26" y="0" class="pixel-small" font-size="18" fill="${fg}" dominant-baseline="middle">// ${item.label}</text>
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
