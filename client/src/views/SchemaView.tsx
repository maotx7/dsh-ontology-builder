/** Object types as cards and link types as edges, laid out top-down with dagre. */
import { useMemo, useState } from 'react'
import dagre from '@dagrejs/dagre'
import { Background, BaseEdge, Controls, type Edge, type EdgeProps, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ObjectTypeDef, OntologySchema, Overview } from '../api'
import { useApi } from '../hooks'
import { useT } from '../i18n'
import { Loading, WithCode } from '../ui'

const CARD_WIDTH = 240
const ROW_HEIGHT = 20
const CARD_BASE = 56

type TypeNode = Node<{ type: ObjectTypeDef; changed: 'added' | 'changed' | null }, 'objectType'>

function TypeCard({ data }: NodeProps<TypeNode>) {
  const tr = useT()
  const t = data.type
  return (
    <div className={`type-card${data.changed ? ` diff-${data.changed}` : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="type-title">
        <strong>{t.displayName ?? t.apiName}</strong>
        {t.displayName && t.displayName !== t.apiName && <span className="muted"> {t.apiName}</span>}
        {data.changed && <span className="badge">{tr(data.changed)}</span>}
      </div>
      <ul className="type-props">
        {t.properties.map(p => (
          <li key={p.apiName}>
            <span>{p.apiName === t.primaryKey ? '🔑 ' : ''}{p.apiName}{p.required ? '*' : ''}</span>
            <span className="muted">{p.enum ? tr('enum') : p.type}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
const nodeTypes = { objectType: TypeCard }

/** A link type from a type to itself: a loop around the card's left side, labelled outside the card. */
function SelfLoopEdge({ sourceX, sourceY, targetX, targetY, label, markerEnd, style }: EdgeProps) {
  const reach = CARD_WIDTH / 2 + 80
  const path = `M ${sourceX} ${sourceY} C ${sourceX - reach} ${sourceY + 60}, ${targetX - reach} ${targetY - 60}, ${targetX} ${targetY}`
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} label={label} labelX={sourceX - CARD_WIDTH / 2} labelY={targetY - 24} labelBgPadding={[4, 2]} />
}
const edgeTypes = { selfLoop: SelfLoopEdge }

const CARDINALITY: Record<string, string> = { 'one-to-one': '1 : 1', 'one-to-many': '1 : N', 'many-to-one': 'N : 1', 'many-to-many': 'N : N' }

function layout(schema: OntologySchema, diff: { added: Set<string>; changed: Set<string> }): { nodes: TypeNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  const height = (t: ObjectTypeDef) => CARD_BASE + t.properties.length * ROW_HEIGHT
  for (const t of schema.objectTypes) g.setNode(t.apiName, { width: CARD_WIDTH, height: height(t) })
  for (const l of schema.linkTypes) if (l.from !== l.to && g.hasNode(l.from) && g.hasNode(l.to)) g.setEdge(l.from, l.to, {}, l.apiName)
  dagre.layout(g)
  const nodes: TypeNode[] = schema.objectTypes.map(t => {
    const p = g.node(t.apiName)
    return {
      id: t.apiName,
      type: 'objectType',
      position: { x: p.x - CARD_WIDTH / 2, y: p.y - height(t) / 2 },
      data: { type: t, changed: diff.added.has(t.apiName) ? 'added' : diff.changed.has(t.apiName) ? 'changed' : null }
    }
  })
  const edges: Edge[] = schema.linkTypes.map(l => ({
    id: l.apiName,
    source: l.from,
    target: l.to,
    // React Flow draws nothing visible for a straight source-to-same-node edge.
    type: l.from === l.to ? 'selfLoop' : undefined,
    label: `${l.apiName} / ${l.inverseApiName} · ${CARDINALITY[l.cardinality] ?? l.cardinality}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: diff.added.has(`link:${l.apiName}`) ? 'diff-added' : diff.changed.has(`link:${l.apiName}`) ? 'diff-changed' : undefined
  }))
  return { nodes, edges }
}

export function SchemaView({ project }: { project: string }) {
  const t = useT()
  const overview = useApi<Overview>('overview', { project })
  const [version, setVersion] = useState('draft')
  const { data, error, loading } = useApi<{ version: number | 'draft'; schema: OntologySchema }>('schema', { project, version })
  const latest = overview.data?.versions.at(-1)?.version
  // Highlight what the draft changes relative to the published version.
  const diff = useApi<{ objectTypes: { added: string[]; changed: string[] }; linkTypes: { added: string[]; changed: string[] } }>(
    version === 'draft' ? 'diff' : undefined,
    { project, from: latest ? String(latest) : undefined, to: 'draft' }
  )
  const graph = useMemo(() => {
    if (!data) return undefined
    const d = version === 'draft' && diff.data
      ? {
          added: new Set([...diff.data.objectTypes.added, ...diff.data.linkTypes.added.map(n => `link:${n}`)]),
          changed: new Set([...diff.data.objectTypes.changed, ...diff.data.linkTypes.changed.map(n => `link:${n}`)])
        }
      : { added: new Set<string>(), changed: new Set<string>() }
    return layout(data.schema, d)
  }, [data, diff.data, version])

  return (
    <div className="view">
      <div className="toolbar">
        <label>
          {t('version')}{' '}
          <select value={version} onChange={e => setVersion(e.target.value)}>
            <option value="draft">{t('draft')}</option>
            {overview.data?.versions.slice().reverse().map(v => <option key={v.version} value={String(v.version)}>v{v.version} {v.note && `— ${v.note}`}</option>)}
          </select>
        </label>
        {data && <span className="muted">{t('objectTypesCount', { objects: data.schema.objectTypes.length, links: data.schema.linkTypes.length, questions: data.schema.questions.length })}</span>}
        {version === 'draft' && latest && <span className="legend"><span className="diff-added">{t('added')}</span> <span className="diff-changed">{t('changed')}</span> {t('vs', { version: latest })}</span>}
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && !data.schema.objectTypes.length && <p className="empty"><WithCode text={t('schemaEmpty')} /></p>}
      {graph && graph.nodes.length > 0 && (
        <div className="canvas" role="img" aria-label={t('schemaDiagramLabel')}>
          <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.3 }} nodesConnectable={false} edgesFocusable={false} minZoom={0.1}>
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
      {data && data.schema.questions.length > 0 && (
        <details>
          <summary>{t('competencyQuestions')}</summary>
          <ul>{data.schema.questions.map(q => <li key={q.id}><code>{q.id}</code> [{q.priority}] {q.text}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
