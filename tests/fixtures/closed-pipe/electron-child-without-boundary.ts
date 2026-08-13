import { createReadStream, writeSync } from 'node:fs'

const streamName = process.argv.find((argument) => argument.startsWith('probe-stream:'))?.slice('probe-stream:'.length)

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

  const stream = process[streamName === 'stderr' ? 'stderr' : 'stdout']
  let sawExpectedError = false
  stream.once('error', (error: NodeJS.ErrnoException) => {
    sawExpectedError = true
    desiredExitCode = 71
    writeSync(3, `EXPECTED_${error.code || 'UNKNOWN'}\n`)
  })
  stream.write('closed-pipe-probe\n')
  setImmediate(() => {
    if (sawExpectedError) return
    desiredExitCode = 0
    writeSync(3, 'SURVIVED_WITHOUT_BOUNDARY\n')
  })
})
