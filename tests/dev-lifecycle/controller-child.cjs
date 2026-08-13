const { writeSync } = require('node:fs')

const revision = process.argv.find((argument) => argument.startsWith('revision:'))?.slice('revision:'.length) || 'unknown'
writeSync(3, `REVISION:${revision}\n`)
setInterval(() => {}, 1_000)
