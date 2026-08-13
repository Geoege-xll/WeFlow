import { createReadStream, writeSync } from 'node:fs'
import { installSafeConsole } from '../../../electron/safe-console'

installSafeConsole()

const streamName = process.argv.find((argument) => argument.startsWith('probe-stream:'))?.slice('probe-stream:'.length)
const errorCode = process.argv.find((argument) => argument.startsWith('probe-error:'))?.slice('probe-error:'.length)

writeSync(3, 'READY\n')

const control = createReadStream('', { fd: 3, autoClose: false })
control.setEncoding('utf8')
let controlInput = ''
let desiredExitCode: number | undefined
control.on('end', () => process.exit(desiredExitCode ?? 72))
control.on('data', (chunk) => {
  controlInput += chunk
  if (!controlInput.includes('PROBE\n')) return
  control.removeAllListeners('data')

  if (errorCode) {
    const error = Object.assign(new Error(errorCode), { code: errorCode })
    try {
      process[streamName === 'stderr' ? 'stderr' : 'stdout'].emit('error', error)
    } catch (exposedError) {
      if (exposedError === error) {
        desiredExitCode = 70
        writeSync(3, 'UNKNOWN_EXPOSED\n')
        return
      }
      throw exposedError
    }
    desiredExitCode = 0
    writeSync(3, 'UNKNOWN_SWALLOWED\n')
    return
  }

  const stream = process[streamName === 'stderr' ? 'stderr' : 'stdout']
  stream.write('closed-pipe-probe\n')
  setImmediate(() => {
    desiredExitCode = 0
    writeSync(3, 'SURVIVED\n')
  })
})
