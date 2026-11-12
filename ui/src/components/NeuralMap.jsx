// Frontal Lobe — 3D Neural Map (center canvas)
//
// react-force-graph-3d + custom sprites. Ports the proven Optic Nerve
// patterns: lucide→SVG cache, one-canvas label sprite (caption + name +
// icon as ONE object — auto-billboards, rotates as one), feathered glow
// textures cached once per color, ResizeObserver viewport sizing
// (Optic Nerve camera-centering fix), centroid lock + axis gravity.
//
// Data: GET /graph → { nodes: [{id,label,caption,tier,type,icon,summary}],
//                      links: [{source,target,type,weight}] }
// Styling is keyed off node.type / node.tier via theme.graph — the UI is dumb.

import ForceGraph3D from 'react-force-graph-3d'
import { useCallback, useEffect, useMemo, useRef, useState, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import * as THREE from 'three'
import * as LucideIcons from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { forceX, forceY, forceZ } from 'd3-force-3d'
import { getGraph } from '../lib/api.js'
import { theme } from '../config/theme.js'
import { typeOn, bandOn } from '../config/nodeTypes.js'

const G = theme.graph
const P = G.physics

// One node config = defaults merged with the type's overrides (10 Aug 26).
// Every node type resolves a full record this way — no partial maps.
function nodeCfg(type) {
  return { ...G.nodes.defaults, ...(G.nodes.byType[type] || {}) }
}

// ═══ 1. Icon SVG cache — lucide component → inline SVG string (once per name/color) ═══
const iconSvgCache = {}

// lucide-react exports PascalCase ONLY ("NotebookPen", "HousePlus") — a hyphenated
// or mixed-case name in theme.js is silently undefined. Normalize any spelling the
// user types ("notebook-pen", "Notebook-Pen") to the exact export name (16 Aug 26).
function normalizeIconName(name) {
  return name.split(/[-_ ]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function getIconSVG(iconName, color, strokeWidth) {
  const key = `${iconName}_${color}_${strokeWidth}`
  if (iconSvgCache[key]) return iconSvgCache[key]
  let IconComponent = LucideIcons[iconName]
  if (!IconComponent) IconComponent = LucideIcons[normalizeIconName(iconName)]
  if (!IconComponent) {
    console.warn('Icon not found in lucide-react:', iconName)
    return null
  }
  try {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(createElement(IconComponent, {
        size: 256, color, 'stroke-width': strokeWidth, absoluteStrokeWidth: true,
      }))
    })
    const svgHTML = container.innerHTML
    root.unmount()
    iconSvgCache[key] = svgHTML
    return svgHTML
  } catch (e) {
    console.warn('Icon SVG render failed:', iconName, e)
    return null
  }
}

// ═══ 2. One-canvas node sprite: caption + name + icon → a single THREE.Sprite ═══
// All content on one canvas = zero parallax drift; the sprite billboards as one object.

// Lazy measure context (shared — creating canvases per call is wasteful at 400+ nodes).
// NOTE: named `mctx`, NOT `ctx` — makeNodeSprite declares a local `const ctx` for
// its draw canvas, which would shadow the helper and TDZ-crash the first call.
let measureCtx = null
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

// Word-wrap a line to maxWidth, capped at maxLines; overflow ends with an ellipsis.
// Ported from Optic Nerve's makeGroupLabel wrap (maxWidth) + a line cap.
function wrapText(text, size, weight, maxWidth, maxLines) {
  const c = mctx()
  c.font = `${weight} ${size}px ${G.label.fontFamily}`
  if (c.measureText(text).width <= maxWidth) return [text]
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (line && c.measureText(test).width > maxWidth) {
      lines.push(line)
      if (lines.length === maxLines) {
        // Truncated — trim the current word char-by-char until it fits with the ellipsis.
        let cut = word
        while (cut && c.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1)
        lines[lines.length - 1] = cut ? `${cut}…` : lines[lines.length - 1]
        return lines
      }
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function makeNodeSprite(node) {
  const L = G.label
  const cfg = nodeCfg(node.type)
  // cfg.icon is the LIVE icon source (10 Aug 26); the payload's node.icon is
  // only a fallback so a node with an unlisted type still gets its icon.
  const iconName = cfg.icon || node.icon
  const iconSVG = iconName
    ? getIconSVG(iconName, cfg.iconColor, L.iconStrokeWidth)
    : null
  const lines = []
  // Per-type tag line (kept for future use — TICKER no longer uses it).
  if (cfg.tag) lines.push({ text: cfg.tag, color: cfg.captionColor, size: cfg.captionSize * 0.9, weight: 700 })
  // Skip caption when it just repeats the name (e.g. old TICKER nodes) — redundant text.
  if (node.caption && node.caption !== node.label) {
    wrapText(node.caption, cfg.captionSize, 400, L.maxWidth, L.captionMaxLines)
      .forEach((t) => lines.push({ text: t, color: cfg.captionColor, size: cfg.captionSize, weight: 400 }))
  }
  if (cfg.noWrapName) {
    // canonical name stays ONE line, full width (TICKER) — 5 Aug 26
    lines.push({ text: node.label, color: cfg.nameColor, size: cfg.nameSize, weight: 700 })
  } else {
    wrapText(node.label, cfg.nameSize, 700, L.maxWidth, L.nameMaxLines)
      .forEach((t) => lines.push({ text: t, color: cfg.nameColor, size: cfg.nameSize, weight: 700 }))
  }

  // Measure
  const tctx = mctx()
  let maxW = 0
  lines.forEach((l) => {
    tctx.font = `${l.weight} ${l.size}px ${L.fontFamily}`
    maxW = Math.max(maxW, tctx.measureText(l.text).width)
  })
  maxW = Math.max(maxW, cfg.iconSize)
  const totalTextH = lines.reduce((h, l, i) => h + (i < lines.length - 1 ? l.size * L.lineSpacing : l.size), 0)

  const pad = 6
  // Supersample 2× so label text stays crisp when the camera zooms past 1:1.
  // Canvas-texture sprites rasterize at this resolution — plain dpr pixelates
  // on zoom (the corruption you saw). Capped at 4× total for very high-DPI screens.
  const dpr = Math.min((window.devicePixelRatio || 1) * 2, 4)
  const cw = Math.ceil(maxW + pad * 2)
  const ch = Math.ceil(totalTextH + pad * 2 + (iconSVG ? cfg.iconSize + L.iconGap : 0))

  const c = document.createElement('canvas')
  c.width = cw * dpr
  c.height = ch * dpr
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let y = pad
  lines.forEach((l, i) => {
    ctx.font = `${l.weight} ${l.size}px ${L.fontFamily}`
    ctx.fillStyle = l.color
    ctx.fillText(l.text, cw / 2, y + l.size / 2)
    y += i < lines.length - 1 ? l.size * L.lineSpacing : l.size
  })

  const texture = new THREE.CanvasTexture(c)
  if (iconSVG) {
    const img = new Image()
    const blob = new Blob([iconSVG], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      ctx.drawImage(img, (cw - cfg.iconSize) / 2, y + L.iconGap, cfg.iconSize, cfg.iconSize)
      texture.needsUpdate = true
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  const mat = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, depthTest: true,
    alphaTest: 0.01, opacity: 1.0,
    premultipliedAlpha: true, // canvas IS premultiplied — prevents dark fringes on text
  })
  const sprite = new THREE.Sprite(mat)
  // Visible size scales with the NAME font knob (5 Aug 26) — the old fixed
  // "6 world units" normalization made nameSize/captionSize DO NOTHING.
  // Reference: nameSize 20 → text ≈6 world units; 30 → ≈9; 14 → ≈4.2.
  const textPxH = totalTextH + pad * 2
  const nameWorldScale = (cfg.nameSize / 20) * (6 / textPxH)
  // 10 Aug 26: per-type labelScale multiplier — CONTRACT/DEAL_EVENT grow their
  // whole label (caption + name + icon) without touching the scale formula or
  // other node types. Default 1.0 (no change) via nodes.defaults.
  sprite.scale.set(cw * nameWorldScale * cfg.labelScale, ch * nameWorldScale * cfg.labelScale, 1)
  sprite.renderOrder = 20
  return sprite
}

// ═══ 3. Feathered glow — one canvas texture cached PER COLOR (no per-node cost) ═══
const glowTextureCache = {}

function getGlowTexture(color) {
  if (glowTextureCache[color]) return glowTextureCache[color]
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, color)
  g.addColorStop(G.glowOthers.featherStart, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(canvas)
  glowTextureCache[color] = tex
  return tex
}

// ═══ 3b. Selection halo — a thin ring texture (cached per color) ═══
// The selected node gets a bright-orange ring, scaled with the glow radius
// (theme.graph.halo). No camera movement on click — this ring IS the feedback.
const haloTextureCache = {}

function getHaloTexture(color, thickness) {
  const key = `${color}_${thickness}`
  if (haloTextureCache[key]) return haloTextureCache[key]
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 256, 256)
  ctx.beginPath()
  ctx.arc(128, 128, 118, 0, Math.PI * 2)
  ctx.strokeStyle = color
  ctx.lineWidth = thickness * 6 // scaled for the 256px canvas
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  haloTextureCache[key] = tex
  return tex
}

// ═══ 4. NeuralMap ═══
export default function NeuralMap({ onSelectNode, entityTypes, haloId, flyToId, graphVersion = 0 }) {
  const fgRef = useRef(null)
  const containerRef = useRef(null)
  const spriteRefs = useRef(new Map()) // node.id → THREE.Group (for dim/hover opacity)
  const [hovered, setHovered] = useState(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  const { data: graphData, isFetching, isError, error } = useQuery({
    queryKey: ['graph', graphVersion], queryFn: getGraph, staleTime: 60_000,
  })

  // Viewport sizing — ResizeObserver → explicit width/height on ForceGraph3D
  // (Optic Nerve camera-centering fix: without real dims the camera miscenters).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Attach degrees (glow intensity driver) once per fetch.
  const data = useMemo(() => {
    if (!graphData) return null
    console.log('[NeuralMap] graph data:', graphData.nodes?.length, 'nodes,', graphData.links?.length, 'links')
    const deg = {}
    ;(graphData.links || []).forEach((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source
      const t = typeof l.target === 'object' ? l.target.id : l.target
      deg[s] = (deg[s] || 0) + 1
      deg[t] = (deg[t] || 0) + 1
    })
    return {
      ...graphData,
      nodes: (graphData.nodes || []).map((n) => ({ ...n, __degree: deg[n.id] || 0 })),
    }
  }, [graphData])

  // Physics — charge + centroid lock + axis gravity (keeps the cluster centered).
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !data?.nodes?.length) return
    fg.d3Force('charge').strength(P.charge)
    fg.d3Force('center').strength(P.centerStrength)
    if (P.axisStrength > 0) {
      fg.d3Force('x', forceX().strength(P.axisStrength))
      fg.d3Force('y', forceY().strength(P.axisStrength))
      fg.d3Force('z', forceZ().strength(P.axisStrength))
    }
  }, [data])

  // Fresh data → prune stale sprite refs (keep only current node ids). Runs
  // BEFORE the ego-dim effect so hover/select dimming still finds the sprites.
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.nodes.map((n) => n.id))
    spriteRefs.current.forEach((_, id) => {
      if (!ids.has(id)) spriteRefs.current.delete(id)
    })
  }, [data])

  // Ego rule: selected/hovered node + 1-hop neighbors stay full; rest dims ~15%.
  const egoSet = useCallback((node) => {
    if (!node || !data) return null
    const set = new Set([node.id])
    ;(data.links || []).forEach((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source
      const t = typeof l.target === 'object' ? l.target.id : l.target
      if (s === node.id) set.add(t)
      if (t === node.id) set.add(s)
    })
    return set
  }, [data])

  // Selection rule (CLICK + result-row select, 16 Aug 26): the halo node + its
  // 1-hop neighbors stay at base opacity; the rest dim to 85% of their BASE
  // (from theme). Hover is deliberately passive — wiring it here made skimming
  // flicker the whole map. Exactly one node wears the halo ring.
  useEffect(() => {
    const active = haloId ? egoSet({ id: haloId }) : null
    spriteRefs.current.forEach((group) => {
      const dimmed = !!(active && !active.has(group.userData?.id))
      group.children.forEach((s) => {
        if (!s.material) return
        if (s.userData?.isHalo) {
          s.visible = !dimmed && group.userData?.id === haloId
          return
        }
        const base = s.userData?.baseOpacity ?? 1.0
        s.material.opacity = dimmed ? base * 0.85 : base
      })
    })
  }, [haloId, egoSet])

  // Node factory — glow sprite (behind) + label sprite (front), sized by tier.
  // Per-type glow overrides (nodes.byType.glow) let the TICKER read as a solid
  // ball (smaller, less opaque, tighter feather) instead of a fuzzy halo.
  const nodeThreeObject = useCallback((node) => {
    const group = new THREE.Group()
    group.userData = { id: node.id }
    const cfg = nodeCfg(node.type)
    const color = cfg.color
    // cfg.size = THE visible size knob (world units, per type, direct).
    // Unlisted/unknown types fall back to nodes.defaults.size.
    const ball = cfg.size
    // degreeBoost grows the glow with connectivity — hubs (the #1 contract of a
    // deal) balloon; cap at 100 links so shared giants can't outsize anchors.
    const radius = ball + Math.min(node.__degree || 0, 100) * G.glowOthers.degreeBoost
    const glowCfg = { ...G.glowOthers, ...cfg.glow }

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(color), transparent: true,
      depthWrite: glowCfg.depthWrite, depthTest: true,
      alphaTest: 0.01, opacity: glowCfg.opacity,
    }))
    glow.userData.baseOpacity = glowCfg.opacity // theme value — the dim effect multiplies this
    glow.scale.set(radius * glowCfg.spriteScale, radius * glowCfg.spriteScale, 1)
    glow.renderOrder = 10
    group.add(glow)

    // selection halo (9 Aug 26): thin orange ring, sized to the glow, hidden
    // until this node is selected. No camera zoom on click — the ring is it.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getHaloTexture(G.halo.color, G.halo.thickness),
      transparent: true, depthWrite: false, depthTest: false,
      opacity: G.halo.opacity,
    }))
    halo.userData.isHalo = true
    halo.scale.set(radius * G.halo.radiusScale, radius * G.halo.radiusScale, 1)
    halo.renderOrder = 20
    halo.visible = false
    group.add(halo)

    const label = makeNodeSprite(node)
    label.userData.baseOpacity = 1.0 // labels are text — always fully opaque at rest
    group.add(label)
    spriteRefs.current.set(node.id, group)
    return group
  }, [])

  // Selection/halo is CONTROLLED (16 Aug 26, Search Wiring §5): the halo
  // target comes from App (haloId) — set by map click AND by result-row
  // select in the Viewer; Back never touches it. Map click just reports up;
  // the prop round-trips back the same frame.
  const handleClick = useCallback((node) => {
    if (onSelectNode) onSelectNode(node)
    // No camera fly-to on click (9 Aug 26) — selection feedback is the halo
    // ring only; the map stays put so clicking around doesn't yank the view.
  }, [onSelectNode])

  // Beta 2.1 (10 Aug 26): node-type visibility from the Utilities drawer.
  // Uses nodeVisibility/linkVisibility accessors — the graph HIDES existing
  // objects (sets .visible=false) instead of rebuilding the scene, so a toggle
  // is instant with no re-layout churn. A hidden node hides its edges too
  // (linkVisibility drops links whose endpoint is hidden). `data` stays
  // unchanged — only these accessors re-evaluate on toggle.
  //
  // Visibility CASCADE (10 Aug 26, user-approved): when a node type is toggled
  // off, everything hanging OFF it (outward flow) goes invisible too — no
  // floating islands. Implemented as a reachability crawl from the visible
  // anchors (TICKERs): walk outward over visible links, keep only reachable
  // nodes. ~microseconds on the live graph (client-side, no re-fetch).
  //
  // Beta 2.4 (16 Aug 26): typeOn/bandOn come from config/nodeTypes.js — the
  // SAME predicates the search layer uses to build its allowlist, so the map
  // and search can never disagree about what's visible.
  const visibleSet = useMemo(() => {
    if (!data) return null
    // CONTRACT band (10 Aug 26): the contract's own band meta (">" juicy /
    // "<" boring, stamped at ingest) picks which drawer toggle applies —
    // "CONTRACT >" or "CONTRACT <". A contract whose band's toggle is off
    // behaves like a toggled-off type: excluded from the crawl, so its whole
    // branch cascades away. Simple, one source of truth (no threshold math
    // in the UI).
    const types = entityTypes ?? {}
    const nodeOn = (n) =>
      typeOn(types, n.type) &&
      (n.type !== 'CONTRACT' || bandOn(types, n.contract_band))
    // adjacency over VISIBLE links (both endpoints on)
    const adj = new Map()
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]))
    const endpoint = (x) => (typeof x === 'object' ? x : nodeById.get(x))
    ;(data.links || []).forEach((l) => {
      const s = endpoint(l.source)
      const t = endpoint(l.target)
      if (!s || !t || !nodeOn(s) || !nodeOn(t)) return
      if (!adj.has(s.id)) adj.set(s.id, [])
      if (!adj.has(t.id)) adj.set(t.id, [])
      adj.get(s.id).push(t.id)
      adj.get(t.id).push(s.id)
    })
    // crawl from every visible TICKER (the anchors — TICKER is not in the
    // drawer list, so it's always on and always a root)
    const seen = new Set()
    const queue = data.nodes.filter((n) => n.type === 'TICKER' && nodeOn(n)).map((n) => n.id)
    queue.forEach((id) => seen.add(id))
    while (queue.length) {
      const id = queue.shift()
      for (const nb of adj.get(id) || []) {
        if (!seen.has(nb)) {
          seen.add(nb)
          queue.push(nb)
        }
      }
    }
    return seen
  }, [entityTypes, data])

  const nodeVisible = useCallback(
    (n) => (visibleSet ? visibleSet.has(n.id) : true),
    [visibleSet],
  )
  const linkVisible = useCallback(
    (l) => {
      if (!visibleSet) return true
      const nodeById = new Map(data.nodes.map((n) => [n.id, n]))
      const endpoint = (x) => (typeof x === 'object' ? x.id : x)
      const s = endpoint(l.source)
      const t = endpoint(l.target)
      return visibleSet.has(s) && visibleSet.has(t)
    },
    [visibleSet, data],
  )

  // Fly-to (22 Aug 26): Viewer result-row select (semantic · Cypher · Marlowe)
  // → App sets flyToId → the camera rotates to the node, settling ~3×
  // link-distance (70) back along its radial. Map clicks DON'T fly (9 Aug 26
  // rule — clicking around shouldn't yank the view): flyToId is only set by
  // result selects, unlike haloId which is set by both.
  useEffect(() => {
    if (!flyToId || !fgRef.current || !data?.nodes?.length) return
    const node = data.nodes.find((n) => n.id === flyToId)
    if (!node || node.x == null || node.y == null || node.z == null) return
    if (nodeVisible(node) === false) return // must be on the visible map
    const PULLBACK = 210 // ~3× linkDistance (70) — consistent read at this scale
    const r = Math.max(Math.hypot(node.x, node.y, node.z), 1)
    const f = 1 + PULLBACK / r // camera sits PULLBACK units behind, lookAt the node
    fgRef.current.cameraPosition(
      { x: node.x * f, y: node.y * f, z: node.z * f },
      { x: node.x, y: node.y, z: node.z },
      900, // transition ms — smooth fly, not a teleport
    )
  }, [flyToId, data, nodeVisible])

  return (
    <div className="neural-map" ref={containerRef}>
      {isError && (
        <div className="placeholder" style={{ color: '#f87171' }}>
          <b>Graph failed to load:</b> {String(error?.message || error)}
        </div>
      )}
      {isFetching && !data && <div className="placeholder">Loading graph…</div>}
      {data && (
        <ForceGraph3D
          ref={fgRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          nodeThreeObject={nodeThreeObject}
          nodeVisibility={nodeVisible}
          linkVisibility={linkVisible}
          onNodeClick={handleClick}
          onNodeHover={setHovered}
          linkColor={(l) => G.edges.colors[l.type] || '#555555'}
          linkOpacity={G.edgeOpacity}
          linkWidth={(l) =>
            (l.type === 'HAS_CONTRACT' || l.type === 'HAS_DEAL' ? G.edges.width.core : G.edges.width.normal) *
            Math.log2((l.weight || 1) + 1)
          }
          linkDirectionalParticles={(l) =>
            G.particles.enabled && G.particles.types.includes(l.type) ? G.particles.count : 0
          }
          linkDirectionalParticleSpeed={G.particles.speed}
          linkDirectionalParticleColor={G.particles.color}
          linkDirectionalArrowLength={G.arrows.enabled ? G.arrows.length : 0}
          linkDirectionalArrowColor={(l) => G.edges.colors[l.type] || '#555555'}
          // Simulation settle (Optic Nerve parity): pre-warm so the graph appears
          // spread; let alpha decay decide the stop — NO zoomToFit on engine stop
          // (that was the "force fighting your zoom").
          warmupTicks={P.warmupTicks}
          cooldownTime={P.cooldownTime}
          d3AlphaDecay={P.alphaDecay}
          d3VelocityDecay={P.velocityDecay}
          d3LinkDistance={(l) =>
            (P.linkDistanceByType && P.linkDistanceByType[l.type]) || P.linkDistance
          }
        />
      )}
    </div>
  )
}
