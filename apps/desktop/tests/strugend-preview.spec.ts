import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { isStrugendPreviewDistribution } from '../scripts/strugend-distribution.mjs'

const environment = { DSH_DESKTOP_APP_ID: 'com.strugend.harness', DSH_DESKTOP_DISTRIBUTION: 'strugend-preview' }

describe('Strugend BYOK test distribution', () => {
  it.each(['win32', 'darwin'] as const)('creates an explicit unsigned %s preview without an updater', (platform) => {
    validateDesktopPackageEnvironment(environment, { platform, arch: 'x64' }, { unsigned: true })
    const config = createElectronBuilderConfig({ ...environment, DSH_DESKTOP_UNSIGNED: '1' }, platform, 'x64')
    expect(config.productName).toBe('Strugend Harness')
    expect(config.extraMetadata.strugendDistribution).toBe('byok-preview')
    expect(config.extraMetadata.dshMandatoryUpdatePolicy).toBeUndefined()
    expect(config.publish).toBeNull()
    expect(config.win.forceCodeSigning).toBe(false)
    expect(config.mac.forceCodeSigning).toBe(false)
    expect(config.mac.identity).toBe('-')
    expect(config.mac.notarize).toBe(false)
    expect(config.dmg.sign).toBe(false)
    expect(config.files).toContain('lib/*.cjs')
    expect(config.files).toContain('lib/*.js')
    expect(config.extraResources.some(resource => resource.to === 'agent-os-skills')).toBe(true)
    expect(config.extraResources.some(resource => resource.to === 'LICENSE')).toBe(true)
  })

  it('rejects implicit unsigned mode, another app identity and unknown distributions', () => {
    expect(() => { validateDesktopPackageEnvironment(environment, { platform: 'darwin', arch: 'arm64' }) }).toThrow('explicit unsigned')
    expect(() => createElectronBuilderConfig(environment, 'darwin', 'arm64')).toThrow('explicit unsigned')
    expect(() => isStrugendPreviewDistribution({ ...environment, DSH_DESKTOP_APP_ID: 'com.deepseek.harness' })).toThrow('separate')
    expect(() => isStrugendPreviewDistribution({ ...environment, DSH_DESKTOP_DISTRIBUTION: 'strugend-free' })).toThrow('Unknown')
  })

  it.each(['DOWNLOAD_TEST_ORIGIN', 'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN', 'DSH_DESKTOP_WINDOWS_TOKEN_PIN',
    'DSH_DESKTOP_MACOS_TEAM_ID', 'CSC_LINK', 'APPLE_ID'])('rejects publisher setting %s', (name) => {
    expect(() => isStrugendPreviewDistribution({ ...environment, [name]: 'fixture' })).toThrow('must not contain')
  })

  it('keeps non-preview macOS signing requirements', () => {
    expect(() => { validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'com.example.application' },
      { platform: 'darwin', arch: 'arm64' }, { unsigned: true }) }).toThrow('requires the Strugend preview')
  })
})
