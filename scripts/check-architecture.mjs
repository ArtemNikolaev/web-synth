import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const sourceRoot = resolve('src')
const layers = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
const { fileNames, options } = ts.parseJsonConfigFileContent(config.config, ts.sys, '.')
const program = ts.createProgram(fileNames, options)
const canonicalFileName = ts.createGetCanonicalFileName(ts.sys.useCaseSensitiveFileNames)
const resolutionCache = ts.createModuleResolutionCache(process.cwd(), canonicalFileName, options)
let violations = 0

function location(file) {
  const path = relative(sourceRoot, resolve(file))
  if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) return
  const [layer, segment, ...rest] = path.split(sep)
  const rank = layers.indexOf(layer)
  const hasSlices = layer !== 'app' && layer !== 'shared'
  return { rank, hasSlices, segment, rest }
}

function report(file, message) {
  console.error(relative(process.cwd(), file) + ' — ' + message)
  violations++
}

function checkImport(file, source, specifier) {
  const path = specifier.text
  const resolved = ts.resolveModuleName(path, file, options, ts.sys, resolutionCache).resolvedModule
  const candidate = resolve(dirname(file), path)
  const targetFile = resolved?.resolvedFileName ?? (path.startsWith('.') && existsSync(candidate) ? candidate : undefined)
  if (!targetFile) return
  const target = location(targetFile)
  if (!target) return
  const projectModuleContract = layers[source.rank] === 'entities' && source.segment === 'project' &&
    layers[target.rank] === 'entities' && target.segment === 'audio-module' &&
    target.rest.length === 2 && target.rest[0] === '@x' && target.rest[1] === 'project.ts'
  if (target.rank < 0) {
    report(file, `"${path}" points outside an FSD layer`)
  } else if (target.rank < source.rank) {
    report(file, `"${path}" imports a higher layer`)
  } else if (target.rank === source.rank && source.hasSlices && target.segment !== source.segment) {
    if (!projectModuleContract) report(file, `"${path}" imports a sibling slice`)
  } else if (target.rank > source.rank && (target.hasSlices || layers[target.rank] === 'shared') &&
    (target.rest.length !== 1 || target.rest[0] !== 'index.ts')) {
    report(file, `"${path}" bypasses the public index.ts`)
  }
}

for (const file of program.getSourceFiles()) {
  const source = location(file.fileName)
  if (!source) continue
  if (source.rank < 0 || (source.hasSlices && !source.rest.length)) {
    report(file.fileName, 'place the module inside an FSD layer and slice')
    continue
  }

  function visit(node) {
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal
    if (specifier && ts.isStringLiteralLike(specifier)) checkImport(file.fileName, source, specifier)
    ts.forEachChild(node, visit)
  }

  visit(file)
}

if (violations) process.exitCode = 1
