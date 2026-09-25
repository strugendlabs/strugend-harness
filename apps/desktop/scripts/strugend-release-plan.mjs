/** Decide whether the checked-in version represents a new immutable desktop release. */
import { readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { valid, gt } = require('semver')
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
if (!valid(version)) throw new Error('The repository version is not valid semver.')
if (process.env.REQUESTED_VERSION && process.env.REQUESTED_VERSION !== version) throw new Error('Requested version differs from package.json.')
const releases = JSON.parse(execFileSync('gh', ['release', 'list', '--repo', process.env.GITHUB_REPOSITORY, '--limit', '100', '--json', 'tagName,isDraft'], { encoding: 'utf8' }))
const published = releases.filter(r => !r.isDraft && r.tagName.startsWith('strugend-v')).map(r => r.tagName.slice(10)).filter(v => valid(v))
const isNew = published.every(previous => gt(version, previous))
const build = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || isNew
const publish = isNew && (process.env.GITHUB_EVENT_NAME === 'push' || process.env.PUBLISH_REQUESTED === 'true')
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nbuild=${build}\npublish=${publish}\n`)
console.log(JSON.stringify({ version, build, publish }))
