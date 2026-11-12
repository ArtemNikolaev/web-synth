import { serializeProject, type Project } from '../../../entities/project/index.ts'

export function downloadProject(project: Project) {
  const url = URL.createObjectURL(new Blob([serializeProject(project)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = project.name.replace(/[<>:"/\\|?*]/g, '_') + '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
