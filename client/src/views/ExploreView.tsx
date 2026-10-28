/**
 * Instance graph. Starts from one object (or the first page of a type) and
 * expands neighbours on demand; candidates are dashed and translucent.
 */
import { useEffect, useRef, useState } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import { api, type LinkRecord, type ObjectRecord, type OntologySchema, type Status } from '../api'
import type { Navigate } from '../App'
import { useApi } from '../hooks'
import { Loading } from '../ui'
import { ItemPanel } from './ItemPanel'

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac']

const STYLE: cytoscape.StylesheetJson = [
  { selector: 'node', style: { label: 'data(label)', 'background-color': 'data(color)', color: '#222', 'font-size': 11, 'text-valign': 'bottom', 'text-margin-y': 4, width: 26, height: 26 } },
  { selector: 'node.candidate', style: { opacity: 0.55, 'border-width': 2, 'border-style': 'dashed', 'border-color': '#555' } },
  { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#111', 'border-style': 'solid' } },
  { selector: 'edge', style: { label: 'data(label)', 'font-size': 9, color: '#555', width: 1.5, 'line-color': '#999', 'target-arrow-color': '#999', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'text-background-color': '#fff', 'text-background-opacity': 0.85, 'text-background-padding': '2px' } },
  { selector: 'edge.candidate', style: { 'line-style': 'dashed', opacity: 0.6 } }
]

function toElements(objects: ObjectRecord[], links: LinkRecord[], color: (type: string) => string, title: (o: ObjectRecord) => string): ElementDefinition[] {
  return [
    ...objects.map(o => ({ group: 'nodes' as const, data: { id: o.id, label: title(o), color: color(o.type) }, classes: o.status })),
    ...links.map(l => ({ group: 'edges' as const, data: { id: l.id, source: l.fromId, target: l.toId, label: l.linkType }, classes: l.status }))
  ]
}

export function ExploreView({ project, focus, navigate }: { project: string; focus?: string; navigate: Navigate }) {
  const schema = useApi<{ schema: OntologySchema }>('schema', { project, version: 'draft' })
  const [type, setType] = useState('')
  const [showCandidates, setShowCandidates] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ObjectRecord[]>([])
  const [selected, setSelected] = useState<string | undefined>(focus)
  const [error, setError] = useState<string>()
  const [truncated, setTruncated] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | undefined>(undefined)
  const status = showCandidates ? 'candidate,confirmed' : 'confirmed'

  const types = schema.data?.schema.objectTypes ?? []
  const color = (t: string) => PALETTE[Math.max(0, types.findIndex(x => x.apiName === t)) % PALETTE.length]
  const title = (o: ObjectRecord) => {
    const def = types.find(t => t.apiName === o.type)
    const v = def?.titleProperty ? o.properties[def.titleProperty] : undefined
    return String(v ?? o.key)
  }

  useEffect(() => {
    if (!container.current) return
    const instance = cytoscape({ container: container.current, style: STYLE, wheelSensitivity: 0.3 })
    instance.on('tap', 'node', e => setSelected(e.target.id()))
    instance.on('dbltap', 'node', e => expand(e.target.id()))
    cy.current = instance
    return () => instance.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const merge = (objects: ObjectRecord[], links: LinkRecord[], reset: boolean) => {
    const g = cy.current
    if (!g) return
    if (reset) g.elements().remove()
    const fresh = toElements(objects, links, color, title).filter(el => g.getElementById(el.data.id!).empty())
    // Edges need both endpoints present.
    g.add(fresh.filter(el => el.group === 'nodes'))
    g.add(fresh.filter(el => el.group === 'edges' && !g.getElementById(el.data.source).empty() && !g.getElementById(el.data.target).empty()))
    // Small graphs: rings by degree, hubs in the middle, deterministic and readable. Larger: force-directed; huge: grid.
    const n = g.nodes().length
    const options = n > 300
      ? { name: 'grid' }
      : n > 40
        ? { name: 'cose', randomize: true }
        : { name: 'concentric', minNodeSpacing: 70, concentric: (node: cytoscape.NodeSingular) => node.degree(false), levelWidth: () => 1 }
    g.layout({ ...options, animate: false, fit: true, padding: 40 } as cytoscape.LayoutOptions).run()
    // Small graphs would otherwise be zoomed in until labels are oversized.
    if (g.zoom() > 1.4) {
      g.zoom(1.4)
      g.center()
    }
  }

  const expand = (id: string) => {
    api<{ objects: ObjectRecord[]; links: LinkRecord[] }>('neighbors', { project, id, status })
      .then(r => merge(r.objects, r.links, false))
      .catch((e: Error) => setError(e.message))
  }

  const loadType = (t: string) => {
    setError(undefined)
    api<{ objects: ObjectRecord[]; links: LinkRecord[]; truncated: boolean }>('graph', { project, type: t || undefined, status })
      .then(r => {
        setTruncated(r.truncated)
        merge(r.objects, r.links, true)
      })
      .catch((e: Error) => setError(e.message))
  }

  // Initial view: the focused object and its neighbours, or everything when small.
  useEffect(() => {
    if (!schema.data) return
    if (focus) {
      cy.current?.elements().remove()
      expand(focus)
      setSelected(focus)
    } else loadType(type)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.data, focus, status])

  useEffect(() => {
    if (!selected || !cy.current) return
    cy.current.elements().unselect()
    cy.current.getElementById(selected).select()
  }, [selected])

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    api<ObjectRecord[]>('search', { project, q: query, type: type || undefined, status }).then(setResults).catch((er: Error) => setError(er.message))
  }

  const legend: Array<[string, Status]> = [['confirmed', 'confirmed'], ['candidate (dashed)', 'candidate']]
  return (
    <div className="view split">
      <div className="main-col">
        <div className="toolbar">
          <label>
            Type{' '}
            <select value={type} onChange={e => { setType(e.target.value); loadType(e.target.value) }}>
              <option value="">all</option>
              {types.map(t => <option key={t.apiName} value={t.apiName}>{t.displayName ?? t.apiName}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={showCandidates} onChange={e => setShowCandidates(e.target.checked)} /> show candidates</label>
          <form onSubmit={search} role="search">
            <label className="sr-only" htmlFor="explore-search">Search objects</label>
            <input id="explore-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search key or property" />
            <button type="submit">Search</button>
          </form>
          <span className="legend">
            {types.map(t => <span key={t.apiName}><i style={{ background: color(t.apiName) }} />{t.apiName}</span>)}
            {legend.map(([label, s]) => <span key={s} className={`status-${s}`}>{label}</span>)}
          </span>
        </div>
        {results.length > 0 && (
          <ul className="results">
            {results.map(o => <li key={o.id}><button type="button" className="link" onClick={() => { setResults([]); navigate({ tab: 'explore', item: o.id }) }}>{o.type} · {title(o)}</button></li>)}
          </ul>
        )}
        <Loading error={error ?? schema.error} loading={schema.loading && !schema.data} />
        {truncated && <p className="muted">Showing the first 2000 objects; filter by type or search to narrow down.</p>}
        <div ref={container} className="canvas" role="img" aria-label="Instance graph. Click a node for details, double-click to expand its neighbours." />
        <p className="muted">Click a node for details · double-click to expand neighbours · scroll to zoom</p>
      </div>
      <aside className="side-col">
        {selected ? <ItemPanel project={project} id={selected} navigate={navigate} /> : <p className="muted">Select an object.</p>}
      </aside>
    </div>
  )
}
