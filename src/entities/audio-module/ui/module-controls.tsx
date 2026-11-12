import { browserModules } from '../browser-registry.ts'
import type { ControlProps } from './controls.tsx'

export function AudioModuleControls(props: ControlProps) {
  const { Controls } = browserModules[props.node.kind]
  return <Controls {...props} />
}
