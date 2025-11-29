import { renderTimePng } from './index.js'

async function testImage() {
  try {
    const buffer = await renderTimePng()
    import('fs').then(fs => {
      fs.writeFileSync('test-dashboard.png', buffer)
      console.log('Image with live temperature saved as test-dashboard.png')
    })
  } catch (error) {
    console.error('Error generating image:', error)
  }
}

testImage()
