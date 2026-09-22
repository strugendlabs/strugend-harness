/** Synthetic coding and everyday tasks with artifact checks independent of agent claims. */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** One task is reproduced byte-for-byte in separate baseline and assist workspaces. */
export interface PairedDecisionTask {
  id: string
  prompt: string
  files: Record<string, string>
  verify: (directory: string) => Promise<boolean>
}

/** Tiny controlled tasks establish harness plumbing; they are not a frontier coding benchmark. */
export const pairedDecisionTasks: readonly PairedDecisionTask[] = [
  {
    id: 'signed-sum',
    prompt: 'Fix sum.mjs so sum(numbers) adds all finite numbers, including negatives and zero. It must return zero for an empty array. Keep the named export sum. Only change sum.mjs, and verify its behavior before reporting completion.',
    files: { 'sum.mjs': 'export function sum(numbers) { return numbers.filter(n => n > 0).reduce((a, b) => a + b, 0) }\n' },
    verify: async (directory) => {
      try {
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
          "const {sum}=await import('./sum.mjs');process.stdout.write(JSON.stringify([sum([-4,2,0]),sum([]),sum([.5,-.25]),sum([-3,-2])]))"],
        { cwd: directory, env: {}, timeout: 5000, maxBuffer: 1024 })
        return stdout === '[-2,0,0.25,-5]'
      } catch { return false }
    },
  },
  {
    id: 'expense-summary',
    prompt: 'Read transactions.csv and create summary.json with exactly these keys: currency, totalCents, byCategory. Use integer cents, include refunds (negative values), and preserve category spelling. Do not modify the CSV. Reopen and verify the saved JSON.',
    files: { 'transactions.csv': 'category,cents,currency\nTravel,1250,EUR\nMeals,800,EUR\nTravel,-250,EUR\nMeals,300,EUR\n' },
    verify: async (directory) => {
      try {
        const text = await readFile(join(directory, 'summary.json'), 'utf8')
        const value: unknown = JSON.parse(text)
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const record = value as Record<string, unknown>, category = record.byCategory
        if (!category || typeof category !== 'object' || Array.isArray(category)) return false
        const totals = category as Record<string, unknown>
        return Object.keys(record).sort().join(',') === 'byCategory,currency,totalCents' && record.currency === 'EUR'
          && record.totalCents === 2100 && Object.keys(totals).sort().join(',') === 'Meals,Travel' && totals.Meals === 1100 && totals.Travel === 1000
          && await readFile(join(directory, 'transactions.csv'), 'utf8') === 'category,cents,currency\nTravel,1250,EUR\nMeals,800,EUR\nTravel,-250,EUR\nMeals,300,EUR\n'
      } catch { return false }
    },
  },
]
