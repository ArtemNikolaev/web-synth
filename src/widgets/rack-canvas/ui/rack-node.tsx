import { useLayoutEffect } from 'react'
import { Handle, Position, useConnection, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { modules, ports, type Module } from '../../../entities/audio-module/index.ts'

export type RackNode = Node<{ module: Module }, 'rack'>
export const nodeTypes = { rack: RackModule }

function RackModule({ id, data, selected }: NodeProps<RackNode>) {
  const node = data.module
  const update = useUpdateNodeInternals()
  useLayoutEffect(() => update(id), [id, node.count, update])
  const start = useConnection(connection => connection.inProgress ? connection.fromHandle : null)
  const startNode = useConnection(connection => connection.inProgress ? connection.fromNode?.data.module as Module | undefined : undefined)
  const startPorts = startNode && start ? ports(startNode, start.type === 'source' ? 'out' : 'in') : []
  const startSignal = startPorts.find(port => port.id === start?.id)?.signal
  const inputs = ports(node, 'in')
  const outputs = ports(node, 'out')
  const maxPorts = Math.max(inputs.length, outputs.length)
  return (
    <article className={'rack-node kind-' + node.kind + (selected ? ' selected' : '')} style={{ minHeight: Math.max(86, 55 + maxPorts * 24) }}>
      <strong>{modules[node.kind].title}{node.auto && <span className="auto">auto</span>}</strong>
      <div className="node-summary">{modules[node.kind].describe(node)}</div>
      {(['in', 'out'] as const).flatMap(side => {
        const list = side === 'in' ? inputs : outputs
        const type = side === 'in' ? 'target' : 'source'
        return list.map(port => {
          const offset = maxPorts === 1 ? '50%' : 62 + port.index * 24
          const compatible = start && start.type !== type && start.nodeId !== id && startSignal === port.signal
          return (
            <Handle key={port.id} id={port.id} type={type} position={side === 'in' ? Position.Left : Position.Right}
              className={'port ' + port.signal + (start ? (compatible ? ' compatible' : ' dim') : '')}
              style={{ top: offset }} isConnectableStart={side === 'out'} isConnectableEnd={!start || Boolean(compatible)}
              title={(side === 'in' ? 'Вход ' : 'Выход ') + (port.index + 1) + ' · ' + port.signal}
              aria-label={(side === 'in' ? 'Вход ' : 'Выход ') + (port.index + 1) + ' · ' + port.signal}>
              <span className="port-number">{port.index + 1}</span>
            </Handle>
          )
        })
      })}
    </article>
  )
}
