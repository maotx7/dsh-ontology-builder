/**
 * Object types as cards and link types as edges, laid out top-down with dagre.
 * Cards can be dragged to rearrange the diagram; selecting one opens its details.
 */
import { useEffect, useMemo, useState } from 'react'
import dagre from '@dagrejs/dagre'
import { applyNodeChanges, Background, BaseEdge, Controls, type Edge, type EdgeProps, Handle, MarkerType, type Node, type NodeChange, type NodeProps, Position, ReactFlow, type XYPosition } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { LinkTypeDef, ObjectTypeDef, OntologySchema, Overview } from '../api'
import { useApi } from '../hooks'
import { useT } from '../i18n'
import { Loading, WithCode } from '../ui'

const CARD_WIDTH = 240
const ROW_HEIGHT = 20
const CARD_BASE = 56

type Changed = 'added' | 'changed' | null
type TypeNode = Node<{ type: ObjectTypeDef; changed: Changed }, 'objectType'>

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
/** The same link read from its `to` side. */
const INVERSE: Record<string, string> = { 'one-to-one': 'one-to-one', 'one-to-many': 'many-to-one', 'many-to-one': 'one-to-many', 'many-to-many': 'many-to-many' }

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

  // Where the user dragged cards to, by type name. Survives refetches and version switches.
  const [moved, setMoved] = useState<Record<string, XYPosition>>({})
  const [selected, setSelected] = useState<string>()
  const [nodes, setNodes] = useState<TypeNode[]>([])

  useEffect(() => {
    setNodes(graph ? graph.nodes.map(n => ({ ...n, position: moved[n.id] ?? n.position, selected: n.id === selected })) : [])
    // Selection is synced by the effect below; rebuilding on it would undo nothing but costs a pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, moved])
  useEffect(() => {
    setNodes(ns => ns.map(n => (n.selected === (n.id === selected) ? n : { ...n, selected: n.id === selected })))
  }, [selected])

  const onNodesChange = (changes: NodeChange<TypeNode>[]) => {
    // Clicking or keyboard-selecting a card opens its details.
    const picked = changes.find(c => c.type === 'select' && c.selected)
    if (picked && 'id' in picked) setSelected(picked.id)
    setNodes(ns => applyNodeChanges(changes, ns))
  }

  // Emphasise the link types touching the selected card.
  const edges = useMemo(() => (graph?.edges ?? []).map(e => (
    selected && (e.source === selected || e.target === selected) ? { ...e, className: `${e.className ?? ''} related`.trim() } : e
  )), [graph, selected])

  const selectedType = data?.schema.objectTypes.find(o => o.apiName === selected)
  const selectedChanged = nodes.find(n => n.id === selected)?.data.changed ?? null

  return (
    <div className="view split">
      <div className="main-col">
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
          {Object.keys(moved).length > 0 && <button type="button" onClick={() => setMoved({})}>{t('resetLayout')}</button>}
        </div>
        <Loading error={error} loading={loading && !data} />
        {data && !data.schema.objectTypes.length && <p className="empty"><WithCode text={t('schemaEmpty')} /></p>}
        {nodes.length > 0 && (
          <>
            <div className="canvas" role="img" aria-label={t('schemaDiagramLabel')}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeDragStop={(_, __, dragged) => setMoved(m => ({ ...m, ...Object.fromEntries(dragged.map(n => [n.id, n.position])) }))}
                onPaneClick={() => setSelected(undefined)}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                nodesConnectable={false}
                edgesFocusable={false}
                minZoom={0.1}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            <p className="muted">{t('schemaHint')}</p>
          </>
        )}
        {data && data.schema.questions.length > 0 && (
          <details>
            <summary>{t('competencyQuestions')}</summary>
            <ul>{data.schema.questions.map(q => <li key={q.id}><code>{q.id}</code> [{q.priority}] {q.text}</li>)}</ul>
          </details>
        )}
      </div>
      {data && selectedType && (
        <aside className="side-col">
          <TypeDetail type={selectedType} schema={data.schema} changed={selectedChanged} onSelect={setSelected} onClose={() => setSelected(undefined)} />
        </aside>
      )}
    </div>
  )
}

/** Everything the schema says about one object type: its properties, link types and the questions it serves. */
function TypeDetail({ type, schema, changed, onSelect, onClose }: { type: ObjectTypeDef; schema: OntologySchema; changed: Changed; onSelect: (apiName: string) => void; onClose: () => void }) {
  const t = useT()
  const links = schema.linkTypes.filter(l => l.from === type.apiName || l.to === type.apiName)
  const questions = schema.questions.filter(q => type.questions?.includes(q.id))
  return (
    <section className="ontology-detail" aria-label={t('typeDetailsLabel')}>
      <div className="ontology-detail-head">
        <h2>
          {type.displayName && type.displayName !== type.apiName ? (
            <>
              <div style={{ fontSize: '1.2em', fontWeight: 600 }}>{type.displayName}</div>
              <div style={{ fontSize: '0.85em', color: '#666', fontWeight: 400 }}>{type.apiName}</div>
            </>
          ) : (
            type.apiName
          )}
          {changed && <span className="badge">{t(changed)}</span>}
        </h2>
        <button type="button" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      {type.description ? <p>{type.description}</p> : <p className="muted">{t('noDescription')}</p>}
      <table className="props">
        <tbody>
          <tr><th scope="row">{t('primaryKey')}</th><td><code>{type.primaryKey}</code></td></tr>
          {type.titleProperty && <tr><th scope="row">{t('titleProperty')}</th><td><code>{type.titleProperty}</code></td></tr>}
        </tbody>
      </table>

      <h3>{t('propertiesCount', { count: type.properties.length })}</h3>
      <table className="props">
        <tbody>
          {type.properties.map(p => (
            <tr key={p.apiName}>
              <th scope="row">
                {p.displayName && p.displayName !== p.apiName ? (
                  <>
                    <div style={{ fontWeight: 600 }}>{p.displayName}</div>
                    <code style={{ fontSize: '0.85em', color: '#666' }}>{p.apiName}</code>
                  </>
                ) : (
                  <code>{p.apiName}</code>
                )}
              </th>
              <td>
                <span style={{ color: '#0066cc', fontWeight: 500 }}>{p.type}</span>
                {p.apiName === type.primaryKey && <span className="badge">{t('primaryKey')}</span>}
                {p.required && <span className="badge">{t('required')}</span>}
                {p.enum && <div className="enum-values">{t('enumValues')}: {p.enum.map(v => <code key={v}>{v}</code>)}</div>}
                {p.pattern && <div className="muted">{t('pattern')}: <code>{p.pattern}</code></div>}
                {p.description && <div className="muted">{p.description}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('linkTypesCount', { count: links.length })}</h3>
      {links.length ? (
        <ul className="type-links">
          {links.map(l => <LinkLine key={l.apiName} link={l} from={type.apiName} schema={schema} onSelect={onSelect} />)}
        </ul>
      ) : <p className="muted">{t('noLinks')}</p>}

      {questions.length > 0 && (
        <>
          <h3>{t('competencyQuestions')}</h3>
          <ul className="type-links">{questions.map(q => <li key={q.id}><code>{q.id}</code> [{q.priority}] {q.text}</li>)}</ul>
        </>
      )}
    </section>
  )
}

/** One link type as seen from `from`: traversal name, direction, the other type and cardinality on this side. */
function LinkLine({ link, from, schema, onSelect }: { link: LinkTypeDef; from: string; schema: OntologySchema; onSelect: (apiName: string) => void }) {
  const outgoing = link.from === from
  const other = outgoing ? link.to : link.from
  const name = link.from === link.to ? `${link.apiName} / ${link.inverseApiName}` : outgoing ? link.apiName : link.inverseApiName
  const cardinality = outgoing ? link.cardinality : INVERSE[link.cardinality] ?? link.cardinality

  // Get the displayName of the target type
  const targetType = schema.objectTypes.find(t => t.apiName === other)
  const targetDisplay = targetType?.displayName && targetType.displayName !== targetType.apiName
    ? `${targetType.displayName} (${targetType.apiName})`
    : other

  return (
    <li style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #eee' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <code style={{ fontWeight: 600, color: '#0066cc' }}>{name}</code>
        <span style={{ fontSize: '1.2em', color: outgoing ? '#28a745' : '#6c757d' }}>
          {outgoing ? '→' : '←'}
        </span>
        <button type="button" className="link" onClick={() => onSelect(other)} style={{ fontWeight: 500 }}>
          {targetDisplay}
        </button>
        <span className="muted" style={{ fontSize: '0.9em' }}>
          {CARDINALITY[cardinality] ?? cardinality}
        </span>
      </div>
      {link.description && <div className="muted" style={{ fontSize: '0.9em', marginLeft: '4px' }}>{link.description}</div>}
    </li>
  )
}
