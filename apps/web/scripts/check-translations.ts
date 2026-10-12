import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid catalog entry: ${prefix}`)
  return Object.assign({}, ...Object.entries(value).map(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key)))
}

function argumentsOf(elements: MessageFormatElement[]): string {
  const args = new Set<string>()
  function visit(nodes: MessageFormatElement[]) {
    for (const node of nodes) {
      if (node.type === TYPE.literal || node.type === TYPE.pound) continue
      args.add(`${node.value}:${node.type}`)
      if (node.type === TYPE.tag) visit(node.children)
      if (node.type === TYPE.plural || node.type === TYPE.select) {
        for (const option of Object.values(node.options)) visit(option.value)
      }
    }
  }
  visit(elements)
  return [...args].sort().join(',')
}

export function validateCatalogs(english: unknown, translated: unknown): string[] {
  const base = leaves(english)
  const selected = leaves(translated)
  const errors: string[] = []
  for (const [key, value] of Object.entries(base)) {
    if (!Object.hasOwn(selected, key)) {
      errors.push(`Missing: ${key}`)
      continue
    }
    try {
      if (argumentsOf(parse(value)) !== argumentsOf(parse(selected[key]!))) errors.push(`Arguments differ: ${key}`)
    } catch (error) {
      errors.push(`Invalid ICU: ${key}: ${String(error)}`)
    }
  }
  for (const key of Object.keys(selected)) if (!Object.hasOwn(base, key)) errors.push(`Extra: ${key}`)
  return errors
}

/** Catch literal keys absent from both catalogs. Dynamic keys are covered by catalog/flow tests. */
export function validateSourceMessages(source: string, catalog: unknown): string[] {
  const messages = leaves(catalog)
  const bindings = new Map<string, Set<string>>()
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(['"]([^'"]+)['"]\)/g)) {
    const namespaces = bindings.get(match[1]!) ?? new Set<string>()
    namespaces.add(match[2]!)
    bindings.set(match[1]!, namespaces)
  }
  const errors: string[] = []
  for (const [binding, namespaces] of bindings) {
    const calls = new RegExp(`(?<![\\w.])${binding}\\(\\s*['"]([^'"]+)['"]`, 'g')
    for (const match of source.matchAll(calls)) {
      if (![...namespaces].some((namespace) => Object.hasOwn(messages, `${namespace}.${match[1]}`))) {
        errors.push(`Unknown message: ${[...namespaces][0]}.${match[1]}`)
      }
    }
  }
  return [...new Set(errors)]
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const english = JSON.parse(await readFile(new URL('../messages/en.json', import.meta.url), 'utf8'))
  const spanish = JSON.parse(await readFile(new URL('../messages/es.json', import.meta.url), 'utf8'))
  const errors = validateCatalogs(english, spanish)
  const sourceRoot = new URL('../src/', import.meta.url)
  for (const entry of await readdir(sourceRoot, { recursive: true })) {
    if (!/\.tsx?$/.test(entry)) continue
    const source = await readFile(new URL(entry, sourceRoot), 'utf8')
    errors.push(...validateSourceMessages(source, english).map((error) => `${entry}: ${error}`))
  }
  const previewEnglish = JSON.parse(await readFile(new URL('../messages/preview-en.json', import.meta.url), 'utf8'))
  for (const [key, message] of Object.entries(previewEnglish)) {
    if (english.shared[key] !== message) errors.push(`Preview English differs: shared.${key}`)
  }
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else console.log('English/Spanish catalogs: keys, ICU syntax, arguments and literal source references match.')
}
